SET XACT_ABORT ON;
IF OBJECT_ID('dbo.approved_policies') IS NULL
CREATE TABLE dbo.approved_policies (
    policyId nvarchar(100) NOT NULL,
    policyVersion nvarchar(100) NOT NULL,
    policyName nvarchar(300) NOT NULL,
    status varchar(30) NOT NULL,
    effectiveFrom datetime2 NOT NULL,
    ruleJson nvarchar(max) NOT NULL CHECK (ISJSON(ruleJson)=1),
    PRIMARY KEY (policyId, policyVersion)
);
IF OBJECT_ID('dbo.decision_cases') IS NULL
CREATE TABLE dbo.decision_cases (
    caseId nvarchar(100) NOT NULL PRIMARY KEY,
    lineId nvarchar(100) NOT NULL,
    payload nvarchar(max) NOT NULL CHECK (ISJSON(payload)=1),
    sourceHash char(64) NOT NULL,
    importedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    state varchar(30) NOT NULL DEFAULT 'review',
    selectedOptionId nvarchar(100) NULL,
    version rowversion
);
IF OBJECT_ID('act3.approvals') IS NULL
CREATE TABLE act3.approvals (
    requestId uniqueidentifier NOT NULL PRIMARY KEY,
    caseId nvarchar(100) NOT NULL REFERENCES dbo.decision_cases(caseId),
    optionId nvarchar(100) NOT NULL,
    actorId uniqueidentifier NOT NULL,
    approverRole varchar(100) NOT NULL,
    reviewedHash char(64) NOT NULL,
    approvedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UNIQUE (caseId, approverRole)
);
IF COL_LENGTH('act3.approvals','decisionContextHash') IS NULL
    ALTER TABLE act3.approvals ADD decisionContextHash char(64) NULL;
IF OBJECT_ID('act3.plans') IS NULL
CREATE TABLE act3.plans (
    caseId nvarchar(100) NOT NULL PRIMARY KEY REFERENCES dbo.decision_cases(caseId),
    optionId nvarchar(100) NOT NULL,
    rateFactor float NOT NULL,
    utilisation float NOT NULL,
    deferralDays int NOT NULL,
    recordedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE OR ALTER VIEW act3.review_state AS
SELECT decision.*,
    CONVERT(varchar(64), HASHBYTES('SHA2_256', CONCAT(decision.payload, CONVERT(varchar(20), decision.version, 2),
      (SELECT policyId, policyVersion, status, effectiveFrom, ruleJson FROM dbo.approved_policies ORDER BY policyId, policyVersion FOR JSON PATH))), 2) AS reviewHash
FROM dbo.decision_cases decision;
GO
CREATE OR ALTER PROCEDURE act3.approve_option
    @requestId uniqueidentifier, @caseId nvarchar(100), @optionId nvarchar(100),
    @actorId uniqueidentifier, @approverRole varchar(100), @reviewedHash char(64)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    BEGIN TRANSACTION;
    IF EXISTS (SELECT 1 FROM act3.approvals WITH (UPDLOCK, HOLDLOCK) WHERE requestId=@requestId)
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM act3.approvals WHERE requestId=@requestId AND caseId=@caseId AND optionId=@optionId AND actorId=@actorId AND approverRole=@approverRole AND reviewedHash=@reviewedHash)
            THROW 51000, 'Idempotency key was already used for a different approval.', 1;
        SELECT * FROM act3.approvals WHERE requestId=@requestId;
        COMMIT;
        RETURN;
    END;
    IF @approverRole NOT IN ('ROLE-MAINTENANCE-APPROVER','ROLE-OPERATIONS-APPROVER')
        THROW 51001, 'Unsupported approval role.', 1;
    DECLARE @payload nvarchar(max), @state varchar(30), @selected nvarchar(100), @hash char(64);
    SELECT @payload=payload, @state=state, @selected=selectedOptionId FROM dbo.decision_cases WITH (UPDLOCK,HOLDLOCK) WHERE caseId=@caseId;
    SELECT @hash=reviewHash FROM act3.review_state WHERE caseId=@caseId;
    IF @hash IS NULL OR @hash<>@reviewedHash OR @state='authorized'
        THROW 51002, 'The reviewed case or policy changed. Refresh before approving.', 1;
        DECLARE @decisionContextHash char(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(@payload,
            (SELECT policyId,policyVersion,status,effectiveFrom,ruleJson FROM dbo.approved_policies WITH(HOLDLOCK)
             ORDER BY policyId,policyVersion FOR JSON PATH))),2);
        IF EXISTS(SELECT 1 FROM act3.approvals WHERE caseId=@caseId
            AND (decisionContextHash IS NULL OR decisionContextHash<>@decisionContextHash))
                THROW 51002, 'A prior approval covers different case or policy content. A new reviewed case is required.', 1;
    IF @selected IS NOT NULL AND @selected<>@optionId
        THROW 51003, 'The approvals must refer to the same option.', 1;
    IF EXISTS (SELECT 1 FROM act3.approvals WHERE caseId=@caseId AND approverRole=@approverRole)
        THROW 51004, 'This role already approved the option.', 1;
    DECLARE @option nvarchar(max), @evaluation nvarchar(max), @rule nvarchar(max), @capacity nvarchar(max);
    SELECT @option=value FROM OPENJSON(@payload,'$.options') WHERE JSON_VALUE(value,'$.optionId')=@optionId;
    SELECT @evaluation=value FROM OPENJSON(@payload,'$.evaluations') WHERE JSON_VALUE(value,'$.optionId')=@optionId;
    SELECT @rule=ruleJson FROM dbo.approved_policies WITH (HOLDLOCK)
      WHERE policyId=JSON_VALUE(@evaluation,'$.policyId') AND policyVersion=JSON_VALUE(@evaluation,'$.policyVersion')
        AND status='approved' AND effectiveFrom<=SYSUTCDATETIME();
    SELECT @capacity=ruleJson FROM dbo.approved_policies WITH (HOLDLOCK)
      WHERE policyId='POL-CAPACITY-003' AND status='approved' AND effectiveFrom<=SYSUTCDATETIME();
    DECLARE @rate float=TRY_CONVERT(float,JSON_VALUE(@option,'$.requiredRateFactor')),
      @utilisation float=TRY_CONVERT(float,JSON_VALUE(@option,'$.requiredUtilisation')),
      @days int=TRY_CONVERT(int,JSON_VALUE(@evaluation,'$.requestedDeferralDays')),
      @stress float=TRY_CONVERT(float,JSON_VALUE(@evaluation,'$.projectedStressPctOfThreshold')),
      @allowed int;
    SELECT TOP(1) @allowed=maxDeferralDays FROM OPENJSON(@rule,'$.deferralTable')
      WITH(maxSustainedRateFactor float, maxDeferralDays int)
      WHERE @rate<=maxSustainedRateFactor ORDER BY maxSustainedRateFactor;
    IF @option IS NULL OR @rule IS NULL OR @capacity IS NULL OR @allowed IS NULL
    OR @rate IS NULL OR @utilisation IS NULL OR @utilisation<=0 OR @days IS NULL OR @stress IS NULL OR @stress<0
    OR TRY_CONVERT(float,JSON_VALUE(@rule,'$.stressCeilingPct')) IS NULL
    OR TRY_CONVERT(float,JSON_VALUE(@capacity,'$.maxSustainedUtilisation')) IS NULL
    OR TRY_CONVERT(float,JSON_VALUE(@capacity,'$.maxSustainedRateFactor')) IS NULL
      OR @rate<=0 OR @days<0 OR @days>@allowed OR @stress>TRY_CONVERT(float,JSON_VALUE(@rule,'$.stressCeilingPct'))
      OR @utilisation>TRY_CONVERT(float,JSON_VALUE(@capacity,'$.maxSustainedUtilisation'))
      OR @rate>TRY_CONVERT(float,JSON_VALUE(@capacity,'$.maxSustainedRateFactor'))
      OR ISNULL(JSON_VALUE(@rule,'$.effect'),'')<>'conditional_permit'
      OR ISNULL(JSON_VALUE(@capacity,'$.effect'),'')<>'conditional_permit'
      OR ISNULL(JSON_VALUE(@option,'$.policyCompliant'),'false')<>'true'
      OR ISNULL(JSON_VALUE(@option,'$.meetsCommitment'),'false')<>'true'
      OR ISNULL(TRY_CONVERT(int,JSON_VALUE(@option,'$.shortfallUnits')),1)>0
        THROW 51005, 'The option does not satisfy current policy and commitment checks.', 1;
        INSERT act3.approvals(requestId,caseId,optionId,actorId,approverRole,reviewedHash,decisionContextHash)
            VALUES(@requestId,@caseId,@optionId,@actorId,@approverRole,@reviewedHash,@decisionContextHash);
    UPDATE dbo.decision_cases SET selectedOptionId=@optionId, state='awaiting_approval' WHERE caseId=@caseId;
    IF (SELECT COUNT(*) FROM act3.approvals WHERE caseId=@caseId)=2
    BEGIN
        INSERT act3.plans(caseId,optionId,rateFactor,utilisation,deferralDays) VALUES(@caseId,@optionId,@rate,@utilisation,@days);
        UPDATE dbo.decision_cases SET state='authorized' WHERE caseId=@caseId;
    END;
    SELECT * FROM act3.approvals WHERE requestId=@requestId;
    COMMIT;
END;
GO
CREATE OR ALTER PROCEDURE act3.draft_guidance
        @guidanceId nvarchar(100), @caseId nvarchar(100), @title nvarchar(300), @excerpt nvarchar(4000),
        @embedding nvarchar(max), @profile nvarchar(200), @actorId uniqueidentifier
AS
BEGIN
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @line nvarchar(100), @payload nvarchar(max), @sourceHash char(64), @policyId nvarchar(100), @version nvarchar(100);
        SELECT @line=lineId, @payload=payload, @sourceHash=sourceHash FROM dbo.decision_cases WITH (UPDLOCK,HOLDLOCK)
            WHERE caseId=@caseId AND state='authorized';
        SELECT @policyId=JSON_VALUE(value,'$.policyId'), @version=JSON_VALUE(value,'$.policyVersion')
            FROM OPENJSON(@payload,'$.evaluations') WHERE JSON_VALUE(value,'$.optionId')=(SELECT selectedOptionId FROM dbo.decision_cases WHERE caseId=@caseId);
        IF @line IS NULL OR @policyId IS NULL THROW 51007, 'Authorize the case before recording its lesson.', 1;
        IF NOT EXISTS(SELECT 1 FROM dbo.approved_policies WHERE policyId=@policyId AND policyVersion=@version AND status='approved' AND effectiveFrom<=SYSUTCDATETIME())
            THROW 51008, 'The case policy is no longer current.', 1;
        DECLARE @hash char(64)=CONVERT(varchar(64),HASHBYTES('SHA2_256',CONCAT(@sourceHash,@title,@excerpt,@profile,@policyId,@version)),2);
        IF EXISTS(SELECT 1 FROM act3.guidance WHERE guidanceId=@guidanceId)
        BEGIN
            IF NOT EXISTS(SELECT 1 FROM act3.guidance WHERE guidanceId=@guidanceId AND sourceHash=@hash AND proposedBy=@actorId)
                THROW 51009, 'The draft identifier was already used for different content.', 1;
        END
        ELSE
            INSERT act3.guidance(guidanceId,lineId,title,excerpt,sourceCaseId,sourceVersion,sourceHash,policyId,policyVersion,status,sourceType,validFrom,embeddingProfile,embedding,proposedBy)
                VALUES(@guidanceId,@line,@title,@excerpt,@caseId,@sourceHash,@hash,@policyId,@version,'draft','lesson',SYSUTCDATETIME(),@profile,CAST(@embedding AS VECTOR(1536)),@actorId);
        SELECT guidanceId,title,excerpt,sourceHash,status FROM act3.guidance WHERE guidanceId=@guidanceId;
        COMMIT;
END;
GO
IF OBJECT_ID('act3.embedding_budget') IS NULL
CREATE TABLE act3.embedding_budget(day date NOT NULL PRIMARY KEY, requests int NOT NULL);
GO
CREATE OR ALTER PROCEDURE act3.consume_embedding_budget
AS
BEGIN
        SET NOCOUNT ON;
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @day date=CONVERT(date,SYSUTCDATETIME());
        IF NOT EXISTS(SELECT 1 FROM act3.embedding_budget WITH(UPDLOCK,HOLDLOCK) WHERE day=@day)
            INSERT act3.embedding_budget VALUES(@day,0);
        UPDATE act3.embedding_budget SET requests=requests+1 WHERE day=@day AND requests<200;
        IF @@ROWCOUNT<>1 THROW 51010, 'Daily embedding request budget reached.', 1;
        COMMIT;
END;
GO
CREATE OR ALTER PROCEDURE act3.publish_guidance
    @guidanceId nvarchar(100), @sourceHash char(64), @actorId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE guidance SET status='approved', approvedBy=@actorId, approvedAt=SYSUTCDATETIME()
      FROM act3.guidance guidance
      INNER JOIN dbo.approved_policies policy ON policy.policyId=guidance.policyId AND policy.policyVersion=guidance.policyVersion
      WHERE guidance.guidanceId=@guidanceId AND guidance.sourceHash=@sourceHash AND guidance.status='draft'
        AND guidance.sourceType='lesson' AND policy.status='approved' AND policy.effectiveFrom<=SYSUTCDATETIME();
    IF @@ROWCOUNT<>1 THROW 51006, 'The lesson or its policy changed. Refresh before publishing.', 1;
    SELECT guidanceId,status,approvedBy,approvedAt FROM act3.guidance WHERE guidanceId=@guidanceId;
    COMMIT;
END;