-- Create enums for raw ingestion foundation
CREATE TYPE "RawSourceChannel" AS ENUM ('webhook', 'sync_full', 'sync_incremental', 'replay');
CREATE TYPE "RawProcessingStatus" AS ENUM ('queued', 'processing', 'processed', 'failed', 'skipped');
CREATE TYPE "RawIngestionRunStatus" AS ENUM ('queued', 'running', 'success', 'failed');

-- Create raw ingestion tables
CREATE TABLE "RawObject" (
	"id" TEXT NOT NULL,
	"tenantId" TEXT NOT NULL,
	"connectionId" TEXT,
	"provider" "IntegrationProvider" NOT NULL,
	"entityType" TEXT NOT NULL,
	"externalId" TEXT NOT NULL,
	"parentExternalId" TEXT,
	"eventType" TEXT,
	"sourceChannel" "RawSourceChannel" NOT NULL,
	"payload" JSONB NOT NULL,
	"payloadHash" TEXT NOT NULL,
	"occurredAt" TIMESTAMP(3),
	"ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"processingStatus" "RawProcessingStatus" NOT NULL DEFAULT 'queued',
	"processingError" TEXT,
	"schemaHint" TEXT,
	"sequenceCursor" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,

	CONSTRAINT "RawObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RawCheckpoint" (
	"id" TEXT NOT NULL,
	"tenantId" TEXT NOT NULL,
	"connectionId" TEXT NOT NULL,
	"provider" "IntegrationProvider" NOT NULL,
	"entityType" TEXT NOT NULL,
	"cursorValue" TEXT,
	"lastSuccessAt" TIMESTAMP(3),
	"lastAttemptAt" TIMESTAMP(3),
	"status" "RawProcessingStatus" NOT NULL DEFAULT 'queued',
	"metadata" JSONB,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" TIMESTAMP(3) NOT NULL,

	CONSTRAINT "RawCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RawIngestionRun" (
	"id" TEXT NOT NULL,
	"tenantId" TEXT NOT NULL,
	"connectionId" TEXT NOT NULL,
	"provider" "IntegrationProvider" NOT NULL,
	"mode" "SyncMode" NOT NULL DEFAULT 'incremental',
	"status" "RawIngestionRunStatus" NOT NULL DEFAULT 'queued',
	"startedAt" TIMESTAMP(3),
	"finishedAt" TIMESTAMP(3),
	"objectsReceived" INTEGER NOT NULL DEFAULT 0,
	"objectsInserted" INTEGER NOT NULL DEFAULT 0,
	"objectsDeduplicated" INTEGER NOT NULL DEFAULT 0,
	"errorSummary" TEXT,
	"metadata" JSONB,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

	CONSTRAINT "RawIngestionRun_pkey" PRIMARY KEY ("id")
);

-- Indexes and unique constraints
CREATE UNIQUE INDEX "RawObject_tenantId_provider_entityType_externalId_payloadHash_key"
ON "RawObject"("tenantId", "provider", "entityType", "externalId", "payloadHash");

CREATE INDEX "RawObject_tenantId_provider_entityType_idx"
ON "RawObject"("tenantId", "provider", "entityType");

CREATE INDEX "RawObject_tenantId_connectionId_entityType_idx"
ON "RawObject"("tenantId", "connectionId", "entityType");

CREATE INDEX "RawObject_tenantId_processingStatus_ingestedAt_idx"
ON "RawObject"("tenantId", "processingStatus", "ingestedAt");

CREATE UNIQUE INDEX "RawCheckpoint_tenantId_connectionId_provider_entityType_key"
ON "RawCheckpoint"("tenantId", "connectionId", "provider", "entityType");

CREATE INDEX "RawCheckpoint_tenantId_provider_entityType_idx"
ON "RawCheckpoint"("tenantId", "provider", "entityType");

CREATE INDEX "RawIngestionRun_tenantId_provider_status_idx"
ON "RawIngestionRun"("tenantId", "provider", "status");

CREATE INDEX "RawIngestionRun_tenantId_connectionId_createdAt_idx"
ON "RawIngestionRun"("tenantId", "connectionId", "createdAt");

-- Foreign keys
ALTER TABLE "RawObject"
ADD CONSTRAINT "RawObject_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawObject"
ADD CONSTRAINT "RawObject_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RawCheckpoint"
ADD CONSTRAINT "RawCheckpoint_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawCheckpoint"
ADD CONSTRAINT "RawCheckpoint_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawIngestionRun"
ADD CONSTRAINT "RawIngestionRun_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawIngestionRun"
ADD CONSTRAINT "RawIngestionRun_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
