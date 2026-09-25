import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import sql from 'mssql';
import { loadDeploymentConfig, requireCloudWrite, verifyAzureContext } from './config.mjs';

export const config=loadDeploymentConfig();
export const scenario=JSON.parse(readFileSync(new URL('../../src/act3/staffing-scenario.json',import.meta.url)));
export function verifyScenario(){
  execFileSync(process.execPath,[new URL('./build-staffing-scenario.mjs',import.meta.url).pathname,'--check'],{stdio:'pipe'});
}
export const credential={async getToken(scope){
  const result=JSON.parse(execFileSync('az',['account','get-access-token','--tenant',config.tenant,
    '--resource',scope.replace(/\.default$/,''),'-o','json'],{encoding:'utf8'}));
  return {token:result.accessToken,expiresOnTimestamp:Date.parse(result.expiresOn)};
}};
export async function connect(){
  requireCloudWrite();
  verifyAzureContext(config);
  const {token}=await credential.getToken('https://database.windows.net/.default');
  return new sql.ConnectionPool({server:config.sqlServer,database:config.sqlDatabase,
    authentication:{type:'azure-active-directory-access-token',options:{token}},options:{encrypt:true,trustServerCertificate:false},
    connectionTimeout:90000,requestTimeout:30000}).connect();
}
export async function insertCase(pool,caseId){
  const current={...scenario.case,caseId};
  const result=await pool.request().input('json',sql.NVarChar(sql.MAX),JSON.stringify(current)).query(`
    INSERT staffing.cases(caseId,title,factoryId,lineId,scenarioAsOf,windowStart,windowEnd,demandUnits,dailyOutput,
      baseWorkers,extraWorkers,gainPerWorker,maxExtraWorkers,machineDailyLimit,temporaryAvailable,qualified,onboardingReadyAt,modelVersion,memoryId,memoryPartition,operatingDates,datasetContext)
    SELECT caseId,title,factoryId,lineId,scenarioAsOf,windowStart,windowEnd,demandUnits,dailyOutput,baseWorkers,extraWorkers,
      gainPerWorker,maxExtraWorkers,machineDailyLimit,temporaryAvailable,qualified,onboardingReadyAt,modelVersion,memoryId,memoryPartition,operatingDates,datasetContext
    FROM OPENJSON(@json) WITH(caseId nvarchar(100),title nvarchar(300),factoryId nvarchar(100),lineId nvarchar(100),
      scenarioAsOf datetime2,windowStart datetime2,windowEnd datetime2,demandUnits int,dailyOutput int,baseWorkers int,
      extraWorkers int,gainPerWorker decimal(9,4),maxExtraWorkers int,machineDailyLimit int,temporaryAvailable int,
      qualified bit,onboardingReadyAt datetime2,modelVersion nvarchar(100),memoryId nvarchar(200),memoryPartition nvarchar(200),
      operatingDates nvarchar(max) AS JSON,datasetContext nvarchar(max) AS JSON) incoming
    WHERE NOT EXISTS(SELECT 1 FROM staffing.cases WHERE caseId=incoming.caseId);
    SELECT * FROM staffing.cases WHERE caseId=JSON_VALUE(@json,'$.caseId');`);
  const stored=result.recordset[0];
  for(const [field,expected] of Object.entries(current)){
    const actual=stored[field];
    const message=`Existing case ${caseId} differs at ${field}. Create a newly identified case; existing approvals are preserved.`;
    if(actual instanceof Date)assert.equal(actual.getTime(),Date.parse(expected),message);
    else if(expected&&typeof expected==='object')assert.deepEqual(JSON.parse(actual),expected,message);
    else assert.equal(actual,expected,message);
  }
}