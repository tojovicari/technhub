-- CreateTable
CREATE TABLE "PermissionProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissionKeys" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermissionProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "permissionProfileId" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserPermissionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PermissionProfile_tenantId_idx" ON "PermissionProfile"("tenantId");

-- CreateIndex
CREATE INDEX "PermissionProfile_tenantId_isActive_idx" ON "PermissionProfile"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionProfile_accountId_permissionProfileId_key" ON "UserPermissionProfile"("accountId", "permissionProfileId");

-- CreateIndex
CREATE INDEX "UserPermissionProfile_tenantId_idx" ON "UserPermissionProfile"("tenantId");

-- CreateIndex
CREATE INDEX "UserPermissionProfile_accountId_idx" ON "UserPermissionProfile"("accountId");

-- AddForeignKey
ALTER TABLE "PermissionProfile" ADD CONSTRAINT "PermissionProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionProfile" ADD CONSTRAINT "UserPermissionProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionProfile" ADD CONSTRAINT "UserPermissionProfile_permissionProfileId_fkey" FOREIGN KEY ("permissionProfileId") REFERENCES "PermissionProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
