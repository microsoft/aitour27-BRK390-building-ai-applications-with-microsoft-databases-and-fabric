\set ON_ERROR_STOP on
CREATE OR REPLACE VIEW caldova.demo_options AS
SELECT r.case_id,e.id AS evaluation_id,o.scenario,
 (o.result->>'extra_budget_usd')::numeric AS extra_budget_usd,
 (o.result->>'incremental_units')::integer AS incremental_units,
 (o.result->>'eligible')::boolean AS eligible,
 (o.result->>'channel_ok')::boolean AS channel_ok,
 (o.result->>'production_gap_units')::integer AS production_gap_units,
 o.scenario=e.selected_scenario AS recommended
FROM caldova.evaluated_options o JOIN caldova.evaluations e ON e.id=o.evaluation_id
JOIN caldova.planning_requests r ON r.id=e.request_id
WHERE o.result->>'currency'='USD';

CREATE OR REPLACE VIEW caldova.demo_allocation AS
SELECT r.case_id,e.id AS evaluation_id,region->>'region' AS region,
 (region->>'spend')::numeric AS extra_budget_usd,
 (region->>'incremental_units')::integer AS incremental_units,
 (region->>'launch_stock_ok')::boolean AS launch_stock_ok,
 (region->>'production_gap_units')::integer AS production_gap_units
FROM caldova.evaluated_options o JOIN caldova.evaluations e
ON e.id=o.evaluation_id AND e.selected_scenario=o.scenario
JOIN caldova.planning_requests r ON r.id=e.request_id
CROSS JOIN LATERAL jsonb_array_elements(o.result->'regions') region
WHERE o.result->>'currency'='USD';

CREATE OR REPLACE VIEW caldova.demo_commitment AS
SELECT r.case_id,p.evaluation_id,p.owner_name,p.approved_by,p.approved_at,
 p.marketing_status,p.production_status,
 (p.approved_forecast->>'extra_budget_usd')::numeric AS budget_usd,
 (p.approved_forecast->>'incremental_units')::integer AS additional_units,
 q.status AS factory_request_status,p.input_hash
FROM caldova.approved_plans p JOIN caldova.planning_requests r ON r.id=p.request_id
LEFT JOIN caldova.production_requests q ON q.approved_plan_id=p.id
WHERE p.approved_forecast->>'currency'='USD';
