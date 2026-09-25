IF OBJECT_ID(N'dbo.runtime_action_executions', N'U') IS NULL
CREATE TABLE dbo.runtime_action_executions (
    invocationId varchar(80) NOT NULL,
    correlationId varchar(120) NOT NULL,
    actionType varchar(50) NOT NULL,
    receiptId varchar(50) NOT NULL,
    invokedAt datetime2(0) NOT NULL CONSTRAINT DF_runtime_action_executions_invokedAt DEFAULT SYSUTCDATETIME(),
    actorObjectId varchar(80) NOT NULL,
    actorRole varchar(50) NOT NULL,
    approvedAt datetime2(0) NOT NULL,
    policyId varchar(40) NOT NULL,
    policyVersion varchar(20) NOT NULL,
    outcome varchar(30) NOT NULL,
    detailsJson varchar(1200) NOT NULL,
    CONSTRAINT PK_runtime_action_executions PRIMARY KEY (invocationId),
    CONSTRAINT UQ_runtime_action_executions_correlation UNIQUE (correlationId),
    CONSTRAINT UQ_runtime_action_executions_receipt UNIQUE (receiptId),
    CONSTRAINT FK_runtime_action_executions_policies FOREIGN KEY (policyId, policyVersion) REFERENCES dbo.approved_policies(policyId, policyVersion)
);
GO

IF OBJECT_ID(N'dbo.runtime_production_plan_state', N'U') IS NULL
CREATE TABLE dbo.runtime_production_plan_state (
    lineId varchar(30) NOT NULL,
    optionId varchar(30) NOT NULL,
    effectiveFromDate date NULL,
    effectiveToDate date NULL,
    rateFactor decimal(6,4) NOT NULL,
    utilisation decimal(6,4) NOT NULL,
    approvedByObjectId varchar(80) NOT NULL,
    approvedAt datetime2(0) NOT NULL,
    correlationId varchar(120) NOT NULL,
    CONSTRAINT PK_runtime_production_plan_state PRIMARY KEY (lineId),
    CONSTRAINT FK_runtime_production_plan_state_lines FOREIGN KEY (lineId) REFERENCES dbo.production_lines(lineId),
    CONSTRAINT FK_runtime_production_plan_state_options FOREIGN KEY (optionId) REFERENCES dbo.production_options(optionId)
);
GO

IF OBJECT_ID(N'dbo.runtime_maintenance_state', N'U') IS NULL
CREATE TABLE dbo.runtime_maintenance_state (
    maintenanceWindowId varchar(40) NOT NULL,
    deferredStartDate date NOT NULL,
    deferredEndDate date NOT NULL,
    deferralDays int NOT NULL,
    approvedByObjectId varchar(80) NOT NULL,
    approvedAt datetime2(0) NOT NULL,
    correlationId varchar(120) NOT NULL,
    CONSTRAINT PK_runtime_maintenance_state PRIMARY KEY (maintenanceWindowId),
    CONSTRAINT FK_runtime_maintenance_state_windows FOREIGN KEY (maintenanceWindowId) REFERENCES dbo.maintenance_windows(maintenanceWindowId)
);
GO

CREATE OR ALTER PROCEDURE dbo.execute_governed_action
    @invocationId varchar(80),
    @correlationId varchar(120),
    @actionType varchar(50),
    @actorObjectId varchar(80),
    @actorRole varchar(50),
    @approvedAt datetime2(0),
    @optionId varchar(30) = NULL,
    @maintenanceWindowId varchar(40) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@invocationId)), '') IS NULL
        THROW 51000, 'invocationId is required.', 1;
    IF NULLIF(LTRIM(RTRIM(@correlationId)), '') IS NULL
        THROW 51001, 'correlationId is required.', 1;
    IF NULLIF(LTRIM(RTRIM(@actorObjectId)), '') IS NULL
        THROW 51002, 'The authenticated actor object id is required.', 1;
    IF @approvedAt > DATEADD(minute, 5, SYSUTCDATETIME()) OR @approvedAt < DATEADD(minute, -5, SYSUTCDATETIME())
        THROW 51003, 'The approval timestamp is outside the permitted server window.', 1;

    BEGIN TRANSACTION;

    DECLARE @existingInvocation varchar(80), @existingType varchar(50);
    SELECT @existingInvocation = invocationId, @existingType = actionType
    FROM dbo.runtime_action_executions WITH (UPDLOCK, HOLDLOCK)
    WHERE invocationId = @invocationId OR correlationId = @correlationId;

    IF @existingInvocation IS NOT NULL
    BEGIN
        IF @existingInvocation <> @invocationId OR @existingType <> @actionType
            THROW 51004, 'The invocation or correlation id is already bound to another action.', 1;

        COMMIT TRANSACTION;
        SELECT receiptId, invocationId AS actionId, correlationId, invokedAt AS issuedAt,
               actorRole AS approverRole, policyId, policyVersion, detailsJson
        FROM dbo.runtime_action_executions WHERE invocationId = @invocationId;
        RETURN;
    END;

    DECLARE @policyId varchar(40), @policyVersion varchar(20), @detailsJson varchar(1200);

    IF @actionType = 'production_plan_change'
    BEGIN
        SELECT TOP (1)
            @policyId = policy.policyId,
            @policyVersion = policy.policyVersion,
            @detailsJson = (
                SELECT plan.lineId, optionRow.optionId, optionRow.requiredRateFactor AS rateFactor,
                       optionRow.requiredUtilisation AS utilisation
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )
        FROM dbo.production_options AS optionRow
        INNER JOIN dbo.capacity_plan AS plan
            ON plan.optionId = optionRow.optionId AND plan.planVariant = 'approved'
        INNER JOIN dbo.approved_policies AS policy
            ON policy.policyId = 'POL-CAPACITY-003' AND policy.status = 'approved'
           AND policy.effectiveFrom <= @approvedAt
        WHERE optionRow.optionId = @optionId
          AND optionRow.recommended = 1
          AND optionRow.policyCompliant = 1
          AND optionRow.effectOnExistingOrders = 'none'
          AND optionRow.requiredApproverRole = @actorRole
          AND optionRow.requiredUtilisation <= CONVERT(decimal(6,4), JSON_VALUE(policy.ruleJson, '$.maxSustainedUtilisation'))
          AND optionRow.requiredRateFactor <= CONVERT(decimal(6,4), JSON_VALUE(policy.ruleJson, '$.maxSustainedRateFactor'))
        ORDER BY policy.effectiveFrom DESC, policy.policyVersion DESC;

        IF @policyId IS NULL
            THROW 51005, 'The production option, approver role, or capacity policy is invalid.', 1;

        MERGE dbo.runtime_production_plan_state WITH (HOLDLOCK) AS target
        USING (
            SELECT DISTINCT plan.lineId, optionRow.optionId, optionRow.appliesFromDate, optionRow.appliesToDate,
                   optionRow.requiredRateFactor, optionRow.requiredUtilisation
            FROM dbo.production_options AS optionRow
            INNER JOIN dbo.capacity_plan AS plan
                ON plan.optionId = optionRow.optionId AND plan.planVariant = 'approved'
            WHERE optionRow.optionId = @optionId
        ) AS source
        ON target.lineId = source.lineId
        WHEN MATCHED THEN UPDATE SET
            optionId = source.optionId, effectiveFromDate = source.appliesFromDate,
            effectiveToDate = source.appliesToDate, rateFactor = source.requiredRateFactor,
            utilisation = source.requiredUtilisation, approvedByObjectId = @actorObjectId,
            approvedAt = @approvedAt, correlationId = @correlationId
        WHEN NOT MATCHED THEN INSERT (
            lineId, optionId, effectiveFromDate, effectiveToDate, rateFactor, utilisation,
            approvedByObjectId, approvedAt, correlationId
        ) VALUES (
            source.lineId, source.optionId, source.appliesFromDate, source.appliesToDate,
            source.requiredRateFactor, source.requiredUtilisation, @actorObjectId, @approvedAt, @correlationId
        );
    END
    ELSE IF @actionType = 'maintenance_deferral'
    BEGIN
        SELECT TOP (1)
            @policyId = evaluation.policyId,
            @policyVersion = evaluation.policyVersion,
            @detailsJson = (
                SELECT windowRow.maintenanceWindowId, windowRow.deferralDays, evaluation.optionId
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            )
        FROM dbo.maintenance_windows AS windowRow
        INNER JOIN dbo.maintenance_policy_evaluations AS evaluation ON evaluation.optionId = @optionId
        INNER JOIN dbo.production_options AS optionRow ON optionRow.optionId = evaluation.optionId
        INNER JOIN dbo.approved_policies AS policy
            ON policy.policyId = evaluation.policyId AND policy.policyVersion = evaluation.policyVersion
        WHERE windowRow.maintenanceWindowId = @maintenanceWindowId
          AND optionRow.recommended = 1
          AND optionRow.policyCompliant = 1
          AND optionRow.secondaryApproverRole = @actorRole
          AND evaluation.requestedDeferralDays = windowRow.deferralDays
          AND evaluation.requestedDeferralDays <= evaluation.permittedDeferralDays
          AND evaluation.withinStressCeiling = 1
          AND evaluation.policyPass = 1
          AND policy.status = 'approved'
          AND policy.effectiveFrom <= @approvedAt
        ORDER BY policy.effectiveFrom DESC, policy.policyVersion DESC;

        IF @policyId IS NULL
            THROW 51006, 'The maintenance window, approver role, or maintenance policy is invalid.', 1;

        MERGE dbo.runtime_maintenance_state WITH (HOLDLOCK) AS target
        USING (
            SELECT maintenanceWindowId, deferredStartDate, deferredEndDate, deferralDays
            FROM dbo.maintenance_windows WHERE maintenanceWindowId = @maintenanceWindowId
        ) AS source
        ON target.maintenanceWindowId = source.maintenanceWindowId
        WHEN MATCHED THEN UPDATE SET
            deferredStartDate = source.deferredStartDate, deferredEndDate = source.deferredEndDate,
            deferralDays = source.deferralDays, approvedByObjectId = @actorObjectId,
            approvedAt = @approvedAt, correlationId = @correlationId
        WHEN NOT MATCHED THEN INSERT (
            maintenanceWindowId, deferredStartDate, deferredEndDate, deferralDays,
            approvedByObjectId, approvedAt, correlationId
        ) VALUES (
            source.maintenanceWindowId, source.deferredStartDate, source.deferredEndDate,
            source.deferralDays, @actorObjectId, @approvedAt, @correlationId
        );
    END
    ELSE
        THROW 51007, 'Only production-plan and maintenance-deferral actions are permitted.', 1;

    DECLARE @receiptId varchar(50) = CONCAT('RCPT-', CONVERT(varchar(36), NEWID()));
    INSERT dbo.runtime_action_executions (
        invocationId, correlationId, actionType, receiptId, actorObjectId, actorRole,
        approvedAt, policyId, policyVersion, outcome, detailsJson
    ) VALUES (
        @invocationId, @correlationId, @actionType, @receiptId, @actorObjectId, @actorRole,
        @approvedAt, @policyId, @policyVersion, 'success', @detailsJson
    );

    COMMIT TRANSACTION;

    SELECT receiptId, invocationId AS actionId, correlationId, invokedAt AS issuedAt,
           actorRole AS approverRole, policyId, policyVersion, detailsJson
    FROM dbo.runtime_action_executions WHERE invocationId = @invocationId;
END;
GO

IF DATABASE_PRINCIPAL_ID(N'caldova_action_executor') IS NULL
    CREATE ROLE caldova_action_executor;
GRANT EXECUTE ON dbo.execute_governed_action TO caldova_action_executor;
GRANT SELECT ON dbo.runtime_action_executions TO caldova_action_executor;
DENY INSERT, UPDATE, DELETE ON dbo.runtime_action_executions TO caldova_action_executor;
DENY INSERT, UPDATE, DELETE ON dbo.runtime_production_plan_state TO caldova_action_executor;
DENY INSERT, UPDATE, DELETE ON dbo.runtime_maintenance_state TO caldova_action_executor;
DENY INSERT, UPDATE, DELETE ON dbo.governed_actions TO caldova_action_executor;
DENY INSERT, UPDATE, DELETE ON dbo.action_receipts TO caldova_action_executor;
GO