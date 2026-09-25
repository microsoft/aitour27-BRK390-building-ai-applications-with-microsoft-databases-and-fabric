import type {HttpRequest,HttpResponseInit} from '@azure/functions';
import sql from 'mssql';
import type {AccessTokenVerifier} from './auth.ts';
import type {TextEmbedder} from './guidance.ts';
import {validateMemoryEvidence, type MemoryEvidence} from './staffing-memory.ts';
import {STAFFING_ROLES, staffingNarrative} from './staffing.ts';

export const STAFFING_POLICY_SQL = `
DECLARE @queryVector VECTOR(1536)=CAST(@embedding AS VECTOR(1536));
SELECT TOP(5) policy.policyId,policy.policyVersion,policy.title,policy.body,
 policy.factoryId,policy.lineId,policy.validFrom,policy.validUntil,policy.ruleType,
 VECTOR_DISTANCE('cosine',policy.embedding,@queryVector) AS distance
FROM staffing.policies policy JOIN staffing.current_cases currentCase ON currentCase.caseId=@caseId
WHERE policy.factoryId=currentCase.factoryId AND (policy.lineId IS NULL OR policy.lineId=currentCase.lineId)
 AND policy.status='approved' AND policy.validFrom<=currentCase.planningNow
 AND policy.validFrom<=currentCase.windowStart
 AND (policy.validUntil IS NULL OR policy.validUntil>=currentCase.windowEnd)
 AND policy.embeddingProfile=@profile
ORDER BY distance,policy.policyId;`;

export const STAFFING_SNAPSHOT_SQL = `
SELECT * FROM staffing.current_cases WHERE caseId=@caseId;
SELECT * FROM staffing.options(@caseId);
SELECT * FROM staffing.approvals WHERE caseId=@caseId ORDER BY approvedAt;
SELECT * FROM staffing.plans WHERE caseId=@caseId;`;

const identifier = /^[A-Za-z0-9_-]{1,100}$/;
const digest = /^[a-f0-9]{64}$/i;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function createStaffingHandler(dependencies: {
  tokenVerifier: AccessTokenVerifier;
  resources: () => Promise<{pool: sql.ConnectionPool; embedder: TextEmbedder}>;
  readMemory: (id: string, partition: string) => Promise<MemoryEvidence>;
  caseId: string;
}) {
  return async (request: HttpRequest, context: {error:(...values:unknown[])=>void}): Promise<HttpResponseInit> => {
    const reply = (status:number,jsonBody:unknown) => ({status,jsonBody,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
    let actor;
    try {actor = await dependencies.tokenVerifier.verify(request.headers.get('authorization') ?? undefined);}
    catch {return reply(401,{error:'Sign in to review this production case.'});}
    if (!actor.roles.includes('ROLE-ACT3-READER')) return reply(403,{error:'The reader role is required.'});
    const action = request.params.action;
    const methods:Record<string,string> = {snapshot:'GET',memory:'GET',contract:'GET',policies:'POST',assess:'POST',propose:'POST',approve:'POST'};
    if (!methods[action]) return reply(404,{error:'Unknown staffing operation.'});
    if (request.method!==methods[action]) return reply(405,{error:'Method not allowed.'});
    if (action==='contract') return reply(200,{
      snapshot:{sql:STAFFING_SNAPSHOT_SQL,processing:'Azure SQL computes output and mandatory policy checks in staffing.options. The app displays returned values.'},
      policies:{sql:STAFFING_POLICY_SQL,processing:'Azure OpenAI embeds the question; SQL ranks policies after scope/date/status filtering. Mandatory checks are independent of these ranked results.'},
      assess:{sql:STAFFING_SNAPSHOT_SQL+'\n'+STAFFING_POLICY_SQL,processing:'Read the current case, then validate the Cosmos productivity lesson against its SQL line and model. Only then read SQL options and retrieve SQL policies. Cosmos supplies experience; SQL supplies current constraints and capacity.'},
      propose:{sql:'EXEC staffing.propose @caseId, @reviewedHash, @memoryHash, @memorySource, @memoryLine, @memoryModel;',processing:'The API reads Cosmos and binds its source hash. SQL verifies the model, policy and readiness before retaining a proposal.'},
      approve:{sql:'EXEC staffing.approve @requestId, @caseId, @actorId, @approverRole, @reviewedHash, @memoryHash;',processing:'The verified identity supplies actorId. SQL serializes approvals, rechecks current constraints and records a plan only after both roles approve.'},
    });
    let body:Record<string,unknown>={};
    if (request.method==='POST') {
      if (request.headers.get('content-type')?.split(';')[0]!=='application/json') return reply(415,{error:'JSON is required.'});
      try {const text=await request.text(); if(Buffer.byteLength(text)>8192) return reply(413,{error:'Request too large.'});
        body=JSON.parse(text); if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error();}
      catch {return reply(400,{error:'Invalid JSON request.'});}
    }
    const caseId=dependencies.caseId;
    if(!identifier.test(caseId)) return reply(503,{error:'The staffing case is not configured.'});
    if(action==='propose' && !actor.roles.includes('ROLE-OPERATIONS-APPROVER')) return reply(403,{error:'Operations approval role is required to submit a proposal.'});
    if(action==='approve' && (typeof body.approverRole!=='string' || !STAFFING_ROLES.includes(body.approverRole as typeof STAFFING_ROLES[number]) || !actor.roles.includes(body.approverRole))) {
      return reply(403,{error:'The requested approval role is not assigned to you.'});
    }
    if(['propose','approve'].includes(action) && (typeof body.reviewedHash!=='string' || !digest.test(body.reviewedHash))) return reply(400,{error:'Review the current case before submitting.'});
    if(['propose','approve'].includes(action) && (typeof body.reviewedMemoryHash!=='string' || !digest.test(body.reviewedMemoryHash))) return reply(400,{error:'Review the retained source before submitting.'});
    if(action==='approve' && (typeof body.requestId!=='string' || !uuid.test(body.requestId))) return reply(400,{error:'A valid approval request identifier is required.'});
    if(['policies','assess'].includes(action) && (typeof body.question!=='string' || body.question.trim().length<3 || body.question.length>2000)) return reply(400,{error:'Enter a production question of 3 to 2000 characters.'});
    let writeAttempted=false;
    try {
      const {pool,embedder}=await dependencies.resources();
      const query=()=>pool.request().input('caseId',sql.NVarChar(100),caseId);
      if(action==='snapshot') {
        const result=await query().query(STAFFING_SNAPSHOT_SQL);
        const [cases,options,approvals,plans]=result.recordsets as sql.IRecordSet<any>[];
        if(!cases[0]) return reply(503,{error:'The staffing case has not been prepared.'});
        return reply(200,{...cases[0],options,approvals,plan:plans[0] ?? null,actor});
      }
      if(action==='policies') {
        const embedding=await embedder.embed(body.question as string);
        const result=await query().input('embedding',sql.NVarChar(sql.MAX),JSON.stringify(embedding))
          .input('profile',sql.NVarChar(200),embedder.profile).query(STAFFING_POLICY_SQL);
        return reply(200,{matches:result.recordset,question:body.question});
      }
      const current=(await query().query('SELECT * FROM staffing.current_cases WHERE caseId=@caseId')).recordset[0];
      if(!current) return reply(503,{error:'The staffing case is unavailable.'});
      let evidence:MemoryEvidence;
      try {evidence=validateMemoryEvidence(await dependencies.readMemory(current.memoryId,current.memoryPartition),current.memoryId,current.memoryPartition);}
      catch {context.error('Staffing memory read or validation failed');
        return reply(503,{error:'The retained Act 2 decision could not be verified from Cosmos DB. Assessment, proposal and approval require the verified source.',dependency:'cosmos',writeOutcomeUnknown:false});}
      const narrative=staffingNarrative(evidence.memory,current);
      if(action==='memory') return reply(200,{...evidence,...narrative});
      if(!narrative.applicable) return reply(409,{error:narrative.nextStep});
      if(action==='assess') {
        const result=await query().query(STAFFING_SNAPSHOT_SQL);
        const [cases,options,approvals,plans]=result.recordsets as sql.IRecordSet<any>[];
        const assessed=cases[0];
        if(!assessed || assessed.contextHash!==current.contextHash || assessed.memoryId!==current.memoryId
          || assessed.memoryPartition!==current.memoryPartition || !staffingNarrative(evidence.memory,assessed).applicable
          || options.some(option=>typeof option.contextHash!=='string' || !digest.test(option.contextHash)
            || option.contextHash!==assessed.contextHash || option.caseId!==assessed.caseId)) {
          return reply(409,{error:'The case changed during assessment. Assess staffing again.'});
        }
        const embedding=await embedder.embed(body.question as string);
        const policies=await query().input('embedding',sql.NVarChar(sql.MAX),JSON.stringify(embedding))
          .input('profile',sql.NVarChar(200),embedder.profile).query(STAFFING_POLICY_SQL);
        return reply(200,{snapshot:{...assessed,options,approvals,plan:plans[0] ?? null,actor},
          memory:{...evidence,...narrative},policies:{matches:policies.recordset,question:body.question}});
      }
      if(body.reviewedMemoryHash!==evidence.hash) return reply(409,{error:'The retained source changed since your review. Assess staffing again.'});
      const command=query().input('reviewedHash',sql.Char(64),body.reviewedHash).input('memoryHash',sql.Char(64),evidence.hash);
      if(action==='propose') {
        command.input('memorySource',sql.NVarChar(1000),evidence.source).input('memoryLine',sql.NVarChar(100),evidence.memory.lineId)
          .input('memoryModel',sql.NVarChar(100),evidence.memory.modelVersion);
        writeAttempted=true;
        return reply(200,(await command.execute('staffing.propose')).recordset[0]);
      }
      command.input('requestId',sql.UniqueIdentifier,body.requestId).input('actorId',sql.UniqueIdentifier,actor.objectId)
        .input('approverRole',sql.VarChar(100),body.approverRole);
      writeAttempted=true;
      return reply(200,(await command.execute('staffing.approve')).recordset[0]);
    } catch(error) {
      const failure=error as {number?:number};
      if(failure.number && failure.number>=51100 && failure.number<=51108) return reply(409,{error:'The case, policy, source or approval state changed. Refresh and review again.'});
      context.error('Staffing operation failed',{writeAttempted});
      return reply(503,{error:writeAttempted?'The write could not be confirmed. Refresh the case and receipts before retrying.':'The service is unavailable. Retry to reconnect.',writeOutcomeUnknown:writeAttempted});
    }
  };
}