-- CreateEnum
CREATE TYPE "MetricFormulaStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "MetricComputationRunStatus" AS ENUM ('queued', 'running', 'success', 'failed');

-- CreateTable
CREATE TABLE "MetricFormula" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MetricFormulaStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricFormula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricComputationRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" "MetricComputationRunStatus" NOT NULL DEFAULT 'queued',
    "triggeredBy" TEXT,
    "triggerReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "inputSummary" JSONB,
    "resultSummary" JSONB,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricComputationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterializedInsight" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "formulaId" TEXT NOT NULL,
    "runId" TEXT,
    "metricKey" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "formulaVersion" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "explanation" JSONB,
    "sourceSummary" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterializedInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricFormula_tenantId_squadId_status_idx" ON "MetricFormula"("tenantId", "squadId", "status");

-- CreateIndex
CREATE INDEX "MetricFormula_tenantId_squadId_key_idx" ON "MetricFormula"("tenantId", "squadId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MetricFormula_tenantId_squadId_key_version_key" ON "MetricFormula"("tenantId", "squadId", "key", "version");

-- CreateIndex
CREATE INDEX "MetricComputationRun_tenantId_squadId_status_idx" ON "MetricComputationRun"("tenantId", "squadId", "status");

-- CreateIndex
CREATE INDEX "MetricComputationRun_tenantId_squadId_windowStart_windowEnd_idx" ON "MetricComputationRun"("tenantId", "squadId", "windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "MaterializedInsight_tenantId_squadId_metricKey_idx" ON "MaterializedInsight"("tenantId", "squadId", "metricKey");

-- CreateIndex
CREATE INDEX "MaterializedInsight_tenantId_squadId_computedAt_idx" ON "MaterializedInsight"("tenantId", "squadId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterializedInsight_tenantId_squadId_formulaId_windowStart__key" ON "MaterializedInsight"("tenantId", "squadId", "formulaId", "windowStart", "windowEnd");

-- AddForeignKey
ALTER TABLE "MetricFormula" ADD CONSTRAINT "MetricFormula_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricFormula" ADD CONSTRAINT "MetricFormula_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricComputationRun" ADD CONSTRAINT "MetricComputationRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricComputationRun" ADD CONSTRAINT "MetricComputationRun_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterializedInsight" ADD CONSTRAINT "MaterializedInsight_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterializedInsight" ADD CONSTRAINT "MaterializedInsight_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterializedInsight" ADD CONSTRAINT "MaterializedInsight_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "MetricFormula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterializedInsight" ADD CONSTRAINT "MaterializedInsight_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MetricComputationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;