-- Run the blocks individually in VS Code. Change the case suffix for each recording.
INSERT INTO caldova.planning_requests(case_id,question,weeks,budget_limit)
VALUES ('HYDRATION-SUNSCREEN-CAMPAIGN-001',
 'If we invest up to USD 30000 more over six weeks, which regions should we prioritise and what demand should we expect?',
 6,30000)
RETURNING id,case_id,question,budget_limit;
