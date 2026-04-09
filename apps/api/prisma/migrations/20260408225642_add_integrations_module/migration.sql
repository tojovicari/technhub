-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('jira', 'github');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('active', 'disabled', 'error');

-- CreateEnum
CREATE TYPE "SecretStrategy" AS ENUM ('vault_ref', 'db_encrypted');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('full', 'incremental');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('queued', 'running', 'success', 'failed');

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "scope" JSONB,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'active',
    "secretStrategy" "SecretStrategy" NOT NULL DEFAULT 'db_encrypted',
    "secretLastRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSecret" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "strategy" "SecretStrategy" NOT NULL,
    "encryptedBlob" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "mode" "SyncMode" NOT NULL DEFAULT 'incremental',
    "status" "SyncJobStatus" NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "result" JSONB,

    CONSTRAINT "IntegrationSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_tenantId_idx" ON "IntegrationConnection"("tenantId");

-- CreateIndex
CREATE INDEX "IntegrationConnection_provider_idx" ON "IntegrationConnection"("provider");

-- CreateIndex
CREATE INDEX "IntegrationSecret_connectionId_version_idx" ON "IntegrationSecret"("connectionId", "version");

-- CreateIndex
CREATE INDEX "IntegrationSecret_tenantId_idx" ON "IntegrationSecret"("tenantId");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_tenantId_idx" ON "IntegrationSyncJob"("tenantId");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_connectionId_idx" ON "IntegrationSyncJob"("connectionId");

-- CreateIndex
CREATE INDEX "IntegrationSyncJob_status_idx" ON "IntegrationSyncJob"("status");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSecret" ADD CONSTRAINT "IntegrationSecret_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSyncJob" ADD CONSTRAINT "IntegrationSyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
