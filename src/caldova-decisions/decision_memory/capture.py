import json
import os
import re
from datetime import datetime, timedelta, timezone
from importlib.metadata import version

from azure.cosmos import CosmosClient
from azure.cosmos.agent_memory import CosmosMemoryClient
from azure.cosmos.agent_memory.embeddings import EmbeddingsClient
from azure.cosmos.agent_memory.chat import ChatClient
from azure.identity import AzureCliCredential
from psycopg.types.json import Jsonb

from app.service import connect

DATABASE = 'caldova-act2-demo'


class GroundedMemoryChat(ChatClient):
    def generate(self, messages, **kwargs):
        instruction = ('Preserve source attribution and exact line-to-quantity associations. '
                       'Treat final approved business records as authoritative over earlier proposals. '
                       'Approval or scheduled completion is not actual manufacture/delivery. '
                       'Scope all judgments and constraints to the named case; do not create personal preferences. '
                       'Include the pending actual production/delivery outcome when summarizing this case.')
        return super().generate([{'role':'system','content':instruction}, *messages], **kwargs)


def swapped_allocation(item):
    """Reject the specific line-total transposition observed in the model output."""
    text=json.dumps({'content':item.get('content'),'summary':item.get('metadata',{}).get('structured_summary')},ensure_ascii=False)
    return bool(re.search(r'PKG-03\s+(?:for\s+|would produce\s+|[:=]\s*)?22,?800',text,re.I)
                or re.search(r'PKG-01\s+(?:for\s+|would produce\s+|[:=]\s*)?34,?200',text,re.I))


def serializable(value):
    return json.loads(json.dumps(value, default=str))


def load_snapshot(c, proposal_id):
    production = c.execute('SELECT * FROM factory.proposals WHERE id=%s AND approved_at IS NOT NULL', (proposal_id,)).fetchone()
    if not production:
        raise ValueError('Only an approved production decision can be remembered')
    case = c.execute('SELECT * FROM factory.cases WHERE case_id=%s', (production['case_id'],)).fetchone()
    marketing = c.execute('SELECT * FROM caldova.approved_plans WHERE id=%s', (case['marketing_plan_id'],)).fetchone()
    evaluation = c.execute('SELECT * FROM caldova.evaluations WHERE id=%s', (marketing['evaluation_id'],)).fetchone()
    threads = c.execute('SELECT * FROM factory.threads WHERE last_proposal_id=%s', (proposal_id,)).fetchall()
    if len(threads) != 1:
        raise ValueError('Expected one source conversation for the approved proposal')
    thread = threads[0]
    turns = c.execute('''SELECT * FROM factory.turns WHERE tenant_id=%s AND conversation_id=%s
        AND (created_at<=%s OR lower(trim(question))=%s) ORDER BY created_at,activity_id''',
        (thread['tenant_id'],thread['conversation_id'],production['approved_at'],f'approve production proposal {proposal_id}')).fetchall()
    if not turns or not any(f'production revision {proposal_id} approved' in t['answer'].lower() for t in turns):
        raise ValueError('Approval conversation turn is not yet available; retry after transaction commits')
    return serializable({'case':case,'production':production,'marketing':marketing,
                         'marketingEvaluation':evaluation,'thread':thread,'turns':turns})


def build_case(s):
    p=s['production']; m=s['marketing']; case=s['case']; thread=f"{case['case_id']}:production-{p['id']}"
    constraints=[{'text':t['question'],'activityId':t['activity_id'],'speakerId':t['user_id']}
                 for t in s['turns'] if 'keep mw-77' in t['question'].lower() and 'protect existing orders' in t['question'].lower()]
    return {
        'id':f"{case['case_id']}:production-{p['id']}", 'caseId':case['case_id'],
        'type':'decision_case','title':'Hydration Sunscreen — campaign capacity decision',
        'trigger':{'additionalDemandUnits':case['required_units'],
                   'additionalBudgetUsd':m['approved_forecast']['extra_budget_usd'],
                   'marketingPlanId':m['id'],'marketingEvaluationId':m['evaluation_id']},
        'evidence':{'marketingInputHash':m['input_hash'],'productionInputHash':p['snapshot_hash'],
                    'policyReference':m['approved_forecast']['policy_reference'],
                    'maintenance':p['snapshot']['maintenance'],
                    'productionAssumptions':case['description']},
        'humanJudgment':{'scope':'This campaign decision; not a universal staffing preference',
                         'constraints':constraints},
        'decision':{'productionProposalId':p['id'],'allocations':p['result']['allocations'],
                     'transferredUnits':p['result']['transferred_units'],
                     'transferredPercent':p['result']['transferred_percent'],
                     'bringForwardDays':p['result']['bring_forward_days'],
                     'maintenancePreserved':p['result']['maintenance_preserved'],
                     'existingOrdersPreserved':p['result']['existing_orders_preserved']},
        'approval':{'status':'approved','approver':'Karin Blair','approverObjectId':p['approved_by'],
                    'approvedAt':p['approved_at'],'source':f"factory.proposals/{p['id']}"},
        'actionReceipt':{'type':'saved_production_schedule','scheduledUnits':p['result']['scheduled_units'],
                         'source':f"factory.allocations?proposal_id={p['id']}"},
        'actualOutcome':{'status':'pending','explanation':'Schedule approved; actual production and delivery results have not been recorded.'},
        'sources':{'conversationId':s['thread']['conversation_id'],'tenantId':s['thread']['tenant_id'],
                    'activityIds':[t['activity_id'] for t in s['turns']],
                    'coverage':'Bot-addressed turns and authoritative business records. Tim’s unmentioned channel post is not represented as a captured turn.'},
        'memory':{'userId':f"caldova-case-{p['id']}",'threadId':thread,
                   'toolkit':'azure-cosmos-agent-memory','version':version('azure-cosmos-agent-memory'),
                   'processor':'explicit in-process summary and extraction','status':'pending'},
    }


def source_turns(s, doc):
    p=s['production']; m=s['marketing']; cid=doc['caseId']
    turns=[{'source_id':f"marketing-plan-{m['id']}",'role':'system','created_at':m['approved_at'],
            'content':f"Authoritative business record for {cid}, not a Teams message: Tim approved USD {m['approved_forecast']['extra_budget_usd']} additional campaign investment, creating {s['case']['required_units']} additional units. Marketing plan {m['id']}. Production confirmation was required."}]
    for t in s['turns']:
        base=datetime.fromisoformat(t['created_at'])
        for offset,role,field in ((0,'user','question'),(1,'agent','answer')):
            turns.append({'source_id':f"teams-{t['activity_id']}-{role}",'role':role,
                          'created_at':(base+timedelta(microseconds=offset)).isoformat(),
                          'content':t[field],'activity_id':t['activity_id'],'speaker_id':t['user_id'] if role=='user' else 'factory-planning-agent'})
    final_time=max(datetime.fromisoformat(t['created_at']) for t in turns)+timedelta(seconds=1)
    turns.append({'source_id':f"production-{p['id']}-receipt",'role':'system','created_at':final_time.isoformat(),
                  'content':f"Authoritative final status for case {cid}: production revision {p['id']} was approved by Karin. "
                  f"Approved allocations: {json.dumps(p['result']['allocations'])}. Actual production/delivery outcome is PENDING. "
                  'Capacity confirmation is not evidence that units were manufactured. Maintenance and order-protection constraints apply to this case; do not infer company-wide policy or personal staffing preferences.'})
    return sorted(turns,key=lambda t:t['created_at'])


def create_clients():
    # Reuse existing containers and Entra credentials; no account keys are read.
    os.environ['MEMORY_PROCESSOR_OWNER']='inprocess'
    credential=AzureCliCredential()
    endpoint=os.environ['COSMOS_ENDPOINT']
    model_endpoint=os.environ['MEMORY_MODEL_ENDPOINT']
    embedding_model=os.environ.get('MEMORY_EMBEDDING_DEPLOYMENT','text-embedding-ada-002')
    chat_model=os.environ.get('MEMORY_CHAT_DEPLOYMENT','gpt-5.4-mini')
    cosmos=CosmosClient(endpoint,credential=credential)
    db=cosmos.get_database_client(os.environ.get('COSMOS_DATABASE',DATABASE))
    memory=CosmosMemoryClient(
        cosmos_endpoint=endpoint,cosmos_credential=credential,
        cosmos_database=os.environ.get('COSMOS_DATABASE',DATABASE),cosmos_container='memories',
        cosmos_counter_container='memory_counter',cosmos_lease_container='memory_leases',
        cosmos_throughput_mode='serverless',
        ai_foundry_endpoint=model_endpoint,ai_foundry_credential=credential,
        embedding_deployment_name=embedding_model,
        embeddings_client=EmbeddingsClient(endpoint=model_endpoint,
            credential=credential,model=embedding_model,dimensions=None),
        chat_deployment_name=chat_model,enable_turn_embeddings=False,
        chat_client=GroundedMemoryChat(endpoint=model_endpoint,
            credential=credential,model=chat_model),
        transcript_metadata_keys=['case_id','source_id','speaker_id','outcome_status'],
        cadence_thresholds={key:0 for key in ['FACT_EXTRACTION_EVERY_N','DEDUP_EVERY_N',
            'THREAD_SUMMARY_EVERY_N','USER_SUMMARY_EVERY_N','EPISODE_EXTRACTION_EVERY_N','PROCEDURAL_SYNTHESIS_EVERY_N']})
    memory.connect_cosmos();memory.validate_topology()
    return cosmos,db,memory


def query_thread(container,user,thread):
    return list(container.query_items('SELECT * FROM c WHERE c.user_id=@u AND c.thread_id=@t',
        parameters=[{'name':'@u','value':user},{'name':'@t','value':thread}],partition_key=[user,thread]))


def capture(proposal_id, review=False):
    with connect() as c:
        c.autocommit=True
        c.execute('SELECT pg_advisory_lock(%s)',(290400+proposal_id,))
        c.execute('INSERT INTO factory.memory_outbox(proposal_id) VALUES(%s) ON CONFLICT DO NOTHING',(proposal_id,))
        event=c.execute('SELECT * FROM factory.memory_outbox WHERE proposal_id=%s',(proposal_id,)).fetchone()
        if event['status']=='completed' and not review:
            return {'status':'already_completed','proposal_id':proposal_id}
        try:
            snap=event['snapshot'] or load_snapshot(c,proposal_id)
            c.execute("UPDATE factory.memory_outbox SET snapshot=%s,status='processing',attempts=attempts+1,error=NULL WHERE proposal_id=%s",(Jsonb(snap),proposal_id))
            doc=build_case(snap); user=doc['memory']['userId'];thread=doc['memory']['threadId']
            cosmos,db,memory=create_clients()
            try:
                cases=db.get_container_client('case_records')
                doc['memory']['status']='processing'
                cases.upsert_item(doc)
                existing=query_thread(db.get_container_client('memories_turns'),user,thread)
                sources={t.get('metadata',{}).get('source_id'):t['id'] for t in existing}
                for turn in source_turns(snap,doc):
                    if turn['source_id'] not in sources:
                        sources[turn['source_id']]=memory.upsert_memory(
                            user_id=user,thread_id=thread,role=turn['role'],content=turn['content'],
                            created_at=turn['created_at'],ttl=-1,embed=False,
                            metadata={'case_id':doc['caseId'],'source_id':turn['source_id'],
                                      'speaker_id':turn.get('speaker_id','business-record'),
                                      'activity_id':turn.get('activity_id'),'outcome_status':'pending'},
                            tags=[doc['caseId'],'production-decision'])
                summaries=query_thread(db.get_container_client('memories_summaries'),user,thread)
                if not summaries:
                    memory.generate_thread_summary(user_id=user,thread_id=thread,recent_k=100)
                memory.extract_memories(user_id=user,thread_id=thread,recent_k=100)
                summaries=query_thread(db.get_container_client('memories_summaries'),user,thread)
                facts=query_thread(db.get_container_client('memories'),user,thread)
                if any(swapped_allocation(item) for item in summaries):
                    # Keep the rejected output as a review artifact, never edit model prose silently.
                    cases.upsert_item({'id':doc['id']+':summary-review-1','caseId':doc['caseId'],
                        'type':'memory_review','status':'rejected','reason':'Line totals transposed in generated summary',
                        'originalSummaries':[{k:v for k,v in x.items() if k!='embedding' and not k.startswith('_')} for x in summaries]})
                    correction_id=f"production-{proposal_id}-allocation-correction"
                    if correction_id not in sources:
                        stamp=max(datetime.fromisoformat(x['created_at']) for x in source_turns(snap,doc))+timedelta(seconds=1)
                        totals={}
                        for row in doc['decision']['allocations']:
                            totals[row['line']]=totals.get(row['line'],0)+row['units']
                        sources[correction_id]=memory.upsert_memory(user_id=user,thread_id=thread,role='tool',
                            content=f"Authoritative correction from approved production revision {proposal_id}: aggregate units by line are {json.dumps(totals)}. "
                            'A derived summary transposed those totals. Correct that derived summary using these approved totals. '
                            'This is a memory quality check, not another Teams message. Actual production/delivery remains pending.',
                            created_at=stamp,ttl=-1,embed=False,
                            metadata={'case_id':doc['caseId'],'source_id':correction_id,'outcome_status':'pending'})
                    memory.generate_thread_summary(user_id=user,thread_id=thread,recent_k=100)
                    memory.extract_memories(user_id=user,thread_id=thread,recent_k=100)
                    summaries=query_thread(db.get_container_client('memories_summaries'),user,thread)
                    facts=query_thread(db.get_container_client('memories'),user,thread)
                if not summaries or not facts:
                    raise ValueError('Toolkit did not produce a persisted summary and extracted memories')
                turn_ids=set(sources.values())
                for item in summaries+facts:
                    if swapped_allocation(item):
                        raise ValueError('Derived memory transposes approved line totals; review required')
                    if not item.get('content'):
                        raise ValueError('Empty toolkit output')
                    ids=item.get('source_memory_ids',[]) + item.get('source_turn_ids',[])
                    if ids and not set(ids)<=turn_ids:
                        raise ValueError('Toolkit memory references unknown source turns')
                    # The SDK leaves per-fact source IDs empty in this release.
                    # Attach explicit corpus-level provenance without claiming exact attribution.
                    item.setdefault('metadata',{})['provenance']={
                        'caseId':doc['caseId'],'decisionDocumentId':doc['id'],
                        'sourceTurnIds':sorted(turn_ids),'scope':'source corpus, not sentence-level attribution',
                        'attachedBy':'Caldova integration'}
                    target='memories_summaries' if item['type']=='thread_summary' else 'memories'
                    db.get_container_client(target).upsert_item({k:v for k,v in item.items() if not k.startswith('_')})
                doc['memory'].update(status='completed',turnCount=len(sources),turnIds=sorted(turn_ids),
                    summaryIds=[x['id'] for x in summaries],factIds=[x['id'] for x in facts],
                    completedAt=datetime.now(timezone.utc).isoformat(),
                    reviewStatus='Source links and known line-transposition check passed; derived prose is not the authoritative approval',
                    qualityReviewDocumentId=doc['id']+':summary-review-1'
                        if f'production-{proposal_id}-allocation-correction' in sources else None)
                cases.upsert_item(doc)
                c.execute("UPDATE factory.memory_outbox SET status='completed',completed_at=clock_timestamp() WHERE proposal_id=%s",(proposal_id,))
                return {'case_document':doc['id'],'status':'completed','turns':len(sources),'summaries':len(summaries),'memories':len(facts)}
            finally:
                memory.close();cosmos.close()
        except Exception as exc:
            c.execute("UPDATE factory.memory_outbox SET status='failed',error=%s WHERE proposal_id=%s",(str(exc)[:1000],proposal_id))
            raise
