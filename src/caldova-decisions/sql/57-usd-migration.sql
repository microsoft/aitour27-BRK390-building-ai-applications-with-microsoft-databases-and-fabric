\set ON_ERROR_STOP on
BEGIN;
-- Rebase the fictional fixture, not an FX conversion. Approved snapshots stay immutable.
UPDATE caldova.commercial_policies
SET version='2.0-USD',wording=replace(wording,'EUR','USD')
WHERE policy_id='COMMERCIAL-2026' AND version='1.0';
INSERT INTO caldova.decision_documents(source_reference,content)
SELECT policy_id || '-v' || version,wording FROM caldova.commercial_policies
WHERE policy_id='COMMERCIAL-2026'
ON CONFLICT DO NOTHING;
-- Existing EUR packets stay in history; only new USD contexts enter this pipeline.
CREATE TABLE IF NOT EXISTS caldova.usd_context (
    id integer PRIMARY KEY REFERENCES caldova.evaluations,
    content text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Rename presentation columns without dropping dependent views.
DO $$
BEGIN
 IF EXISTS(SELECT FROM information_schema.columns WHERE table_schema='caldova'
   AND table_name='demo_options' AND column_name='extra_budget_eur') THEN
   ALTER VIEW caldova.demo_options RENAME COLUMN extra_budget_eur TO extra_budget_usd;
   ALTER VIEW caldova.demo_allocation RENAME COLUMN extra_budget_eur TO extra_budget_usd;
   ALTER VIEW caldova.demo_commitment RENAME COLUMN budget_eur TO budget_usd;
 END IF;
END $$;
COMMIT;
