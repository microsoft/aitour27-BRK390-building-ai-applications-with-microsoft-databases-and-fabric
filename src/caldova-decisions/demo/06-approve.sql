-- Replace 0 with the exact evaluation_id whose brief Tim reviewed.
-- Approval is an explicit human step; do not auto-select the latest version.
SELECT caldova.approve_evaluation(0);

SELECT * FROM caldova.demo_commitment
WHERE case_id='HYDRATION-SUNSCREEN-CAMPAIGN-001';

SELECT case_id,required_units,status FROM caldova.production_requests
WHERE case_id='HYDRATION-SUNSCREEN-CAMPAIGN-001';
