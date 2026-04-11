-- CreateTable
CREATE TABLE "ProjectSource" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "provider"    "IntegrationProvider" NOT NULL,
    "externalId"  TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSource_projectId_provider_externalId_key" ON "ProjectSource"("projectId", "provider", "externalId");

-- CreateIndex
CREATE INDEX "ProjectSource_tenantId_idx" ON "ProjectSource"("tenantId");

-- CreateIndex
CREATE INDEX "ProjectSource_projectId_idx" ON "ProjectSource"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
