-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('queued', 'processing', 'processed', 'failed');

-- CreateTable
CREATE TABLE "IntegrationWebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "connectionId" TEXT,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationWebhookEvent_tenantId_status_idx" ON "IntegrationWebhookEvent"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IntegrationWebhookEvent_provider_status_idx" ON "IntegrationWebhookEvent"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationWebhookEvent_provider_externalId_key" ON "IntegrationWebhookEvent"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "IntegrationWebhookEvent" ADD CONSTRAINT "IntegrationWebhookEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
