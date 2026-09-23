-- SELECT each block individually. This is the AI-first recording tab.
-- It reads actual deployed definitions/runs; it does not register pipelines.

-- 1. An AI Function in SQL: show the call, then execute it.
SELECT azure_ai.extract(
    document => content,
    data => ARRAY['outlook_weeks: integer', 'assumptions: string'],
    model => 'caldova-chat'
) AS extracted_facts
FROM caldova.decision_documents
WHERE source_reference='OUTLOOK-North America';

-- 2. The pipeline graph. Keep this visible before switching to the definition.
SELECT ai.explain('caldova_evidence_v3');
SELECT ai.explain('caldova_recommendation_usd_v1');

-- 3. The actual deployed AI step definitions, not just a local source file.
SELECT step_number,step->>'step' AS ai_step,
       step->>'model' AS model,step->>'column' AS input_column
FROM ai.pipelines
CROSS JOIN LATERAL unnest(steps)
WITH ORDINALITY AS s(step,step_number)
WHERE name='caldova_recommendation_usd_v1';

-- 4. Under the pipeline: real AI Function calls and their execution state.
WITH latest AS (
    SELECT id,label,status FROM df.instances
    WHERE label='ai-pipeline:caldova_recommendation_usd_v1'
    ORDER BY created_at DESC LIMIT 1
)
SELECT i.id AS run_id,i.status AS run_status,n.status AS step_status,
       CASE WHEN n.query LIKE '%azure_ai.generate(%' THEN 'azure_ai.generate()'
            WHEN n.query LIKE '%azure_ai.extract(%' THEN 'azure_ai.extract()' END AS ai_function,
       CASE WHEN n.query LIKE '%azure_ai.generate(%' THEN 'Write decision brief'
            WHEN n.query LIKE '%azure_ai.extract(generated_text%' THEN 'Extract generated claims'
            ELSE 'Extract source facts' END AS purpose
FROM latest i JOIN df.nodes n ON n.instance_id=i.id
WHERE n.node_type='SQL' AND
 (n.query LIKE '%azure_ai.generate(%' OR n.query LIKE '%azure_ai.extract(%')
ORDER BY CASE WHEN n.query LIKE '%azure_ai.extract(generated_text%' THEN 3
              WHEN n.query LIKE '%azure_ai.generate(%' THEN 2 ELSE 1 END;

-- 5. Show the generated SQL behind those steps, if the audience wants detail.
SELECT n.query AS executed_step_sql
FROM df.nodes n
WHERE n.instance_id=(SELECT id FROM df.instances
    WHERE label='ai-pipeline:caldova_recommendation_usd_v1'
    ORDER BY created_at DESC LIMIT 1)
AND n.node_type='SQL'
AND (n.query LIKE '%azure_ai.generate(%' OR n.query LIKE '%azure_ai.extract(%')
ORDER BY n.created_at,n.id;
