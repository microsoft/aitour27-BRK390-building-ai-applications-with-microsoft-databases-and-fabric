\set ON_ERROR_STOP on
-- This submits the work. Check completion before running 40-verify.sql.
SELECT ai.run('caldova_campaign_proposal');
SELECT * FROM ai.status('caldova_campaign_proposal');

-- On-screen proof: original evidence, extracted fields, and generated explanation.
SELECT p.case_id, p.proposal_version, b.metadata, b.generated_text
FROM caldova.campaign_briefs b
JOIN caldova.proposal_context p ON p.id = b.doc_id
ORDER BY p.id, b.chunk_index;
