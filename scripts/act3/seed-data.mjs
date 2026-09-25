import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sql from 'mssql';
import { AzureOpenAIEmbedder, SqlGuidanceStore } from '../../src/act3/guidance-adapters.ts';
import { loadDeploymentConfig, required, requireCloudWrite, verifyAzureContext } from './config.mjs';

const config = loadDeploymentConfig();
requireCloudWrite();
verifyAzureContext(config);
if (process.env.CALDOVA_SYNTHETIC_SOURCE_CONFIRMED !== 'true') throw new Error('Confirm the source contains only the reviewed synthetic estate.');
const sourceServer = required('FABRIC_SQL_SERVER');
if (!/^[a-z0-9-]+\.database\.fabric\.microsoft\.com$/i.test(sourceServer)) throw new Error('Invalid Fabric SQL hostname.');
const credential = { async getToken(scope) {
  return { token: execFileSync('az', ['account', 'get-access-token', '--tenant', config.tenant,
    '--resource', scope.replace(/\.default$/, ''), '--query', 'accessToken', '-o', 'tsv'], { encoding: 'utf8' }).trim() };
} };
const token = (await credential.getToken('https://database.windows.net/.default')).token;
const connect = (server, database) => new sql.ConnectionPool({ server, database,
  authentication: { type: 'azure-active-directory-access-token', options: { token } },
  options: { encrypt: true, trustServerCertificate: false }, connectionTimeout: 90000, requestTimeout: 90000 }).connect();
const source = await connect(sourceServer, required('FABRIC_SQL_DATABASE'));
let bundle;
try {
  const result = await source.request().query(`
    SELECT TOP(1) * FROM dbo.decision_cases WHERE status='open' AND lineId IS NOT NULL ORDER BY openedAt DESC,caseId;
    SELECT * FROM dbo.approved_policies ORDER BY policyId,policyVersion;
    SELECT * FROM dbo.production_options ORDER BY optionId;
    SELECT * FROM dbo.maintenance_policy_evaluations ORDER BY optionId;
    SELECT * FROM dbo.vw_capacity_conflict ORDER BY lineId;
    SELECT * FROM dbo.maintenance_windows WHERE insideCampaignPeriod=1 ORDER BY maintenanceWindowId;
  `);
  const [cases, policies, options, evaluations, conflicts, windows] = result.recordsets;
  const current = cases[0];
  if (!current) throw new Error('Fabric has no current case.');
  bundle = { case: current, policies, options, evaluations, conflict: conflicts.find(row => row.lineId === current.lineId),
    maintenance: windows.find(row => row.lineId === current.lineId), source: 'CaldovaOperations in Microsoft Fabric', dataClass: 'synthetic_scenario' };
  if (!bundle.conflict || !bundle.maintenance) throw new Error('The case has no matching conflict or maintenance window.');
} finally { await source.close(); }
const payload = JSON.stringify(bundle);
const hash = createHash('sha256').update(payload).digest('hex');
const target = await connect(config.sqlServer, config.sqlDatabase);
const embedder = new AzureOpenAIEmbedder({ endpoint: config.embeddingEndpoint, deployment: config.embeddingDeployment, profile: config.embeddingProfile }, credential);
try {
  for (const filename of ['001_guidance.sql', '002_review.sql']) {
    const script = readFileSync(new URL(`../../src/act3/sql/${filename}`, import.meta.url), 'utf8');
    for (const batch of script.split(/^GO\s*$/mi).filter(part => part.trim())) await target.request().batch(batch);
  }
  const existing = await target.request().input('caseId', sql.NVarChar(100), bundle.case.caseId)
    .query('SELECT sourceHash FROM dbo.decision_cases WHERE caseId=@caseId');
  if (existing.recordset[0] && existing.recordset[0].sourceHash !== hash) throw new Error('Source changed; explicit versioned reimport required.');
  for (const policy of bundle.policies) {
    await target.request().input('json', sql.NVarChar(sql.MAX), JSON.stringify(policy)).query(`
      INSERT dbo.approved_policies(policyId,policyVersion,policyName,status,effectiveFrom,ruleJson)
      SELECT policyId,policyVersion,policyName,status,effectiveFrom,ruleJson FROM OPENJSON(@json)
        WITH(policyId nvarchar(100),policyVersion nvarchar(100),policyName nvarchar(300),status varchar(30),effectiveFrom datetime2,ruleJson nvarchar(max)) incoming
      WHERE NOT EXISTS(SELECT 1 FROM dbo.approved_policies existing WHERE existing.policyId=incoming.policyId AND existing.policyVersion=incoming.policyVersion);`);
  }
  await target.request().input('caseId', sql.NVarChar(100), bundle.case.caseId).input('lineId', sql.NVarChar(100), bundle.case.lineId)
    .input('payload', sql.NVarChar(sql.MAX), payload).input('hash', sql.Char(64), hash)
    .query('IF NOT EXISTS(SELECT 1 FROM dbo.decision_cases WHERE caseId=@caseId) INSERT dbo.decision_cases(caseId,lineId,payload,sourceHash) VALUES(@caseId,@lineId,@payload,@hash);');
  for (const policy of bundle.policies.filter(row => ['POL-MAINT-002', 'POL-CAPACITY-003'].includes(row.policyId))) {
    const rule = JSON.parse(policy.ruleJson);
    const excerpt = rule.deferralTable
      ? `${policy.policyName}. Maintenance deferral depends on the sustained production rate. ${rule.deferralTable.map(band => `At up to ${band.maxSustainedRateFactor * 100}% sustained rate, at most ${band.maxDeferralDays} days of deferral.`).join(' ')} Projected stress must stay within ${rule.stressCeilingPct}% of the threshold. Required approval: ${rule.requiredApproverRole}.`
      : `${policy.policyName}. Maximum sustained utilisation: ${rule.maxSustainedUtilisation * 100}%. Utilisation above ${rule.utilisationRequiringApproval * 100}% requires approval from ${rule.requiredApproverRole}. Maximum sustained rate: ${rule.maxSustainedRateFactor * 100}%.`;
    const guidanceId = `SOURCE-${policy.policyId}-${policy.policyVersion}`;
    const found = await target.request().input('id', sql.NVarChar(100), guidanceId).query('SELECT guidanceId FROM act3.guidance WHERE guidanceId=@id');
    if (found.recordset.length) continue;
    await target.request().execute('act3.consume_embedding_budget');
    const embedding = await embedder.embed(`${policy.policyName}\n${excerpt}`);
    await target.request().input('id', sql.NVarChar(100), guidanceId).input('line', sql.NVarChar(100), bundle.case.lineId)
      .input('title', sql.NVarChar(300), policy.policyName).input('excerpt', sql.NVarChar(4000), excerpt)
      .input('caseId', sql.NVarChar(100), bundle.case.caseId).input('version', sql.NVarChar(100), policy.policyVersion)
      .input('policyId', sql.NVarChar(100), policy.policyId).input('hash', sql.Char(64), createHash('sha256').update(JSON.stringify(policy)).digest('hex'))
      .input('validFrom', sql.DateTime2, new Date(policy.effectiveFrom)).input('profile', sql.NVarChar(200), config.embeddingProfile)
      .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding)).query(`
        INSERT act3.guidance(guidanceId,lineId,title,excerpt,sourceCaseId,sourceVersion,sourceHash,policyId,policyVersion,status,sourceType,validFrom,embeddingProfile,embedding)
        VALUES(@id,@line,@title,@excerpt,@caseId,@version,@hash,@policyId,@version,'source_approved','policy',@validFrom,@profile,CAST(@embedding AS VECTOR(1536)));`);
  }
  const calibration = [];
  const store = new SqlGuidanceStore(target, 2);
  for (const question of ['Can we postpone maintenance by running the packaging line more slowly?', 'Who must approve higher production utilisation?', 'What is the recipe for chocolate cake?']) {
    await target.request().execute('act3.consume_embedding_budget');
    const matches = await store.search({ caseId: bundle.case.caseId, lineId: bundle.case.lineId }, await embedder.embed(question), config.embeddingProfile);
    calibration.push({ question, matches: matches.map(row => ({ title: row.title, distance: row.distance })) });
  }
  mkdirSync(new URL('../../build/evidence/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../../build/evidence/source-import.json', import.meta.url), JSON.stringify({ importedAt: new Date().toISOString(), sourceHash: hash, bundle, calibration }, null, 2) + '\n');
  console.log(JSON.stringify({ caseId: bundle.case.caseId, sourceHash: hash, calibration }, null, 2));
} finally { await target.close(); }