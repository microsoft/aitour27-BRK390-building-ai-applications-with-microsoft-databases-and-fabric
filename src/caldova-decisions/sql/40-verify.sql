\set ON_ERROR_STOP on
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT FROM caldova.campaign_numbers
        WHERE baseline_units = 316667 AND incremental_units = 57000
          AND proposed_units = 373667 AND extra_budget_usd = 30000
          AND uplift_percent = 18.0
    ) THEN
        RAISE EXCEPTION 'Campaign numbers do not match the shared narrative';
    END IF;
    IF (SELECT count(*) FROM caldova.campaign_briefs b
        JOIN caldova.proposal_context p ON p.id = b.doc_id
        WHERE p.case_id = 'CASE-LAUNCH-001' AND p.proposal_version = 1) <> 1 THEN
        RAISE EXCEPTION 'Expected one brief for proposal version 1';
    END IF;
    IF NOT EXISTS (
        SELECT FROM caldova.campaign_briefs b
        JOIN caldova.proposal_context p ON p.id = b.doc_id
        WHERE p.case_id = 'CASE-LAUNCH-001' AND p.proposal_version = 1
          AND length(trim(b.generated_text)) > 50
          AND b.metadata->>'case_id' = p.case_id
          AND (b.metadata->>'incremental_units')::numeric = 57000
          AND (b.metadata->>'extra_budget_usd')::numeric = 30000
          AND lower(b.generated_text) LIKE '%production confirmation required%'
          AND lower(b.generated_text) LIKE '%marketing approval pending%'
    ) THEN
        RAISE EXCEPTION 'AI output is missing or inconsistent; inspect the brief and metadata';
    END IF;
END $$;
