\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS caldova.agent_jobs (
    id uuid PRIMARY KEY,
    principal text NOT NULL,
    request_key text NOT NULL,
    question text NOT NULL,
    budget_usd numeric NOT NULL CHECK (budget_usd BETWEEN 0 AND 1000000),
    case_id text NOT NULL UNIQUE,
    request_id integer REFERENCES caldova.planning_requests,
    evaluation_id integer REFERENCES caldova.evaluations,
    state text NOT NULL DEFAULT 'queued',
    error text,
    evidence_run_id text,
    recommendation_run_id text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(principal,request_key)
);
CREATE TABLE IF NOT EXISTS caldova.agent_reviews (
    token uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES caldova.agent_jobs,
    principal text NOT NULL,
    evaluation_id integer NOT NULL REFERENCES caldova.evaluations,
    input_hash text NOT NULL,
    brief_hash text NOT NULL,
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
    approved_plan_id integer REFERENCES caldova.approved_plans,
    approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS caldova.agent_run_links (
    job_id uuid REFERENCES caldova.agent_jobs,
    pipeline_name text NOT NULL,
    run_id text NOT NULL,
    PRIMARY KEY(job_id,pipeline_name)
);

-- Every newly approved plan gets the same deterministic conversation starter,
-- including approvals made through SQL instead of the agent.
CREATE OR REPLACE FUNCTION caldova.enrich_production_request() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE p caldova.approved_plans; r caldova.planning_requests;
BEGIN
 SELECT * INTO STRICT p FROM caldova.approved_plans WHERE id=NEW.approved_plan_id;
 SELECT * INTO STRICT r FROM caldova.planning_requests WHERE id=p.request_id;
 NEW.payload:=NEW.payload || jsonb_build_object(
   'recipient','Karin Blair','team','Production planning',
   'requested_action','Confirm production capacity while protecting existing orders',
   'reason','Campaign demand exceeds available stock and confirmed supply',
   'conversation_starter',format(
     'Karin, I approved the %s campaign with USD %s additional investment. We expect %s additional units over %s weeks; %s units require production confirmation. Can production absorb this without affecting existing orders? Approved evaluation: %s. Case: %s.',
     r.product,to_char((p.approved_forecast->>'extra_budget_usd')::numeric,'FM999,999,990'),
     to_char((p.approved_forecast->>'incremental_units')::numeric,'FM999,999,990'),r.weeks,
     to_char(NEW.required_units,'FM999,999,990'),p.evaluation_id,r.case_id));
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER production_conversation BEFORE INSERT ON caldova.production_requests
FOR EACH ROW EXECUTE FUNCTION caldova.enrich_production_request();
