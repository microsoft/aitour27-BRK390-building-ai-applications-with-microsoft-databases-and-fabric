from decision_memory.capture import build_case, source_turns, swapped_allocation


def sample():
    return {
        'case':{'case_id':'HYDRATION-SUNSCREEN-CAMPAIGN-001','required_units':57000,'description':'Materials ready day 3'},
        'production':{'id':6,'snapshot_hash':'production-hash','snapshot':{'maintenance':[{'id':'MW-77'}]},
          'approved_by':'karin-id','approved_at':'2026-09-18T06:17:48+00:00',
          'result':{'allocations':[{'line':'PKG-01','day':6,'units':22800},{'line':'PKG-03','day':3,'units':34200}],
          'transferred_units':22800,'transferred_percent':40,'bring_forward_days':3,
          'maintenance_preserved':True,'existing_orders_preserved':True,'scheduled_units':57000}},
        'marketing':{'id':4,'evaluation_id':14,'input_hash':'marketing-hash','approved_at':'2026-09-17T06:00:00+00:00',
           'approved_forecast':{'extra_budget_usd':30000,'policy_reference':'COMMERCIAL-2026-v2.0-USD'}},
        'thread':{'conversation_id':'thread-1','tenant_id':'tenant-1'},
        'turns':[{'activity_id':'turn-1','user_id':'karin-id','question':'Keep MW-77 in place and protect existing orders.',
                  'answer':'Production proposal 6','created_at':'2026-09-18T06:16:00+00:00'}]
    }


def test_case_preserves_authoritative_values_and_pending_outcome():
    doc=build_case(sample())
    assert doc['actualOutcome']['status']=='pending'
    assert doc['trigger']['additionalBudgetUsd']==30000
    assert doc['decision']['transferredUnits']==22800
    assert doc['approval']['approverObjectId']=='karin-id'
    assert doc['humanJudgment']['constraints'][0]['activityId']=='turn-1'
    assert doc['memory']['userId']=='caldova-case-6'


def test_turns_distinguish_business_records_from_actual_conversation():
    s=sample();doc=build_case(s);turns=source_turns(s,doc)
    assert turns[0]['role']=='system' and 'not a Teams message' in turns[0]['content']
    assert turns[1]['content']==s['turns'][0]['question']
    assert turns[2]['role']=='agent'
    assert 'PENDING' in turns[-1]['content']
    assert len({t['source_id'] for t in turns})==len(turns)


def test_known_summary_transposition_is_rejected():
    assert swapped_allocation({'content':'PKG-03 for 22,800 units'})
    assert swapped_allocation({'metadata':{'structured_summary':{'key_points':['PKG-01 would produce 34200 units']}}})
    assert not swapped_allocation({'content':'PKG-01 would produce 22800 units; PKG-03 would produce 34200 units'})
