import {readFileSync} from 'node:fs';
import {connect} from './staffing-admin.mjs';

const pool = await connect();
try {
  const script = readFileSync(new URL('../../src/act3/sql/003_staffing.sql',import.meta.url),'utf8');
  for (const batch of script.split(/^GO\s*$/mi).filter(value=>value.trim())) await pool.request().batch(batch);
  const result = await pool.request().query("SELECT COUNT(*) AS existingMaintenanceCases FROM dbo.decision_cases; SELECT OBJECT_ID('staffing.options') AS optionsFunction, OBJECT_ID('staffing.approve') AS approvalProcedure;");
  console.log(JSON.stringify(result.recordsets));
} finally {await pool.close();}