export function createStaffingReadiness({ resources, caseId, readMemory, log = () => {} }) {
  return async () => {
    const started = Date.now();
    let dependency = 'sql';
    try {
      const { pool } = await resources();
      const result = await pool.request().input('caseId', caseId).query(
        'SELECT memoryId,memoryPartition FROM staffing.current_cases WHERE caseId=@caseId; SELECT COUNT(*) AS optionCount,SUM(CASE WHEN eligible=1 THEN 1 ELSE 0 END) AS eligibleCount FROM staffing.options(@caseId);');
      const current = result.recordsets[0][0];
      if (!current || result.recordsets[1][0].optionCount !== 3) throw Object.assign(new Error('Case unavailable'), { code: 'CASE_UNAVAILABLE' });
      if (!(result.recordsets[1][0].eligibleCount > 0)) throw Object.assign(new Error('No eligible staffing option'), { code: 'CASE_NO_ELIGIBLE_OPTION' });
      dependency = 'cosmos';
      await readMemory(current.memoryId, current.memoryPartition);
      return { status: 200, jsonBody: { ready: true, sql: 'ready', cosmos: 'ready', durationMs: Date.now() - started }, headers: { 'cache-control': 'no-store' } };
    } catch (error) {
      log('staffing.readiness.failed', { dependency, code: error?.code || 'DEPENDENCY_ERROR', durationMs: Date.now() - started });
      return { status: 503, jsonBody: { ready: false, dependency, durationMs: Date.now() - started }, headers: { 'cache-control': 'no-store' } };
    }
  };
}