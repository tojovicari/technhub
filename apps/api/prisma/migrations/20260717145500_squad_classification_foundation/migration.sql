-- CreateEnum
CREATE TYPE "SquadStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SquadRuleStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "ClassificationResultStatus" AS ENUM ('matched', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "Squad" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SquadStatus" NOT NULL DEFAULT 'active',
    "resourceGroupId" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadScope" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SquadRuleStatus" NOT NULL DEFAULT 'draft',
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquadScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadClassifier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SquadRuleStatus" NOT NULL DEFAULT 'draft',
    "key" TEXT NOT NULL,
    "appliesToFactType" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquadClassifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationResult" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "classifierId" TEXT,
    "resultKey" TEXT NOT NULL,
    "canonicalFactId" TEXT NOT NULL,
    "status" "ClassificationResultStatus" NOT NULL DEFAULT 'matched',
    "score" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "explanation" JSONB,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Squad_tenantId_key_key" ON "Squad"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Squad_tenantId_idx" ON "Squad"("tenantId");

-- CreateIndex
CREATE INDEX "Squad_resourceGroupId_idx" ON "Squad"("resourceGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadScope_tenantId_squadId_version_key" ON "SquadScope"("tenantId", "squadId", "version");

-- CreateIndex
CREATE INDEX "SquadScope_tenantId_squadId_status_idx" ON "SquadScope"("tenantId", "squadId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SquadClassifier_tenantId_squadId_key_version_key" ON "SquadClassifier"("tenantId", "squadId", "key", "version");

-- CreateIndex
CREATE INDEX "SquadClassifier_tenantId_squadId_status_idx" ON "SquadClassifier"("tenantId", "squadId", "status");

-- CreateIndex
CREATE INDEX "SquadClassifier_tenantId_appliesToFactType_idx" ON "SquadClassifier"("tenantId", "appliesToFactType");

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationResult_tenantId_squadId_canonicalFactId_resultKey_key" ON "ClassificationResult"("tenantId", "squadId", "canonicalFactId", "resultKey");

-- CreateIndex
CREATE INDEX "ClassificationResult_tenantId_squadId_status_idx" ON "ClassificationResult"("tenantId", "squadId", "status");

-- CreateIndex
CREATE INDEX "ClassificationResult_tenantId_canonicalFactId_idx" ON "ClassificationResult"("tenantId", "canonicalFactId");

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Squad" ADD CONSTRAINT "Squad_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "ResourceGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadScope" ADD CONSTRAINT "SquadScope_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadScope" ADD CONSTRAINT "SquadScope_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadClassifier" ADD CONSTRAINT "SquadClassifier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadClassifier" ADD CONSTRAINT "SquadClassifier_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_classifierId_fkey" FOREIGN KEY ("classifierId") REFERENCES "SquadClassifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationResult" ADD CONSTRAINT "ClassificationResult_canonicalFactId_fkey" FOREIGN KEY ("canonicalFactId") REFERENCES "CanonicalFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;