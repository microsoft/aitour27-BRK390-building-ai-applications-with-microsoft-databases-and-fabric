\set ON_ERROR_STOP on
-- Transactional regression checks: changed inputs must change the decision.
-- All test records and fact changes are rolled back. No AI calls are made here.
BEGIN;
DO $$
DECLARE req integer; ev integer; result jsonb; failed boolean;
BEGIN
 INSERT INTO caldova.planning_requests(case_id,question,weeks,budget_limit)
 VALUES('TEST-' || clock_timestamp(),'Verify decision rules',6,30000) RETURNING id INTO req;
 ev:=caldova.evaluate_request(req);
 SELECT o.result INTO result FROM caldova.evaluated_options o WHERE evaluation_id=ev AND scenario='targeted';
 IF (result->>'incremental_units')::integer<>57000 OR (result->>'proposed_units')::integer<>373667
 OR (result->>'production_gap_units')::integer<>57000 OR (result->>'low_incremental_units')::integer<>50400
 OR (result->>'high_incremental_units')::integer<>63600
 OR (result->>'uplift_percent')::numeric<>18.0 THEN
   RAISE EXCEPTION 'Default fixture arithmetic failed';
 END IF;
 IF (SELECT (o.result->>'eligible')::boolean FROM caldova.evaluated_options o
     WHERE evaluation_id=ev AND scenario='broad') THEN
   RAISE EXCEPTION 'Broad allocation must fail channel capacity';
 END IF;
 failed:=false;
 BEGIN PERFORM caldova.approve_evaluation(ev);
 EXCEPTION WHEN no_data_found THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Approval allowed without generated brief'; END IF;

 UPDATE caldova.planning_requests SET budget_limit=10000 WHERE id=req;
 SELECT o.result INTO result FROM caldova.calculate_options(req) o WHERE scenario='targeted';
 IF (result->>'incremental_units')::integer<>20000 THEN RAISE EXCEPTION 'Budget does not drive allocation'; END IF;
 UPDATE caldova.planning_requests SET budget_limit=30000 WHERE id=req;

 UPDATE caldova.market_facts SET channel_headroom=0 WHERE region='North America';
 SELECT o.result INTO result FROM caldova.calculate_options(req) o WHERE scenario='targeted';
 IF (result->>'incremental_units')::integer<>29000 OR (result->>'extra_budget_usd')::integer<>22000 THEN
   RAISE EXCEPTION 'Channel capacity does not change allocation'; END IF;
 failed:=false;
 BEGIN PERFORM caldova.approve_evaluation(ev);
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'Inputs changed%' THEN RAISE; END IF; failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Stale evaluation allowed'; END IF;
 UPDATE caldova.market_facts SET channel_headroom=18000 WHERE region='North America';

 UPDATE caldova.linked_evidence SET metadata=jsonb_set(metadata,'{outlook_weeks}','2')
 WHERE metadata->>'source_reference'='OUTLOOK-North America';
 SELECT o.result INTO result FROM caldova.calculate_options(req) o WHERE scenario='targeted';
 IF (result->>'incremental_units')::integer<>29000 THEN
   RAISE EXCEPTION 'Extracted outlook duration does not affect region selection'; END IF;
 UPDATE caldova.linked_evidence SET metadata=jsonb_set(metadata,'{outlook_weeks}','6')
 WHERE metadata->>'source_reference'='OUTLOOK-North America';

 UPDATE caldova.market_facts SET confirmed_receipts=confirmed_receipts+36000 WHERE region='North America';
 UPDATE caldova.market_facts SET confirmed_receipts=confirmed_receipts+21000 WHERE region='Europe';
 SELECT o.result INTO result FROM caldova.calculate_options(req) o WHERE scenario='targeted';
 IF (result->>'production_gap_units')::integer<>0 THEN RAISE EXCEPTION 'Supply warning is not derived from receipts'; END IF;

 UPDATE caldova.commercial_policies SET status='draft';
 failed:=false;
 BEGIN PERFORM caldova.evaluate_request(req);
 EXCEPTION WHEN raise_exception THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Draft policy accepted'; END IF;
 UPDATE caldova.commercial_policies SET status='approved';

 UPDATE caldova.decision_documents SET content=content || ' Updated outlook.' WHERE region='Europe';
 failed:=false;
 BEGIN PERFORM caldova.evaluate_request(req);
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'Missing/stale AI evidence%' THEN RAISE; END IF; failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Stale extraction accepted'; END IF;
 RAISE NOTICE 'PASS: baseline, budget, channel, extracted outlook, supply, approved policy, stale evidence, and approval prerequisites';
END $$;
ROLLBACK;
