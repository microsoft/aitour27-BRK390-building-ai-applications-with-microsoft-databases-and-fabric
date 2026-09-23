-- Open sql/51-evidence-pipeline.sql beside this query: CHUNK -> EXTRACT.
SELECT caldova.refresh_evidence_packets();
SELECT ai.explain('caldova_evidence_v3');
SELECT ai.run('caldova_evidence_v3');

-- Run after completion. Incremental runs reuse unchanged evidence.
SELECT * FROM ai.status('caldova_evidence_v3');
SELECT source_reference,metadata->>'outlook_weeks' AS weeks,
       metadata->>'demand_supported' AS demand_supported,
       metadata->>'assumptions' AS assumptions
FROM caldova.current_evidence WHERE region IS NOT NULL OR source_reference IN
 (SELECT policy_id || '-v' || version FROM caldova.commercial_policies) ORDER BY id;

-- Optional immediate AI Function call: visibly invokes the same model now.
SELECT azure_ai.extract(
 document => 'Regional demand should stay elevated for six weeks, provided the weather outlook holds.',
 data => ARRAY['outlook_weeks: integer','assumptions: string'],
 model => 'caldova-chat'
);
