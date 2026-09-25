import sql from 'mssql';
import {config,scenario,credential,connect,insertCase,verifyScenario} from './staffing-admin.mjs';
import {AzureOpenAIEmbedder} from '../../src/act3/guidance-adapters.ts';
import {required} from './config.mjs';

verifyScenario();
const caseId=required('ACT3_STAFFING_CASE_ID');
if(!/^[A-Za-z0-9_-]{1,100}$/.test(caseId)) throw new Error('Invalid staffing case ID.');
const pool=await connect();
const embedder=new AzureOpenAIEmbedder({endpoint:config.embeddingEndpoint,deployment:config.embeddingDeployment,profile:config.embeddingProfile},credential);
try{
  for(const policy of scenario.policies){
    const existing=await pool.request().input('id',sql.NVarChar(100),policy.policyId).input('version',sql.NVarChar(30),policy.policyVersion)
      .query('SELECT policyId FROM staffing.policies WHERE policyId=@id AND policyVersion=@version');
    if(existing.recordset.length) continue;
    await pool.request().execute('act3.consume_embedding_budget');
    const vector=await embedder.embed(`${policy.title}\n${policy.body}`);
    await pool.request().input('json',sql.NVarChar(sql.MAX),JSON.stringify(policy)).input('embedding',sql.NVarChar(sql.MAX),JSON.stringify(vector))
      .input('profile',sql.NVarChar(200),config.embeddingProfile).query(`
      INSERT staffing.policies(policyId,policyVersion,title,body,factoryId,lineId,validFrom,validUntil,status,ruleType,noticeDays,allowNewAssignments,embedding,embeddingProfile)
      SELECT policyId,policyVersion,title,body,factoryId,lineId,validFrom,validUntil,status,ruleType,noticeDays,allowNewAssignments,CAST(@embedding AS VECTOR(1536)),@profile
      FROM OPENJSON(@json) WITH(policyId nvarchar(100),policyVersion nvarchar(30),title nvarchar(300),body nvarchar(4000),
        factoryId nvarchar(100),lineId nvarchar(100),validFrom datetime2,validUntil datetime2,status varchar(30),ruleType varchar(30),noticeDays int,allowNewAssignments bit);`);
  }
  await insertCase(pool,caseId);
  console.log(JSON.stringify((await pool.request().input('caseId',sql.NVarChar(100),caseId)
    .query('SELECT optionId,outputUnits,shortfallUnits,eligible,reason FROM staffing.options(@caseId);')).recordset,null,2));
}finally{await pool.close();}