IF SCHEMA_ID('staffing') IS NULL EXEC('CREATE SCHEMA staffing');
GO
IF OBJECT_ID('staffing.cases') IS NULL
CREATE TABLE staffing.cases (
 caseId nvarchar(100) PRIMARY KEY, title nvarchar(300) NOT NULL,
 factoryId nvarchar(100) NOT NULL, lineId nvarchar(100) NOT NULL,
 scenarioAsOf datetime2 NOT NULL, clockStartedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 windowStart datetime2 NOT NULL, windowEnd datetime2 NOT NULL,
 demandUnits int NOT NULL CHECK(demandUnits>0), dailyOutput int NOT NULL CHECK(dailyOutput>0),
 baseWorkers int NOT NULL CHECK(baseWorkers>0), extraWorkers int NOT NULL CHECK(extraWorkers>0),
 gainPerWorker decimal(9,4) NOT NULL CHECK(gainPerWorker>0 AND gainPerWorker<=1),
 maxExtraWorkers int NOT NULL CHECK(maxExtraWorkers>0), machineDailyLimit int NOT NULL,
 temporaryAvailable int NOT NULL CHECK(temporaryAvailable>=0), qualified bit NOT NULL,
 onboardingReadyAt datetime2 NOT NULL, modelVersion nvarchar(100) NOT NULL,
 memoryId nvarchar(200) NOT NULL, memoryPartition nvarchar(200) NOT NULL,
 state varchar(30) NOT NULL DEFAULT 'review', selectedOptionId varchar(30) NULL,
 memoryHash char(64) NULL, memorySource nvarchar(1000) NULL,
 proposalContextHash char(64) NULL, revision rowversion,
 CHECK(windowEnd>windowStart), CHECK(extraWorkers<=maxExtraWorkers),
 CHECK(machineDailyLimit>=dailyOutput)
);
IF OBJECT_ID('staffing.policies') IS NULL
CREATE TABLE staffing.policies (
 policyId nvarchar(100) NOT NULL, policyVersion nvarchar(30) NOT NULL,
 title nvarchar(300) NOT NULL, body nvarchar(4000) NOT NULL,
 factoryId nvarchar(100) NOT NULL, lineId nvarchar(100) NULL,
 validFrom datetime2 NOT NULL, validUntil datetime2 NULL, status varchar(30) NOT NULL,
 ruleType varchar(30) NOT NULL CHECK(ruleType IN('schedule_notice','temporary_staffing')),
 noticeDays int NULL CHECK(noticeDays>=0), allowNewAssignments bit NULL,
 embedding VECTOR(1536) NOT NULL, embeddingProfile nvarchar(200) NOT NULL,
 PRIMARY KEY(policyId,policyVersion), revision rowversion
);
IF OBJECT_ID('staffing.approvals') IS NULL
CREATE TABLE staffing.approvals (
 requestId uniqueidentifier PRIMARY KEY, caseId nvarchar(100) NOT NULL REFERENCES staffing.cases(caseId),
 optionId varchar(30) NOT NULL, actorId uniqueidentifier NOT NULL,
 approverRole varchar(100) NOT NULL, contextHash char(64) NOT NULL,
 approvedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 UNIQUE(caseId,approverRole)
);
IF OBJECT_ID('staffing.plans') IS NULL
CREATE TABLE staffing.plans (
 caseId nvarchar(100) PRIMARY KEY REFERENCES staffing.cases(caseId), optionId varchar(30) NOT NULL,
 extraWorkers int NOT NULL, outputUnits int NOT NULL, windowStart datetime2 NOT NULL,
 windowEnd datetime2 NOT NULL, contextHash char(64) NOT NULL,
 recordedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
IF COL_LENGTH('staffing.cases','operatingDates') IS NULL
 ALTER TABLE staffing.cases ADD operatingDates nvarchar(max) NULL;
IF COL_LENGTH('staffing.cases','datasetContext') IS NULL
 ALTER TABLE staffing.cases ADD datasetContext nvarchar(max) NULL;
GO
CREATE OR ALTER VIEW staffing.current_cases AS
SELECT currentCase.*,
 DATEADD(second,DATEDIFF(second,clockStartedAt,SYSUTCDATETIME()),scenarioAsOf) AS planningNow,
 CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(
   (SELECT currentCase.caseId,currentCase.factoryId,currentCase.lineId,currentCase.scenarioAsOf,currentCase.clockStartedAt,
   currentCase.windowStart,currentCase.windowEnd,currentCase.demandUnits,currentCase.dailyOutput,
   currentCase.baseWorkers,currentCase.extraWorkers,currentCase.gainPerWorker,currentCase.maxExtraWorkers,
   currentCase.machineDailyLimit,currentCase.temporaryAvailable,currentCase.qualified,currentCase.onboardingReadyAt,
    currentCase.modelVersion,currentCase.memoryId,currentCase.memoryPartition
   FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES),
   (SELECT policyId,policyVersion,title,body,validFrom,validUntil,status,ruleType,noticeDays,allowNewAssignments
    FROM staffing.policies policy WHERE policy.factoryId=currentCase.factoryId
      AND (policy.lineId IS NULL OR policy.lineId=currentCase.lineId)
    ORDER BY policyId,policyVersion FOR JSON PATH),
   CASE WHEN currentCase.operatingDates IS NOT NULL OR currentCase.datasetContext IS NOT NULL
     THEN (SELECT currentCase.operatingDates,currentCase.datasetContext FOR JSON PATH,WITHOUT_ARRAY_WRAPPER,INCLUDE_NULL_VALUES)
     ELSE '' END)),2) AS contextHash
FROM staffing.cases currentCase;
GO
CREATE OR ALTER FUNCTION staffing.options(@caseId nvarchar(100))
RETURNS TABLE AS RETURN
WITH facts AS (
 SELECT currentCase.*,
   CASE WHEN operatingDates IS NULL THEN DATEDIFF(day,windowStart,windowEnd)
     ELSE (SELECT COUNT(DISTINCT calendar.value) FROM OPENJSON(operatingDates) calendar
       WHERE TRY_CONVERT(date,calendar.value)>=CONVERT(date,windowStart)
         AND TRY_CONVERT(date,calendar.value)<CONVERT(date,windowEnd)) END AS productionDays,
   (SELECT MAX(noticeDays) FROM staffing.policies policy
    WHERE policy.factoryId=currentCase.factoryId AND (policy.lineId IS NULL OR policy.lineId=currentCase.lineId)
      AND policy.status='approved' AND policy.ruleType='schedule_notice'
      AND policy.validFrom<=planningNow AND policy.validFrom<=windowStart
      AND (policy.validUntil IS NULL OR policy.validUntil>=windowEnd)) AS requiredNoticeDays,
   (SELECT MIN(CONVERT(int,allowNewAssignments)) FROM staffing.policies policy
    WHERE policy.factoryId=currentCase.factoryId AND (policy.lineId IS NULL OR policy.lineId=currentCase.lineId)
      AND policy.status='approved' AND policy.ruleType='temporary_staffing'
      AND policy.validFrom<=planningNow AND policy.validFrom<=windowStart
      AND (policy.validUntil IS NULL OR policy.validUntil>=windowEnd)) AS newAssignmentsAllowed
 FROM staffing.current_cases currentCase WHERE caseId=@caseId
), output AS (
 SELECT facts.*, CONVERT(int,FLOOR(CASE WHEN dailyOutput*(1+extraWorkers*gainPerWorker)>machineDailyLimit
   THEN machineDailyLimit ELSE dailyOutput*(1+extraWorkers*gainPerWorker) END))*productionDays AS staffedOutput,
   dailyOutput*productionDays AS baselineOutput
 FROM facts
)
SELECT caseId,contextHash,planningNow,optionId,optionName,addedWorkers,outputUnits,
 CASE WHEN demandUnits>outputUnits THEN demandUnits-outputUnits ELSE 0 END AS shortfallUnits,
 requiredNoticeDays,
 CONVERT(bit,CASE WHEN reason='Eligible for operations and HR review.' THEN 1 ELSE 0 END) AS eligible,
 reason
FROM output CROSS APPLY (VALUES
 ('unchanged','Keep current staffing',0,baselineOutput,
   CASE WHEN baselineOutput<demandUnits THEN 'Current staffing cannot cover committed demand.' ELSE 'Eligible for operations and HR review.' END),
 ('reassign','Move existing workers',extraWorkers,staffedOutput,
   CASE WHEN requiredNoticeDays IS NULL THEN 'The mandatory schedule-notice policy is unavailable.'
     WHEN DATEADD(day,requiredNoticeDays,planningNow)>windowStart THEN 'Changing published shifts would breach the minimum notice period.'
     ELSE 'Reassignment requires a separate donor-line capacity review.' END),
 ('temporary','Add qualified temporary packers',extraWorkers,staffedOutput,
   CASE WHEN requiredNoticeDays IS NULL OR newAssignmentsAllowed IS NULL THEN 'A mandatory staffing policy is unavailable.'
     WHEN newAssignmentsAllowed<>1 THEN 'Current policy does not permit new temporary assignments.'
     WHEN planningNow>=windowStart THEN 'The production window has started; refresh the staffing plan.'
     WHEN qualified<>1 OR temporaryAvailable<extraWorkers OR onboardingReadyAt>windowStart
       THEN 'Qualified temporary staff cannot be ready before the production window.'
     WHEN staffedOutput<demandUnits THEN 'The bounded staffing model cannot cover committed demand.'
     ELSE 'Eligible for operations and HR review.' END)
) options(optionId,optionName,addedWorkers,outputUnits,reason);
GO
CREATE OR ALTER PROCEDURE staffing.propose
 @caseId nvarchar(100), @reviewedHash char(64), @memoryHash char(64),
 @memorySource nvarchar(1000), @memoryLine nvarchar(100), @memoryModel nvarchar(100)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRANSACTION;
 DECLARE @currentHash char(64),@state varchar(30);
 SELECT @state=state FROM staffing.cases WITH(UPDLOCK,HOLDLOCK) WHERE caseId=@caseId;
 SELECT @currentHash=contextHash FROM staffing.current_cases WHERE caseId=@caseId;
 IF @currentHash IS NULL OR @currentHash<>@reviewedHash THROW 51100,'The case or policy changed. Refresh and review again.',1;
 IF NOT EXISTS(SELECT 1 FROM staffing.cases WHERE caseId=@caseId AND lineId=@memoryLine AND modelVersion=@memoryModel)
   THROW 51101,'The retained observation does not apply to this line and staffing model.',1;
 IF @state<>'review' THROW 51102,'A proposal already exists. Inspect its approvals before changing the plan.',1;
 IF NOT EXISTS(SELECT 1 FROM staffing.options(@caseId) WHERE optionId='temporary' AND eligible=1)
   THROW 51103,'Current policy and readiness checks do not permit this proposal.',1;
 UPDATE staffing.cases SET selectedOptionId='temporary',state='awaiting_approval',
   memoryHash=@memoryHash,memorySource=@memorySource,proposalContextHash=@currentHash WHERE caseId=@caseId;
 SELECT caseId,state,selectedOptionId,proposalContextHash,memorySource FROM staffing.cases WHERE caseId=@caseId;
 COMMIT;
END;
GO
CREATE OR ALTER PROCEDURE staffing.approve
 @requestId uniqueidentifier,@caseId nvarchar(100),@actorId uniqueidentifier,
 @approverRole varchar(100),@reviewedHash char(64),@memoryHash char(64)
AS
BEGIN
 SET NOCOUNT ON; SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
 BEGIN TRANSACTION;
 IF EXISTS(SELECT 1 FROM staffing.approvals WITH(UPDLOCK,HOLDLOCK) WHERE requestId=@requestId)
 BEGIN
   IF NOT EXISTS(SELECT 1 FROM staffing.approvals WHERE requestId=@requestId AND caseId=@caseId
      AND actorId=@actorId AND approverRole=@approverRole AND contextHash=@reviewedHash)
     THROW 51104,'This request identifier belongs to a different approval.',1;
   SELECT * FROM staffing.approvals WHERE requestId=@requestId; COMMIT; RETURN;
 END;
 IF @approverRole NOT IN('ROLE-OPERATIONS-APPROVER','ROLE-HR-APPROVER') THROW 51105,'Unsupported approval role.',1;
 DECLARE @state varchar(30),@proposal char(64),@source char(64),@current char(64);
 SELECT @state=state,@proposal=proposalContextHash,@source=memoryHash
   FROM staffing.cases WITH(UPDLOCK,HOLDLOCK) WHERE caseId=@caseId;
 SELECT @current=contextHash FROM staffing.current_cases WHERE caseId=@caseId;
 IF @state IS NULL OR @state<>'awaiting_approval' OR @current<>@reviewedHash OR @current<>@proposal
   OR @source<>@memoryHash THROW 51106,'The proposal, policy or source changed. A fresh review is required.',1;
 IF EXISTS(SELECT 1 FROM staffing.approvals WHERE caseId=@caseId AND contextHash<>@current)
   THROW 51106,'A prior approval covers a different plan.',1;
 IF EXISTS(SELECT 1 FROM staffing.approvals WHERE caseId=@caseId AND approverRole=@approverRole)
   THROW 51107,'This role has already approved the plan.',1;
 IF NOT EXISTS(SELECT 1 FROM staffing.options(@caseId) WHERE optionId='temporary' AND eligible=1)
   THROW 51108,'Policy, notice-date or onboarding checks no longer permit the plan.',1;
 INSERT staffing.approvals(requestId,caseId,optionId,actorId,approverRole,contextHash)
   VALUES(@requestId,@caseId,'temporary',@actorId,@approverRole,@current);
 IF (SELECT COUNT(*) FROM staffing.approvals WHERE caseId=@caseId)=2
 BEGIN
   INSERT staffing.plans(caseId,optionId,extraWorkers,outputUnits,windowStart,windowEnd,contextHash)
     SELECT currentCase.caseId,'temporary',currentCase.extraWorkers,options.outputUnits,windowStart,windowEnd,@current
     FROM staffing.cases currentCase CROSS APPLY staffing.options(currentCase.caseId) options
     WHERE currentCase.caseId=@caseId AND options.optionId='temporary' AND options.eligible=1;
   IF @@ROWCOUNT<>1 THROW 51108,'The plan could not be revalidated.',1;
   UPDATE staffing.cases SET state='authorized' WHERE caseId=@caseId;
 END;
 SELECT * FROM staffing.approvals WHERE requestId=@requestId; COMMIT;
END;