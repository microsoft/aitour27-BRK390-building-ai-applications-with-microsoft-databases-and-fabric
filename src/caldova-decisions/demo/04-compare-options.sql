SELECT caldova.evaluate_request(id) AS evaluation_id
FROM caldova.planning_requests WHERE case_id='HYDRATION-SUNSCREEN-CAMPAIGN-001';

-- Use the returned evaluation_id to examine a particular version if reevaluating.
SELECT * FROM caldova.demo_options
WHERE case_id='HYDRATION-SUNSCREEN-CAMPAIGN-001' ORDER BY evaluation_id,scenario;

SELECT * FROM caldova.demo_allocation
WHERE case_id='HYDRATION-SUNSCREEN-CAMPAIGN-001' ORDER BY evaluation_id,region;
