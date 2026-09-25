\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS caldova;

CREATE TABLE IF NOT EXISTS caldova.regional_scenario (
    region text PRIMARY KEY,
    baseline_units integer NOT NULL CHECK (baseline_units > 0),
    extra_budget_usd numeric(12,2) NOT NULL CHECK (extra_budget_usd >= 0),
    incremental_units_per_usd numeric(8,4) NOT NULL,
    channel_headroom_usd numeric(12,2) NOT NULL,
    evidence_reference text NOT NULL,
    CHECK (extra_budget_usd <= channel_headroom_usd)
);

-- Fictional regional labels; map to Act One's final region identifiers before recording.
INSERT INTO caldova.regional_scenario VALUES
('North America', 106667, 18000, 2.00, 18000, 'CAMPAIGN-NA-2025'),
('Europe',         90000, 12000, 1.75, 12000, 'CAMPAIGN-EU-2025'),
('Asia Pacific',   70000,     0, 0.80, 10000, 'CAMPAIGN-APAC-2025'),
('Latin America',  50000,     0, 1.00,     0, 'CAMPAIGN-LATAM-2025')
ON CONFLICT (region) DO NOTHING;

CREATE OR REPLACE VIEW caldova.campaign_numbers AS
SELECT 'CASE-LAUNCH-001'::text AS case_id,
       'Hydration Sunscreen'::text AS product,
       sum(baseline_units)::integer AS baseline_units,
       sum(extra_budget_usd) AS extra_budget_usd,
       sum(round(extra_budget_usd * incremental_units_per_usd))::integer
           AS incremental_units,
       (sum(baseline_units) + sum(round(extra_budget_usd * incremental_units_per_usd)))::integer
           AS proposed_units,
       round(100 * sum(round(extra_budget_usd * incremental_units_per_usd))
           / sum(baseline_units), 1) AS uplift_percent
FROM caldova.regional_scenario;

CREATE TABLE IF NOT EXISTS caldova.proposal_context (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id text NOT NULL,
    proposal_version integer NOT NULL,
    content text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (case_id, proposal_version)
);

-- One short, versioned input contains SQL-calculated facts and narrative evidence.
-- The model interprets the text; it does not invent or calculate the forecast.
INSERT INTO caldova.proposal_context (case_id, proposal_version, content)
SELECT case_id, 1, format(
$context$Caldova campaign case %s, proposal version 1, fictional demo data.
Tim de Boer asks: Should we increase Hydration Sunscreen investment over the next six weeks?
Act One evidence FABRIC-OUTLOOK-001: sales exceed the original forecast in four regions.
The illustrative extended El Nino outlook supports sustained demand. The revised
no-extra-spend baseline already includes weather-related growth.

SQL-evaluated comparison:
Keep current investment: %s units over six weeks; zero extra campaign spend.
Targeted increase: USD %s extra spend; %s incremental units; %s total units.
Uplift: %s percent, rounded to one decimal place.
Regional allocation: North America USD 18000, 36000 incremental units;
Europe USD 12000, 21000 incremental units. No extra spend in Asia Pacific or Latin America.
Historical central response assumptions: North America 2.00 additional units per US dollar
(CAMPAIGN-NA-2025), Europe 1.75 (CAMPAIGN-EU-2025). Asia Pacific has a weaker
0.80 response; Latin America has no extra channel headroom.

Commercial rule COMMERCIAL-2026-v1: extra budget must not exceed USD 30000;
regional spend must fit channel headroom. Both checks pass in this fixture.
Assumptions: the six-week demand outlook holds and historical response remains applicable.
The forecast is a scenario estimate, not a guaranteed outcome.
Supply condition: launch stock is assumed adequate; the 57000 extra units require
factory confirmation. Detailed time-phased inventory has not yet been validated.
Production status: confirmation required. Marketing status: awaiting Tim's approval.
The marketing proposal does not know the factory maintenance schedule.
Recommend the targeted increase for Tim's review, explicitly retaining the production dependency.
$context$, case_id, baseline_units, extra_budget_usd, incremental_units,
proposed_units, uplift_percent)
FROM caldova.campaign_numbers
ON CONFLICT (case_id, proposal_version) DO NOTHING;

COMMIT;
SELECT * FROM caldova.campaign_numbers;
