SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF SCHEMA_ID(N'act3') IS NULL EXEC(N'CREATE SCHEMA act3');

IF OBJECT_ID(N'act3.guidance', N'U') IS NULL
BEGIN
    CREATE TABLE act3.guidance (
        guidanceId nvarchar(100) NOT NULL PRIMARY KEY,
        lineId nvarchar(100) NOT NULL,
        title nvarchar(300) NOT NULL,
        excerpt nvarchar(4000) NOT NULL,
        sourceCaseId nvarchar(100) NOT NULL,
        sourceVersion nvarchar(100) NOT NULL,
        sourceHash char(64) NOT NULL,
        policyId nvarchar(100) NOT NULL,
        policyVersion nvarchar(100) NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'draft',
        sourceType varchar(16) NOT NULL DEFAULT 'lesson',
        approvedBy uniqueidentifier NULL,
        proposedBy uniqueidentifier NULL,
        approvedAt datetime2 NULL,
        validFrom datetime2 NOT NULL,
        validUntil datetime2 NULL,
        embeddingProfile nvarchar(200) NOT NULL,
        embedding VECTOR(1536) NOT NULL,
        CONSTRAINT CK_guidance_status CHECK (status IN ('draft', 'approved', 'withdrawn', 'source_approved')),
        CONSTRAINT CK_guidance_source CHECK (sourceType IN ('policy', 'lesson') AND (status <> 'source_approved' OR sourceType = 'policy')),
        CONSTRAINT CK_guidance_approval CHECK (
            status <> 'approved' OR (approvedBy IS NOT NULL AND approvedAt IS NOT NULL)
        ),
        CONSTRAINT CK_guidance_validity CHECK (validUntil IS NULL OR validUntil > validFrom)
    );
END;

IF COL_LENGTH('act3.guidance','proposedBy') IS NULL
    ALTER TABLE act3.guidance ADD proposedBy uniqueidentifier NULL;

COMMIT;