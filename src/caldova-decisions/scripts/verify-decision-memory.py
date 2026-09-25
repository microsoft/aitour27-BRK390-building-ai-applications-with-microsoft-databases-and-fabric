#!/usr/bin/env python3
"""Inspect persisted Demo 4 records and check source/decision continuity."""
import json
import sys
import argparse
import os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from decision_memory.capture import swapped_allocation
from azure.cosmos import CosmosClient
from azure.identity import AzureCliCredential

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--quiet',action='store_true')
parser.add_argument('--case-id',default='HYDRATION-SUNSCREEN-CAMPAIGN-001')
parser.add_argument('--proposal-id',type=int,required=True)
args=parser.parse_args()

endpoint=os.environ['COSMOS_ENDPOINT']
case=args.case_id
thread=f'{case}:production-{args.proposal_id}'
user=f'caldova-case-{args.proposal_id}'
with CosmosClient(endpoint,credential=AzureCliCredential()) as client:
    db=client.get_database_client(os.environ.get('COSMOS_DATABASE','caldova-act2-demo'))
    doc=db.get_container_client('case_records').read_item(thread,partition_key=case)
    assert doc['trigger']['additionalDemandUnits']==57000
    assert doc['actualOutcome']['status']=='pending'
    assert doc['approval']['status']=='approved'
    assert sum(x['units'] for x in doc['decision']['allocations'])==57000
    assert doc['humanJudgment']['constraints']
    ids=set(doc['memory']['turnIds'])
    for name in ('memories_turns','memories_summaries','memories'):
        items=list(db.get_container_client(name).query_items(
            'SELECT * FROM c WHERE c.user_id=@u AND c.thread_id=@t',
            parameters=[{'name':'@u','value':user},{'name':'@t','value':thread}],
            partition_key=[user,thread]))
        print(name,len(items))
        if name=='memories_turns':
            assert len(items)==doc['memory']['turnCount']
            assert len({x['metadata']['source_id'] for x in items})==len(items)
        else:
            for item in items:
                if not args.quiet:
                    print(json.dumps({k:v for k,v in item.items() if k not in ('embedding','_rid','_self','_etag','_attachments','_ts')},indent=2))
                assert len(item.get('embedding',[]))==1536
                assert not swapped_allocation(item)
                assert set(item['metadata']['provenance']['sourceTurnIds'])==ids
                if name=='memories_summaries':
                    assert 'pending' in item['content'].lower()
                source_ids=item.get('source_memory_ids',[])+item.get('source_turn_ids',[])
                assert set(source_ids)<=ids
    print('PASS: approved case, pending outcome, unique source turns, persisted toolkit outputs and embeddings')
