#!/usr/bin/env python3
"""Read the existing Cosmos demo topology and document summaries, without secrets."""
from azure.cosmos import CosmosClient
from azure.identity import AzureCliCredential
import os

client=CosmosClient(os.environ['COSMOS_ENDPOINT'],credential=AzureCliCredential())
db=client.get_database_client(os.environ.get('COSMOS_DATABASE','caldova-act2-demo'))
for name in ('case_records','memories','memories_turns','memories_summaries','memory_counter','memory_leases'):
    container=db.get_container_client(name)
    total=list(container.query_items('SELECT VALUE COUNT(1) FROM c',enable_cross_partition_query=True))[0]
    campaign=list(container.query_items(
        'SELECT VALUE COUNT(1) FROM c WHERE c.caseId=@case OR c.thread_id=@thread',
        parameters=[{'name':'@case','value':'HYDRATION-SUNSCREEN-CAMPAIGN-001'},
                    {'name':'@thread','value':'HYDRATION-SUNSCREEN-CAMPAIGN-001:production-6'}],
        enable_cross_partition_query=True))[0]
    print(f'{name}: total={total}, campaign={campaign}')
    for item in container.query_items('SELECT TOP 5 c.id,c.caseId,c.user_id,c.thread_id,c.type,c.memory_type FROM c',enable_cross_partition_query=True):
        print(item)
client.close()
