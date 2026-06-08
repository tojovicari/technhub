-- CreateEnum
CREATE TYPE "ResourceGroupCalculationPolicyStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateTable
CREATE TABLE "ResourceGroupCalculationPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceGroupId" TEXT,
    "name" TEXT NOT NULL,
    "status" "ResourceGroupCalculationPolicyStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "config" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceGroupCalculationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceGroupCalculationPolicy_tenantId_resourceGroupId_status_idx" ON "ResourceGroupCalculationPolicy"("tenantId", "resourceGroupId", "status");

-- CreateIndex
CREATE INDEX "ResourceGroupCalculationPolicy_tenantId_status_effectiveFrom_effectiveTo_idx" ON "ResourceGroupCalculationPolicy"("tenantId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "ResourceGroupCalculationPolicy_tenantId_resourceGroupId_version_idx" ON "ResourceGroupCalculationPolicy"("tenantId", "resourceGroupId", "version");

-- AddForeignKey
ALTER TABLE "ResourceGroupCalculationPolicy" ADD CONSTRAINT "ResourceGroupCalculationPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupCalculationPolicy" ADD CONSTRAINT "ResourceGroupCalculationPolicy_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "ResourceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
