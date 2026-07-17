-- DropForeignKey
ALTER TABLE "ResourceGroup" DROP CONSTRAINT "ResourceGroup_ownerUserId_fkey";

-- AlterTable
ALTER TABLE "ResourceGroup" ALTER COLUMN "tags" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "RawObject_tenantId_provider_entityType_externalId_payloadHash_k" RENAME TO "RawObject_tenantId_provider_entityType_externalId_payloadHa_key";

-- RenameIndex
ALTER INDEX "ResourceGroupCalculationPolicy_tenantId_resourceGroupId_status_" RENAME TO "ResourceGroupCalculationPolicy_tenantId_resourceGroupId_sta_idx";

-- RenameIndex
ALTER INDEX "ResourceGroupCalculationPolicy_tenantId_resourceGroupId_version" RENAME TO "ResourceGroupCalculationPolicy_tenantId_resourceGroupId_ver_idx";

-- RenameIndex
ALTER INDEX "ResourceGroupCalculationPolicy_tenantId_status_effectiveFrom_ef" RENAME TO "ResourceGroupCalculationPolicy_tenantId_status_effectiveFro_idx";
