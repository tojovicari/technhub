-- CreateEnum
CREATE TYPE "SlaInstanceStatus" AS ENUM ('running', 'met', 'at_risk', 'breached', 'superseded');

-- CreateTable
CREATE TABLE "SlaTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "appliesTo" TEXT[],
    "rules" JSONB NOT NULL,
    "escalationRule" JSONB,
    "projectIds" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaInstance" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "slaTemplateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetMinutes" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "SlaInstanceStatus" NOT NULL DEFAULT 'running',
    "actualMinutes" INTEGER,
    "breachMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlaTemplate_tenantId_idx" ON "SlaTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "SlaTemplate_tenantId_isActive_idx" ON "SlaTemplate"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "SlaInstance_tenantId_idx" ON "SlaInstance"("tenantId");

-- CreateIndex
CREATE INDEX "SlaInstance_taskId_idx" ON "SlaInstance"("taskId");

-- CreateIndex
CREATE INDEX "SlaInstance_status_idx" ON "SlaInstance"("status");

-- CreateIndex
CREATE INDEX "SlaInstance_deadlineAt_idx" ON "SlaInstance"("deadlineAt");

-- AddForeignKey
ALTER TABLE "SlaInstance" ADD CONSTRAINT "SlaInstance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaInstance" ADD CONSTRAINT "SlaInstance_slaTemplateId_fkey" FOREIGN KEY ("slaTemplateId") REFERENCES "SlaTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
