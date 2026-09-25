-- Cosmos DB Data Explorer queries: execute each in the indicated container.
-- Database: caldova-act2-demo. This is Cosmos SQL, not PostgreSQL.

-- 1. case_records: the complete authoritative decision.
SELECT c.id,c.trigger,c.humanJudgment,c.decision,c.approval,c.actualOutcome,c.memory
FROM c
WHERE c.id='HYDRATION-SUNSCREEN-CAMPAIGN-001:production-6'
  AND c.caseId='HYDRATION-SUNSCREEN-CAMPAIGN-001'

-- 2. memories_turns: source interaction, business-record context and quality correction.
SELECT c.role,c.content,c.metadata.source_id,c.metadata.speaker_id,c.created_at
FROM c
WHERE c.user_id='caldova-case-6'
  AND c.thread_id='HYDRATION-SUNSCREEN-CAMPAIGN-001:production-6'
ORDER BY c.created_at

-- 3. memories_summaries: the toolkit-generated summary.
SELECT c.content,c.metadata.structured_summary.decisions,
       c.metadata.structured_summary.open_issues,c.prompt_id,c.metadata.provenance
FROM c
WHERE c.user_id='caldova-case-6'
  AND c.thread_id='HYDRATION-SUNSCREEN-CAMPAIGN-001:production-6'
  AND c.type='thread_summary'

-- 4. memories: independently stored extracted facts.
SELECT c.type,c.content,c.confidence,c.prompt_id,
       c.metadata.provenance.decisionDocumentId AS decisionDocumentId
FROM c
WHERE c.user_id='caldova-case-6'
  AND c.thread_id='HYDRATION-SUNSCREEN-CAMPAIGN-001:production-6'
  AND c.type='fact'

-- 5. case_records: finish with approval versus actual outcome.
SELECT c.approval.status AS planStatus,c.actualOutcome.status AS actualOutcome,
       c.actionReceipt.scheduledUnits AS scheduledUnits,c.memory.status AS memoryStatus
FROM c
WHERE c.id='HYDRATION-SUNSCREEN-CAMPAIGN-001:production-6'
  AND c.caseId='HYDRATION-SUNSCREEN-CAMPAIGN-001'
