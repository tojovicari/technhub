-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "graceExtensionDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ImpersonationAudit" (
    "id" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "impersonatedAs" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "tokenIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "firstUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationAudit_initiatedBy_idx" ON "ImpersonationAudit"("initiatedBy");

-- CreateIndex
CREATE INDEX "ImpersonationAudit_tenantId_idx" ON "ImpersonationAudit"("tenantId");

-- CreateIndex
CREATE INDEX "ImpersonationAudit_tokenIssuedAt_idx" ON "ImpersonationAudit"("tokenIssuedAt");
