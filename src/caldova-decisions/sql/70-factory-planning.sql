\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS factory;
CREATE TABLE IF NOT EXISTS factory.cases (
    case_id text PRIMARY KEY,
    marketing_plan_id integer NOT NULL UNIQUE REFERENCES caldova.approved_plans,
    product text NOT NULL,
    required_units integer NOT NULL CHECK(required_units>0),
    planned_line text NOT NULL,
    planned_start_day integer NOT NULL,
    required_day integer NOT NULL,
    earliest_day integer NOT NULL,
    approval_user_id text NOT NULL,
    description text NOT NULL
);
CREATE TABLE IF NOT EXISTS factory.daily_capacity (
    line text NOT NULL,
    day integer NOT NULL,
    gross_units integer NOT NULL CHECK(gross_units>=0),
    existing_order_units integer NOT NULL CHECK(existing_order_units>=0 AND existing_order_units<=gross_units),
    compatible_product text NOT NULL,
    PRIMARY KEY(line,day)
);
CREATE TABLE IF NOT EXISTS factory.maintenance (
    id text PRIMARY KEY,
    line text NOT NULL,
    start_day integer NOT NULL,
    end_day integer NOT NULL,
    locked boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS factory.proposals (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id text NOT NULL REFERENCES factory.cases,
    snapshot_hash text NOT NULL,
    snapshot jsonb NOT NULL,
    result jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    approved_by text,
    approved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_approved_factory_proposal
ON factory.proposals(case_id) WHERE approved_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS factory.allocations (
    proposal_id integer NOT NULL REFERENCES factory.proposals,
    line text NOT NULL,
    day integer NOT NULL,
    units integer NOT NULL CHECK(units>0),
    PRIMARY KEY(proposal_id,line,day),
    FOREIGN KEY(line,day) REFERENCES factory.daily_capacity
);
CREATE TABLE IF NOT EXISTS factory.threads (
    tenant_id text NOT NULL,
    conversation_id text NOT NULL,
    case_id text NOT NULL REFERENCES factory.cases,
    last_proposal_id integer REFERENCES factory.proposals,
    PRIMARY KEY(tenant_id,conversation_id)
);
CREATE TABLE IF NOT EXISTS factory.turns (
    tenant_id text NOT NULL,
    conversation_id text NOT NULL,
    activity_id text NOT NULL,
    user_id text NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(tenant_id,conversation_id,activity_id)
);
-- Daily gross capacity and already-committed orders are separate facts.
-- These fictional facts support the slide; every answer is calculated from them.
INSERT INTO factory.daily_capacity
SELECT 'PKG-03',day,20000,
 CASE WHEN day BETWEEN 3 AND 5 THEN 8600
      WHEN day BETWEEN 6 AND 10 THEN 0 ELSE 20000 END,
 'Hydration Sunscreen' FROM generate_series(1,15) day
ON CONFLICT DO NOTHING;
INSERT INTO factory.daily_capacity
SELECT 'PKG-01',day,12000,
 CASE WHEN day BETWEEN 6 AND 10 THEN 7440 ELSE 12000 END,
 'Hydration Sunscreen' FROM generate_series(1,15) day
ON CONFLICT DO NOTHING;
INSERT INTO factory.maintenance VALUES('MW-77','PKG-03',6,10,true)
ON CONFLICT DO NOTHING;
COMMIT;
