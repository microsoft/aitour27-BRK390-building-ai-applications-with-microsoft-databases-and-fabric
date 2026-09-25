\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION caldova.refresh_evidence_packets() RETURNS void LANGUAGE sql AS $$
INSERT INTO caldova.evidence_packets(id,content)
SELECT id,'Evidence reference: ' || source_reference || E'\n' || content
FROM caldova.decision_documents
ON CONFLICT(id) DO UPDATE SET content=excluded.content,updated_at=clock_timestamp()
WHERE caldova.evidence_packets.content IS DISTINCT FROM excluded.content;
$$;

CREATE OR REPLACE VIEW caldova.current_evidence AS
SELECT d.id, d.source_reference, d.region, d.version, e.metadata
FROM caldova.decision_documents d
JOIN LATERAL (
    SELECT metadata FROM caldova.linked_evidence
    WHERE metadata->>'source_reference'=d.source_reference
      AND chunk_text='Evidence reference: ' || d.source_reference || E'\n' || d.content AND chunk_index=0
    ORDER BY metadata::text LIMIT 1
) e ON true;

CREATE OR REPLACE FUNCTION caldova.decision_snapshot(p_request integer)
RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
 'request',(SELECT to_jsonb(r) FROM caldova.planning_requests r WHERE id=p_request),
 'markets',(SELECT jsonb_agg(to_jsonb(m) ORDER BY region) FROM caldova.market_facts m),
 'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY campaign_id) FROM caldova.campaign_history h),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policy_id) FROM caldova.commercial_policies p),
 'documents',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM caldova.decision_documents d),
 'extracted_evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM caldova.current_evidence e)
);
$$;

CREATE OR REPLACE FUNCTION caldova.calculate_options(p_request integer)
RETURNS TABLE(scenario text, result jsonb) LANGUAGE sql STABLE AS $$
WITH request AS (
 SELECT * FROM caldova.planning_requests WHERE id=p_request
), policy AS (
 SELECT p.* FROM caldova.commercial_policies p CROSS JOIN request r
 WHERE status='approved' AND valid_from<=r.planning_date
 AND valid_until>=r.planning_date + r.weeks*7
), history AS (
 SELECT h.region, count(*) AS comparisons, avg(incremental_units/extra_spend) AS rate,
 min(incremental_units/extra_spend) AS low_rate, max(incremental_units/extra_spend) AS high_rate,
 max(extra_spend) AS observed_spend_limit,
 jsonb_agg(campaign_id ORDER BY campaign_id) AS history_references
 FROM caldova.campaign_history h CROSS JOIN request r
 WHERE h.product=r.product AND h.completed_on<r.planning_date GROUP BY h.region
), markets AS (
 SELECT m.*, h.comparisons,h.rate,h.low_rate,h.high_rate,h.observed_spend_limit,
   h.history_references,e.source_reference, e.metadata,
   (e.metadata->>'demand_supported')::boolean IS TRUE
   AND (e.metadata->>'outlook_weeks')::integer>=r.weeks AS outlook_ok,
   least(m.channel_headroom,h.observed_spend_limit) AS spend_cap
 FROM caldova.market_facts m JOIN history h USING(region)
 JOIN caldova.current_evidence e ON e.region=m.region CROSS JOIN request r
 WHERE m.product=r.product
), ranked AS (
 SELECT m.*,
 CASE WHEN outlook_ok AND comparisons>=(SELECT min_comparisons FROM policy)
 THEN spend_cap ELSE 0 END AS eligible_cap,
 least(r.budget_limit,(SELECT max_extra_budget FROM policy)) AS allowed_budget
 FROM markets m CROSS JOIN request r
), allocations AS (
 SELECT 'current'::text AS scenario, region, 0::numeric AS spend FROM ranked
 UNION ALL
 SELECT 'broad',region, floor(r.budget_limit/(SELECT count(*) FROM ranked))
 FROM ranked CROSS JOIN request r
 UNION ALL
 SELECT 'targeted',region,
 greatest(0,least(eligible_cap,allowed_budget-coalesce(sum(eligible_cap) OVER (
 ORDER BY rate DESC, region ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0)))
 FROM ranked
), detail AS (
 SELECT a.scenario,m.region,a.spend,m.baseline_units,
 round(a.spend*m.rate)::integer AS incremental_units,
 round(a.spend*m.low_rate)::integer AS low_units,
 round(a.spend*m.high_rate)::integer AS high_units,
 greatest(0,m.baseline_units+round(a.spend*m.rate)-
   (m.stock_units-m.reserved_units+m.confirmed_receipts))::integer AS production_gap_units,
 m.stock_units-m.reserved_units>=ceil((m.baseline_units+round(a.spend*m.rate))/r.weeks) AS launch_stock_ok,
 a.spend<=m.channel_headroom AS channel_ok,
 a.spend<=m.observed_spend_limit AS historical_range_ok,
 a.spend=0 OR (m.outlook_ok AND m.comparisons>=(SELECT min_comparisons FROM policy)) AS evidence_ok,
 m.source_reference,m.history_references,m.comparisons,m.metadata->>'assumptions' AS assumptions
 FROM allocations a JOIN ranked m USING(region) CROSS JOIN request r
), totals AS (
 SELECT d.scenario,sum(spend) AS extra_budget_usd,sum(baseline_units) AS baseline_units,
 sum(incremental_units) AS incremental_units,sum(baseline_units+incremental_units) AS proposed_units,
 sum(low_units) AS low_incremental_units,sum(high_units) AS high_incremental_units,
 sum(production_gap_units) AS production_gap_units,
 bool_and(channel_ok) AS channel_ok,bool_and(historical_range_ok) AS historical_range_ok,
 bool_and(evidence_ok) AS evidence_ok,bool_and(launch_stock_ok) AS launch_stock_ok,
 jsonb_agg(to_jsonb(d)-'scenario' ORDER BY region) AS regions
 FROM detail d GROUP BY d.scenario
)
SELECT t.scenario,to_jsonb(t)-'scenario' || jsonb_build_object(
 'currency','USD',
 'budget_ok',extra_budget_usd<=least(r.budget_limit,p.max_extra_budget),
 'eligible',channel_ok AND historical_range_ok AND evidence_ok AND launch_stock_ok
    AND extra_budget_usd<=least(r.budget_limit,p.max_extra_budget),
 'uplift_percent',round(incremental_units*100.0/baseline_units,1),
 'policy_reference',p.policy_id || '-v' || p.version,
 'production_status',CASE WHEN production_gap_units>0 AND p.production_confirmation_required
    THEN 'confirmation required' ELSE 'covered by confirmed supply' END,
 'evidence_confidence',CASE WHEN incremental_units=0 THEN 'Baseline only; no incremental response estimate'
    ELSE 'Moderate: at least three matched-market comparisons per funded region; future weather and response remain uncertain' END,
 'range_meaning','Low/high historical response scenarios, not a statistical confidence interval')
FROM totals t CROSS JOIN request r CROSS JOIN policy p;
$$;

CREATE OR REPLACE FUNCTION caldova.evaluate_request(p_request integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_id integer; v_snapshot jsonb; v_selected text; v_options jsonb;
        v_request caldova.planning_requests;
BEGIN
 SELECT * INTO STRICT v_request FROM caldova.planning_requests WHERE id=p_request FOR UPDATE;
 LOCK TABLE caldova.market_facts,caldova.campaign_history,caldova.commercial_policies,
   caldova.decision_documents,caldova.linked_evidence IN SHARE MODE;
 IF EXISTS(SELECT FROM caldova.approved_plans WHERE request_id=p_request) THEN
   RAISE EXCEPTION 'Request already approved; create a new request for a revised commitment';
 END IF;
 IF NOT EXISTS(SELECT FROM caldova.commercial_policies p JOIN caldova.decision_documents d
   ON d.source_reference=p.policy_id || '-v' || p.version AND d.content=p.wording
   WHERE p.status='approved' AND p.valid_from<=v_request.planning_date
   AND p.valid_until>=v_request.planning_date+v_request.weeks*7) THEN
   RAISE EXCEPTION 'Approved policy wording/version must match its evidence document';
 END IF;
 IF (SELECT count(*) FROM caldova.commercial_policies
     WHERE status='approved' AND valid_from<=v_request.planning_date
       AND valid_until>=v_request.planning_date+v_request.weeks*7)<>1 THEN
   RAISE EXCEPTION 'Exactly one approved policy covering the planning period is required';
 END IF;
 IF EXISTS(SELECT FROM caldova.market_facts m WHERE m.product=v_request.product AND
    (m.snapshot_date<>v_request.planning_date OR m.horizon_weeks<>v_request.weeks))
    OR NOT EXISTS(SELECT FROM caldova.market_facts WHERE product=v_request.product) THEN
   RAISE EXCEPTION 'Market facts must match the product, date and planning horizon';
 END IF;
 IF EXISTS(SELECT FROM caldova.decision_documents d LEFT JOIN caldova.current_evidence e USING(id)
    WHERE e.id IS NULL OR nullif(e.metadata->>'assumptions','') IS NULL)
    OR EXISTS(SELECT FROM caldova.market_facts m WHERE NOT EXISTS(
       SELECT FROM caldova.current_evidence e WHERE e.region=m.region
       AND e.metadata->>'outlook_weeks' IS NOT NULL
       AND e.metadata->>'demand_supported' IS NOT NULL)) THEN
   RAISE EXCEPTION 'Missing/stale AI evidence; run the evidence pipeline before evaluating';
 END IF;
 IF EXISTS(SELECT FROM caldova.market_facts m WHERE NOT EXISTS(
    SELECT FROM caldova.campaign_history h WHERE h.region=m.region
    AND h.product=v_request.product AND h.completed_on<v_request.planning_date)) THEN
   RAISE EXCEPTION 'Historical comparisons missing for a region';
 END IF;
 v_snapshot:=caldova.decision_snapshot(p_request);
 SELECT scenario INTO v_selected FROM caldova.calculate_options(p_request)
 WHERE (result->>'eligible')::boolean
 ORDER BY (result->>'incremental_units')::numeric DESC,
          (result->>'extra_budget_usd')::numeric,scenario LIMIT 1;
 IF v_selected IS NULL THEN RAISE EXCEPTION 'No feasible campaign option'; END IF;
 INSERT INTO caldova.evaluations(request_id,input_snapshot,input_hash,selected_scenario)
 VALUES(p_request,v_snapshot,md5(v_snapshot::text),v_selected) RETURNING id INTO v_id;
 INSERT INTO caldova.evaluated_options SELECT v_id,scenario,result FROM caldova.calculate_options(p_request);
 SELECT jsonb_agg(jsonb_build_object('scenario',scenario,
 'extra_budget_usd',result->'extra_budget_usd',
 'incremental_units',result->'incremental_units',
 'eligible',result->'eligible',
 'channel_ok',result->'channel_ok',
 'budget_ok',result->'budget_ok',
 'evidence_ok',result->'evidence_ok',
 'launch_stock_ok',result->'launch_stock_ok') ORDER BY scenario)
 INTO v_options FROM caldova.evaluated_options WHERE evaluation_id=v_id;
 INSERT INTO caldova.usd_context(id,content) VALUES(v_id,
 jsonb_build_object('currency','USD','evaluation_id',v_id,'case_id',v_request.case_id,'question',v_request.question,
 'selected_by_sql',v_selected,'comparison',v_options,
 'selected_result',(SELECT result FROM caldova.evaluated_options
    WHERE evaluation_id=v_id AND scenario=v_selected),
 'context','Fictional demo. Baseline already includes weather-related growth. Six-week aggregate supply check; factory scheduling is a separate validation. Marketing approval pending.')::text);
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION caldova.approve_evaluation(p_evaluation integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE ev caldova.evaluations; req caldova.planning_requests; choice jsonb;
        brief caldova.usd_briefs; plan_id integer;
BEGIN
 SELECT * INTO STRICT ev FROM caldova.evaluations WHERE id=p_evaluation;
 SELECT * INTO STRICT req FROM caldova.planning_requests WHERE id=ev.request_id FOR UPDATE;
 IF current_user<>req.owner_role THEN RAISE EXCEPTION 'Only the request owner role can approve'; END IF;
 SELECT id INTO plan_id FROM caldova.approved_plans WHERE evaluation_id=p_evaluation;
 IF plan_id IS NOT NULL THEN RETURN plan_id; END IF;
 IF EXISTS(SELECT FROM caldova.approved_plans WHERE request_id=req.id) THEN
   RAISE EXCEPTION 'Another version of this request is already approved';
 END IF;
 -- Prevent concurrent evidence/fact changes between freshness check and commitment.
 LOCK TABLE caldova.market_facts,caldova.campaign_history,caldova.commercial_policies,
   caldova.decision_documents,caldova.linked_evidence IN SHARE MODE;
 IF md5(caldova.decision_snapshot(req.id)::text)<>ev.input_hash THEN
   RAISE EXCEPTION 'Inputs changed since evaluation; regenerate and review before approval';
 END IF;
 SELECT result INTO STRICT choice FROM caldova.evaluated_options
 WHERE evaluation_id=ev.id AND scenario=ev.selected_scenario;
 SELECT b.* INTO STRICT brief FROM caldova.usd_briefs b
 JOIN caldova.usd_context c ON c.id=ev.id AND b.chunk_text=c.content
 WHERE b.metadata->>'evaluation_id'=ev.id::text;
 IF length(trim(coalesce(brief.generated_text,'')))<50
 OR (brief.metadata->>'extra_budget_usd')::numeric IS DISTINCT FROM (choice->>'extra_budget_usd')::numeric
 OR (brief.metadata->>'incremental_units')::numeric IS DISTINCT FROM (choice->>'incremental_units')::numeric
 OR (brief.metadata->>'proposed_units')::numeric IS DISTINCT FROM (choice->>'proposed_units')::numeric
 OR (brief.metadata->>'uplift_percent')::numeric IS DISTINCT FROM (choice->>'uplift_percent')::numeric
 OR (brief.metadata->>'production_gap_units')::numeric IS DISTINCT FROM (choice->>'production_gap_units')::numeric THEN
   RAISE EXCEPTION 'Brief missing or numerically inconsistent with the evaluated option';
 END IF;
 IF lower(brief.generated_text) NOT LIKE '%marketing approval pending%' THEN
   RAISE EXCEPTION 'Brief must explicitly preserve pending marketing approval';
 END IF;
 IF (brief.metadata->>'current_option_eligible')::boolean IS DISTINCT FROM (
   SELECT (result->>'eligible')::boolean FROM caldova.evaluated_options
   WHERE evaluation_id=ev.id AND scenario='current') THEN
   RAISE EXCEPTION 'Brief misstates current-option eligibility; revise and review';
 END IF;
 INSERT INTO caldova.approved_plans(evaluation_id,request_id,owner_name,approved_by,
 production_status,input_hash,approved_forecast,approved_brief)
 VALUES(ev.id,req.id,req.owner_name,current_user,choice->>'production_status',ev.input_hash,choice,brief.generated_text)
 RETURNING id INTO plan_id;
 IF (choice->>'production_gap_units')::integer>0 THEN
   INSERT INTO caldova.production_requests(approved_plan_id,case_id,required_units,payload)
   VALUES(plan_id,req.case_id,(choice->>'production_gap_units')::integer,
    jsonb_build_object('evaluation_id',ev.id,'product',req.product,'weeks',req.weeks,
     'forecast',choice,'note','Confirm factory schedule and capacity; no maintenance conclusion made by marketing.'));
 END IF;
 RETURN plan_id;
END $$;

CREATE OR REPLACE FUNCTION caldova.reject_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Decision records are immutable; create a new request/evaluation'; END $$;
CREATE OR REPLACE TRIGGER immutable_approved_plan BEFORE UPDATE OR DELETE ON caldova.approved_plans
FOR EACH ROW EXECUTE FUNCTION caldova.reject_record_change();
CREATE OR REPLACE TRIGGER immutable_evaluation BEFORE UPDATE OR DELETE ON caldova.evaluations
FOR EACH ROW EXECUTE FUNCTION caldova.reject_record_change();
CREATE OR REPLACE TRIGGER immutable_options BEFORE UPDATE OR DELETE ON caldova.evaluated_options
FOR EACH ROW EXECUTE FUNCTION caldova.reject_record_change();
CREATE OR REPLACE TRIGGER immutable_context BEFORE UPDATE OR DELETE ON caldova.decision_context
FOR EACH ROW EXECUTE FUNCTION caldova.reject_record_change();
CREATE OR REPLACE TRIGGER immutable_usd_context BEFORE UPDATE OR DELETE ON caldova.usd_context
FOR EACH ROW EXECUTE FUNCTION caldova.reject_record_change();
