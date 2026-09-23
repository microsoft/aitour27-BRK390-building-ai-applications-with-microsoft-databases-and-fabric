-- Open sql/53-recommendation-pipeline.sql: CHUNK -> EXTRACT ID -> GENERATE -> EXTRACT CLAIMS.
-- The last step extracts the actual generated claims for comparison to SQL.
SELECT ai.explain('caldova_recommendation_usd_v1');
SELECT ai.run('caldova_recommendation_usd_v1');

SELECT * FROM ai.status('caldova_recommendation_usd_v1');
SELECT e.id AS evaluation_id,b.metadata,b.generated_text
FROM caldova.usd_briefs b JOIN caldova.evaluations e ON e.id::text=b.metadata->>'evaluation_id'
JOIN caldova.planning_requests r ON r.id=e.request_id
WHERE r.case_id='HYDRATION-SUNSCREEN-CAMPAIGN-001' ORDER BY e.id;

SELECT id,label,status,created_at,completed_at FROM df.instances
WHERE label IN ('ai-pipeline:caldova_evidence_v3','ai-pipeline:caldova_recommendation_usd_v1')
ORDER BY created_at DESC LIMIT 5;
