import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import sql from 'mssql';
import type { AccessTokenVerifier } from './auth.ts';
import type { TextEmbedder } from './guidance.ts';
import { evaluateMaintenanceDeferral } from './guidance.ts';
import { GUIDANCE_SEARCH_SQL, GUIDANCE_DIMENSIONS } from './guidance-adapters.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = /^[A-Za-z0-9_-]{1,100}$/;
const hash = /^[0-9a-f]{64}$/i;

export const SNAPSHOT_SQL = `
          SELECT TOP(1) * FROM act3.review_state ORDER BY importedAt DESC,caseId;
          SELECT * FROM dbo.approved_policies ORDER BY policyId,policyVersion;
          SELECT * FROM act3.approvals ORDER BY approvedAt;
          SELECT guidanceId,title,excerpt,status,sourceType,sourceHash,sourceCaseId,policyId,policyVersion,approvedBy,approvedAt,proposedBy FROM act3.guidance ORDER BY validFrom;
          SELECT * FROM act3.plans;
        `;

export const REVIEW_PROCEDURES = {
  approve: 'act3.approve_option', draft: 'act3.draft_guidance', publish: 'act3.publish_guidance',
};

export function createReviewHandler(dependencies: {
  tokenVerifier: AccessTokenVerifier;
  resources: () => Promise<{ pool: sql.ConnectionPool; embedder: TextEmbedder }>;
}) {
  return async (request: HttpRequest, context: { error: (...args: unknown[]) => void }): Promise<HttpResponseInit> => {
    const reply = (status: number, jsonBody: unknown) => ({ status, jsonBody, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    let actor;
    try { actor = await dependencies.tokenVerifier.verify(request.headers.get('authorization') ?? undefined); }
    catch { return reply(401, { error: 'Sign in to access this case.' }); }
    if (!actor.roles.includes('ROLE-ACT3-READER')) return reply(403, { error: 'The reader role is required.' });
    const action = request.params.action;
    const roles: Record<string, string[]> = {
      approve: ['ROLE-OPERATIONS-APPROVER', 'ROLE-MAINTENANCE-APPROVER'],
      draft: ['ROLE-ACT3-REVIEWER'], publish: ['ROLE-ACT3-REVIEWER'],
    };
    const readAction = action === 'snapshot' || action === 'retrieval-contract';
    if (!readAction && (!roles[action] || !roles[action].some(role => actor.roles.includes(role)))) {
      return reply(403, { error: 'The required application role is missing.' });
    }
    if (request.method !== (readAction ? 'GET' : 'POST')) return reply(405, { error: 'Method not allowed.' });
    if (action === 'retrieval-contract') return reply(200, {
      engine: 'Azure SQL Database', embeddingProvider: 'Azure OpenAI', dimensions: GUIDANCE_DIMENSIONS,
      sql: GUIDANCE_SEARCH_SQL, executionPath: 'Browser client -> authenticated Function -> Azure SQL',
      parameters: ['embedding', 'lineId', 'embeddingProfile', 'maxDistance'],
      operations: {
        'review/snapshot': { sql: SNAPSHOT_SQL, parameters: [],
          processing: 'The API selects the latest case, parses its JSON payload, filters receipts by case and computes advisory maintenance checks in TypeScript.' },
        'act3/guidance': { sql: GUIDANCE_SEARCH_SQL,
          parameters: ['embedding', 'lineId', 'embeddingProfile', 'maxDistance'],
          processing: 'Azure OpenAI embeds the question. The API derives the line from the case; Azure SQL applies eligibility filters and cosine distance.' },
        'review/approve': { procedure: REVIEW_PROCEDURES.approve,
          parameters: ['requestId', 'caseId', 'optionId', 'actorId', 'approverRole', 'reviewedHash'],
          processing: 'The API binds actorId from the verified token. SQL validates policy, reviewed state and role approvals transactionally.' },
        'review/draft': { procedure: REVIEW_PROCEDURES.draft,
          parameters: ['guidanceId', 'caseId', 'title', 'excerpt', 'embedding', 'profile', 'actorId'],
          processing: 'Azure OpenAI embeds the reviewed text. The API binds actorId from the verified token; SQL stores the draft.' },
        'review/publish': { procedure: REVIEW_PROCEDURES.publish,
          parameters: ['guidanceId', 'sourceHash', 'actorId'],
          processing: 'The API binds actorId from the verified token. SQL checks the reviewed hash and policy before recording publication.' },
      },
    });
    let body: Record<string, unknown> = {};
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return reply(415, { error: 'JSON is required.' });
      try {
        const text = await request.text();
        if (Buffer.byteLength(text) > 8192) return reply(413, { error: 'The request is too large.' });
        body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      } catch { return reply(400, { error: 'Invalid JSON request.' }); }
    }
    try {
      const { pool, embedder } = await dependencies.resources();
      if (action === 'snapshot') {
        const result = await pool.request().query(SNAPSHOT_SQL);
        const [cases, policies, approvals, guidance, plans] = result.recordsets as sql.IRecordSet<any>[];
        const current = cases[0];
        if (!current) return reply(503, { error: 'No imported case is available.' });
        const source = JSON.parse(current.payload);
        const options = source.options.map((option: any) => {
          const evaluation = source.evaluations.find((item: any) => item.optionId === option.optionId);
          const policy = policies.find((item: any) => item.policyId === evaluation?.policyId && item.policyVersion === evaluation?.policyVersion);
          const check = policy && evaluation ? evaluateMaintenanceDeferral({ ...policy, effectiveFrom: policy.effectiveFrom.toISOString() }, {
            sustainedRateFactor: option.requiredRateFactor, deferralDays: evaluation.requestedDeferralDays,
            projectedStressPct: evaluation.projectedStressPctOfThreshold,
          }, new Date()) : { permitted: false, reason: 'Current policy unavailable.' };
          return { ...option, confidence: undefined, evaluation, maintenanceCheck: check };
        });
        return reply(200, { caseId: current.caseId, lineId: current.lineId, state: current.state, selectedOptionId: current.selectedOptionId,
          reviewHash: current.reviewHash, sourceHash: current.sourceHash, importedAt: current.importedAt,
          title: source.case.title, conflict: source.conflict, options, policies,
          approvals: approvals.filter(row => row.caseId === current.caseId), guidance,
          plan: plans.find(row => row.caseId === current.caseId), actor,
          source: { name: source.source, dataClass: source.dataClass, storage: 'Azure SQL Database' } });
      }
      if (action === 'approve') {
        const { requestId, caseId, optionId, reviewedHash, approverRole } = body;
        if (typeof requestId !== 'string' || !uuid.test(requestId) || typeof caseId !== 'string' || !id.test(caseId)
          || typeof optionId !== 'string' || !id.test(optionId) || typeof reviewedHash !== 'string' || !hash.test(reviewedHash)
          || typeof approverRole !== 'string' || !roles.approve.includes(approverRole)) return reply(400, { error: 'Invalid approval request.' });
        if (!actor.roles.includes(approverRole)) return reply(403, { error: 'This approval role is not assigned to you.' });
        const result = await pool.request().input('requestId', sql.UniqueIdentifier, requestId).input('caseId', sql.NVarChar(100), caseId)
          .input('optionId', sql.NVarChar(100), optionId).input('actorId', sql.UniqueIdentifier, actor.objectId)
          .input('approverRole', sql.VarChar(100), approverRole).input('reviewedHash', sql.Char(64), reviewedHash).execute(REVIEW_PROCEDURES.approve);
        return reply(200, result.recordset[0]);
      }
      if (action === 'publish') {
        if (typeof body.guidanceId !== 'string' || !id.test(body.guidanceId) || typeof body.sourceHash !== 'string' || !hash.test(body.sourceHash)) return reply(400, { error: 'Invalid publication request.' });
        const result = await pool.request().input('guidanceId', sql.NVarChar(100), body.guidanceId).input('sourceHash', sql.Char(64), body.sourceHash)
          .input('actorId', sql.UniqueIdentifier, actor.objectId).execute(REVIEW_PROCEDURES.publish);
        return reply(200, result.recordset[0]);
      }
      const { guidanceId, caseId, title, excerpt } = body;
      if (typeof guidanceId !== 'string' || !id.test(guidanceId) || typeof caseId !== 'string' || !id.test(caseId)
        || typeof title !== 'string' || title.trim().length < 3 || title.length > 200
        || typeof excerpt !== 'string' || excerpt.trim().length < 20 || excerpt.length > 1800) return reply(400, { error: 'Provide a title and a lesson between 20 and 1800 characters.' });
      const embedding = await embedder.embed(`${title.trim()}\n${excerpt.trim()}`);
      const result = await pool.request().input('guidanceId', sql.NVarChar(100), guidanceId).input('caseId', sql.NVarChar(100), caseId)
        .input('title', sql.NVarChar(300), title.trim()).input('excerpt', sql.NVarChar(4000), excerpt.trim())
        .input('embedding', sql.NVarChar(sql.MAX), JSON.stringify(embedding)).input('profile', sql.NVarChar(200), embedder.profile)
        .input('actorId', sql.UniqueIdentifier, actor.objectId).execute(REVIEW_PROCEDURES.draft);
      return reply(201, result.recordset[0]);
    } catch (error) {
      const failure = error as { number?: number; message?: string; code?: string; name?: string };
      if (failure.number && failure.number >= 51000 && failure.number <= 51010) return reply(failure.number === 51010 ? 429 : 409, { error: failure.message });
      context.error('Review request failed', error);
      const dependencyCode = /^[A-Z_]{2,30}$/.test(failure.code ?? '') ? failure.code : 'DEPENDENCY_FAILURE';
      const firewallAddress = failure.message?.match(/Client with IP address '([0-9.]+)'/)?.[1];
      return reply(503, { error: readAction
        ? 'SQL is temporarily unavailable. Retry to reconnect and refresh the case.'
        : 'The request could not be confirmed. The write outcome is unknown. Refresh the case and inspect receipts before retrying.',
        writeOutcomeUnknown: !readAction,
        dependencyCode: firewallAddress ? 'SQL_FIREWALL_DENIED' : dependencyCode,
        ...(firewallAddress && actor.roles.includes('ROLE-ACT3-REVIEWER') ? { firewallAddress } : {}),
      });
    }
  };
}