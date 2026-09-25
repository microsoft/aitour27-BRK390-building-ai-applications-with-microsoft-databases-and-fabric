from copy import deepcopy
import os
import uuid
import pytest

from factory_agent.planner import assess, propose, fingerprint


def fixture():
    return {'case': {'planned_line':'PKG-03','planned_start_day':6,'required_day':10,
                     'earliest_day':3,'required_units':57000,'product':'Hydration Sunscreen'},
            'maintenance':[{'id':'MW-77','line':'PKG-03','start_day':6,'end_day':10}],
            'reservations':[], 'capacity':[
                {'line':line,'day':day,'gross_units':gross,'existing_order_units':orders,
                 'compatible_product':'Hydration Sunscreen'}
                for line,day,gross,orders in
                [('PKG-03',d,20000,8600) for d in range(3,6)] +
                [('PKG-03',d,20000,0) for d in range(6,11)] +
                [('PKG-01',d,12000,7440) for d in range(6,11)]]}


def test_conflict_and_split_are_calculated():
    facts=fixture()
    assert assess(facts)['at_risk_units']==57000
    result=propose(facts)
    assert result['feasible']
    assert result['transferred_units']==22800
    assert result['transferred_percent']==40
    assert sum(a['units'] for a in result['allocations'] if a['line']=='PKG-03')==34200
    assert all(a['day']<6 for a in result['allocations'] if a['line']=='PKG-03')


def test_altered_constraints_produce_different_answers():
    assert propose(fixture(),allow_alternate_line=False)['uncovered_units']==22800
    assert propose(fixture(),bring_forward_days=0)['uncovered_units']==34200
    assert propose(fixture(),bring_forward_days=2)['uncovered_units']==11400
    facts=fixture();facts['maintenance']=[]
    assert assess(facts)['at_risk_units']==0
    facts=fixture();facts['reservations']=[{'line':'PKG-01','day':6,'units':4560}]
    assert propose(facts)['uncovered_units']==4560


def test_snapshot_changes_and_bad_constraint_rejected():
    facts=fixture();changed=deepcopy(facts);changed['case']['required_units']=20000
    assert fingerprint(facts)!=fingerprint(changed)
    with pytest.raises(ValueError):propose(facts,bring_forward_days=4)


@pytest.mark.skipif(not os.environ.get('CALDOVA_FACTORY_LIVE_TEST'),reason='Uses live SQL AI extraction')
def test_live_natural_language_planning():
    from factory_agent.service import handle
    tenant=os.environ['ENTRA_TENANT_ID']
    karin=os.environ['FACTORY_KARIN_ID']
    thread='factory-check-'+uuid.uuid4().hex
    case='HYDRATION-SUNSCREEN-CAMPAIGN-001'
    answer=handle(tenant,thread,'1',karin,'Can PKG-03 absorb the approved campaign without affecting existing orders?',case)
    assert '57,000' in answer and 'MW-77' in answer
    answer=handle(tenant,thread,'2',karin,'Keep the maintenance window and customer orders. What alternatives do I have?',case)
    assert '22,800' in answer and '34,200' in answer
    answer=handle(tenant,thread,'3',karin,'What if PKG-01 is unavailable? Do not use an alternate line.',case)
    assert '22,800' in answer and 'cannot be approved' in answer


@pytest.mark.skipif(not os.environ.get('CALDOVA_FACTORY_LIVE_TEST'),reason='Uses live database in a rolled-back transaction')
def test_live_approval_permissions_freshness_and_idempotency():
    from app.service import connect
    from factory_agent.service import snapshot,approve
    from psycopg.types.json import Jsonb
    with connect() as c:
        facts=snapshot(c,'HYDRATION-SUNSCREEN-CAMPAIGN-001')
        result=propose(facts)
        row=c.execute('''INSERT INTO factory.proposals(case_id,snapshot_hash,snapshot,result,created_by)
            VALUES(%s,%s,%s,%s,%s) RETURNING id''',
            (facts['case']['case_id'],fingerprint(facts),Jsonb(facts),Jsonb(result),'test')).fetchone()
        with pytest.raises(ValueError,match='Only Karin'):
            approve(c,facts['case']['case_id'],row['id'],os.environ['FACTORY_TIM_ID'])
        c.execute("UPDATE factory.daily_capacity SET existing_order_units=existing_order_units+1 WHERE line='PKG-01' AND day=6")
        with pytest.raises(ValueError,match='changed'):
            approve(c,facts['case']['case_id'],row['id'],facts['case']['approval_user_id'])
        c.execute("UPDATE factory.daily_capacity SET existing_order_units=existing_order_units-1 WHERE line='PKG-01' AND day=6")
        assert 'approved and recorded' in approve(c,facts['case']['case_id'],row['id'],facts['case']['approval_user_id'])
        assert 'already approved' in approve(c,facts['case']['case_id'],row['id'],facts['case']['approval_user_id'])
        assert c.execute('SELECT sum(units) AS total FROM factory.allocations WHERE proposal_id=%s',(row['id'],)).fetchone()['total']==57000
        c.rollback()
