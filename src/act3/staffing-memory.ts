import {CosmosClient} from '@azure/cosmos';
import {DefaultAzureCredential} from '@azure/identity';
import {createHash} from 'node:crypto';
import {validateStaffingMemory, type StaffingMemory} from './staffing.ts';

export type MemoryEvidence = {
  memory: StaffingMemory; hash: string; source: string; etag: string;
  mode: 'cosmos' | 'rehearsal';
};

export function validateMemoryEvidence(evidence: MemoryEvidence, id: string, partition: string): MemoryEvidence {
  const memory = validateStaffingMemory(evidence.memory);
  if (memory.id !== id || memory.caseId !== partition || typeof evidence.source !== 'string'
    || !evidence.source.trim() || evidence.source.length > 1000
    || typeof evidence.etag !== 'string' || !['cosmos','rehearsal'].includes(evidence.mode)) {
    throw new Error('The retained source does not match the requested decision case.');
  }
  return {memory,hash:createHash('sha256').update(JSON.stringify(memory)).digest('hex'),
    source:evidence.source,etag:evidence.etag,mode:evidence.mode};
}

export function createCosmosMemoryReader(config: {endpoint: string; database: string; container: string}) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.documents.azure.com') || endpoint.username || endpoint.password) {
    throw new Error('Configure an approved Azure Cosmos DB endpoint.');
  }
  const client = new CosmosClient({endpoint:config.endpoint,aadCredentials:new DefaultAzureCredential(),
    connectionPolicy:{requestTimeout:12000,retryOptions:{maxRetryAttemptCount:2,maxWaitTimeInSeconds:5}}});
  return async (id: string, partition: string): Promise<MemoryEvidence> => {
    const {resource,etag} = await client.database(config.database).container(config.container).item(id,partition)
      .read({abortSignal:AbortSignal.timeout(15000)});
    if (!resource) throw new Error('The retained Act 2 decision was not found.');
    const memory = validateStaffingMemory(resource.staffingMemory ?? resource);
    if (resource.id !== id || resource.caseId !== partition || memory.caseId !== partition) {
      throw new Error('The retained source does not match the requested decision case.');
    }
    return validateMemoryEvidence({memory,hash:'',
      etag:etag ?? resource._etag ?? '', mode:'cosmos',
      source:`${config.database}/${config.container}/${id}`},id,partition);
  };
}