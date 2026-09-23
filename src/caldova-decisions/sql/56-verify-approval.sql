\set ON_ERROR_STOP on
-- Verify the canonical recorded decision and idempotent approval.
DO $$
DECLARE ev integer; plan integer; repeated integer; blocked boolean;
BEGIN
 SELECT p.evaluation_id,p.id INTO STRICT ev,plan FROM caldova.approved_plans p
 JOIN caldova.planning_requests r ON r.id=p.request_id WHERE r.case_id='CASE-LAUNCH-USD-001';
 repeated:=caldova.approve_evaluation(ev);
 IF repeated<>plan OR (SELECT count(*) FROM caldova.production_requests WHERE approved_plan_id=plan)<>1 THEN
   RAISE EXCEPTION 'Repeated approval created another commitment or handoff'; END IF;
 IF NOT EXISTS(SELECT FROM caldova.production_requests WHERE approved_plan_id=plan
               AND required_units=57000 AND status='queued') THEN
   RAISE EXCEPTION 'Factory handoff does not match the approved demand'; END IF;
 blocked:=false;
 BEGIN UPDATE caldova.approved_plans SET owner_name='Changed' WHERE id=plan;
 EXCEPTION WHEN raise_exception THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Approved plan can be overwritten'; END IF;
 RAISE NOTICE 'PASS: version-specific approval, single queued handoff, idempotency, immutable commitment';
END $$;
