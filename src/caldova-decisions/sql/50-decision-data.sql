\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS caldova.planning_requests (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id text NOT NULL UNIQUE,
    question text NOT NULL,
    product text NOT NULL DEFAULT 'Hydration Sunscreen',
    owner_name text NOT NULL DEFAULT 'Tim de Boer',
    owner_role name NOT NULL DEFAULT current_user,
    planning_date date NOT NULL DEFAULT '2026-09-17',
    weeks integer NOT NULL CHECK (weeks BETWEEN 1 AND 12),
    budget_limit numeric NOT NULL CHECK (budget_limit >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS caldova.market_facts (
    region text PRIMARY KEY,
    product text NOT NULL DEFAULT 'Hydration Sunscreen',
    baseline_units integer NOT NULL CHECK (baseline_units > 0),
    stock_units integer NOT NULL CHECK (stock_units >= 0),
    reserved_units integer NOT NULL CHECK (reserved_units >= 0),
    confirmed_receipts integer NOT NULL CHECK (confirmed_receipts >= 0),
    channel_headroom numeric NOT NULL CHECK (channel_headroom >= 0),
    snapshot_date date NOT NULL DEFAULT '2026-09-17',
    horizon_weeks integer NOT NULL DEFAULT 6
);
CREATE TABLE IF NOT EXISTS caldova.campaign_history (
    campaign_id text PRIMARY KEY,
    region text NOT NULL REFERENCES caldova.market_facts,
    product text NOT NULL DEFAULT 'Hydration Sunscreen',
    extra_spend numeric NOT NULL CHECK (extra_spend > 0),
    incremental_units integer NOT NULL CHECK (incremental_units >= 0),
    method text NOT NULL DEFAULT 'Matched-market comparison; fictional demo fixture',
    completed_on date NOT NULL DEFAULT '2026-08-01'
);
CREATE TABLE IF NOT EXISTS caldova.commercial_policies (
    policy_id text PRIMARY KEY,
    version text NOT NULL,
    wording text NOT NULL,
    status text NOT NULL CHECK (status IN ('approved','draft')),
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    max_extra_budget numeric NOT NULL,
    min_comparisons integer NOT NULL,
    production_confirmation_required boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS caldova.decision_documents (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_reference text NOT NULL UNIQUE,
    region text REFERENCES caldova.market_facts,
    version integer NOT NULL DEFAULT 1,
    content text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS caldova.decision_evidence (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb
);
CREATE TABLE IF NOT EXISTS caldova.evaluations (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id integer NOT NULL REFERENCES caldova.planning_requests,
    input_snapshot jsonb NOT NULL,
    input_hash text NOT NULL,
    selected_scenario text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS caldova.evaluated_options (
    evaluation_id integer REFERENCES caldova.evaluations,
    scenario text,
    result jsonb NOT NULL,
    PRIMARY KEY (evaluation_id, scenario)
);
CREATE TABLE IF NOT EXISTS caldova.decision_context (
    id integer PRIMARY KEY REFERENCES caldova.evaluations,
    content text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS caldova.decision_briefs (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb, generated_text text
);
CREATE TABLE IF NOT EXISTS caldova.reviewed_briefs (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb, generated_text text
);
CREATE TABLE IF NOT EXISTS caldova.linked_evidence (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb
);
CREATE TABLE IF NOT EXISTS caldova.linked_briefs (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb, generated_text text
);
CREATE TABLE IF NOT EXISTS caldova.final_briefs (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb, generated_text text
);
CREATE TABLE IF NOT EXISTS caldova.usd_briefs (
    doc_id integer, chunk_index integer, chunk_text text, metadata jsonb, generated_text text
);
CREATE TABLE IF NOT EXISTS caldova.approved_plans (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evaluation_id integer NOT NULL UNIQUE REFERENCES caldova.evaluations,
    request_id integer NOT NULL UNIQUE REFERENCES caldova.planning_requests,
    owner_name text NOT NULL,
    approved_by name NOT NULL,
    approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    marketing_status text NOT NULL DEFAULT 'approved',
    production_status text NOT NULL,
    input_hash text NOT NULL,
    approved_forecast jsonb NOT NULL,
    approved_brief text NOT NULL
);
CREATE TABLE IF NOT EXISTS caldova.production_requests (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    approved_plan_id integer NOT NULL UNIQUE REFERENCES caldova.approved_plans,
    case_id text NOT NULL,
    required_units integer NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO caldova.market_facts(region,baseline_units,stock_units,reserved_units,confirmed_receipts,channel_headroom) VALUES
('North America',106667,60000,10000,56667,18000),
('Europe',90000,50000,10000,50000,12000),
('Asia Pacific',70000,40000,10000,40000,10000),
('Latin America',50000,30000,10000,30000,0)
ON CONFLICT DO NOTHING;
INSERT INTO caldova.campaign_history(campaign_id,region,extra_spend,incremental_units)
SELECT 'HIST-' || region || '-' || n, region, spend, units
FROM (VALUES
('North America',1,18000,32400),('North America',2,18000,36000),('North America',3,18000,39600),
('Europe',1,12000,18000),('Europe',2,12000,21000),('Europe',3,12000,24000),
('Asia Pacific',1,10000,6000),('Asia Pacific',2,10000,8000),('Asia Pacific',3,10000,10000),
('Latin America',1,10000,8000),('Latin America',2,10000,10000),('Latin America',3,10000,12000)
) h(region,n,spend,units) ON CONFLICT DO NOTHING;
INSERT INTO caldova.commercial_policies VALUES
('COMMERCIAL-2026','1.0',
 'Approve at most USD 30000 additional spend. Respect regional channel headroom. Require at least three comparable campaigns. Marketing may approve a demand plan with a supply gap, but campaign activation requires production confirmation. Protect existing orders.',
 'approved','2026-01-01','2026-12-31',30000,3,true)
ON CONFLICT DO NOTHING;
INSERT INTO caldova.decision_documents(source_reference,region,content)
SELECT 'OUTLOOK-' || region, region,
 format('Fabric regional outlook for %s, Hydration Sunscreen, version 1, as of September 17 2026. Fictional demo evidence. Demand is expected to remain elevated for 6 weeks. The revised baseline already includes this increase. Additional advertising is supported by regional demand. Assumption: the illustrative extended weather outlook holds; it is not a guaranteed forecast.',region)
FROM caldova.market_facts ON CONFLICT DO NOTHING;
INSERT INTO caldova.decision_documents(source_reference,content)
SELECT policy_id || '-v' || version, wording FROM caldova.commercial_policies
ON CONFLICT DO NOTHING;
-- Chunk IDs are batch-local in the installed preview. Carry an explicit business
-- reference in the input; downstream joins also require exact source-text equality.
CREATE TABLE IF NOT EXISTS caldova.evidence_packets (
    id integer PRIMARY KEY REFERENCES caldova.decision_documents,
    content text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO caldova.evidence_packets(id,content)
SELECT id,'Evidence reference: ' || source_reference || E'\n' || content
FROM caldova.decision_documents ON CONFLICT DO NOTHING;
COMMIT;
