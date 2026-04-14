-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'closed');

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "priority" TEXT,
    "severity" TEXT,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "affectedServices" TEXT[],
    "responderIds" TEXT[],
    "tags" TEXT[],
    "rawPayload" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentEvent_tenantId_openedAt_idx" ON "IncidentEvent"("tenantId", "openedAt");

-- CreateIndex
CREATE INDEX "IncidentEvent_tenantId_priority_resolvedAt_idx" ON "IncidentEvent"("tenantId", "priority", "resolvedAt");

-- CreateIndex
CREATE INDEX "IncidentEvent_connectionId_idx" ON "IncidentEvent"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "IncidentEvent_tenantId_provider_externalId_key" ON "IncidentEvent"("tenantId", "provider", "externalId");

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
