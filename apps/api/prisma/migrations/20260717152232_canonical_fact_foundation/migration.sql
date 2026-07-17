-- CreateTable
CREATE TABLE "CanonicalFact" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "factType" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceExternalId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "canonicalVersion" INTEGER NOT NULL DEFAULT 1,
    "transformVersion" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalFactAttribute" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "attributeName" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "valueString" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "valueBoolean" BOOLEAN,
    "valueDatetime" TIMESTAMP(3),
    "valueJson" JSONB,
    "isMultivalue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalFactAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalFactRelation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromFactId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "toFactId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalFactRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalLineage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rawObjectId" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "transformVersion" TEXT NOT NULL,
    "extractionPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalLineage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanonicalFact_tenantId_factType_occurredAt_idx" ON "CanonicalFact"("tenantId", "factType", "occurredAt");

-- CreateIndex
CREATE INDEX "CanonicalFact_provider_sourceEntityType_idx" ON "CanonicalFact"("provider", "sourceEntityType");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalFact_tenantId_factType_factKey_canonicalVersion_key" ON "CanonicalFact"("tenantId", "factType", "factKey", "canonicalVersion");

-- CreateIndex
CREATE INDEX "CanonicalFactAttribute_factId_attributeName_idx" ON "CanonicalFactAttribute"("factId", "attributeName");

-- CreateIndex
CREATE INDEX "CanonicalFactAttribute_tenantId_attributeName_valueString_idx" ON "CanonicalFactAttribute"("tenantId", "attributeName", "valueString");

-- CreateIndex
CREATE INDEX "CanonicalFactAttribute_tenantId_attributeName_valueNumber_idx" ON "CanonicalFactAttribute"("tenantId", "attributeName", "valueNumber");

-- CreateIndex
CREATE INDEX "CanonicalFactRelation_tenantId_relationType_idx" ON "CanonicalFactRelation"("tenantId", "relationType");

-- CreateIndex
CREATE INDEX "CanonicalFactRelation_fromFactId_idx" ON "CanonicalFactRelation"("fromFactId");

-- CreateIndex
CREATE INDEX "CanonicalFactRelation_toFactId_idx" ON "CanonicalFactRelation"("toFactId");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalLineage_rawObjectId_key" ON "CanonicalLineage"("rawObjectId");

-- CreateIndex
CREATE INDEX "CanonicalLineage_tenantId_rawObjectId_idx" ON "CanonicalLineage"("tenantId", "rawObjectId");

-- CreateIndex
CREATE INDEX "CanonicalLineage_tenantId_factId_idx" ON "CanonicalLineage"("tenantId", "factId");

-- AddForeignKey
ALTER TABLE "CanonicalFact" ADD CONSTRAINT "CanonicalFact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalFactAttribute" ADD CONSTRAINT "CanonicalFactAttribute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalFactAttribute" ADD CONSTRAINT "CanonicalFactAttribute_factId_fkey" FOREIGN KEY ("factId") REFERENCES "CanonicalFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalFactRelation" ADD CONSTRAINT "CanonicalFactRelation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalFactRelation" ADD CONSTRAINT "CanonicalFactRelation_fromFactId_fkey" FOREIGN KEY ("fromFactId") REFERENCES "CanonicalFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalFactRelation" ADD CONSTRAINT "CanonicalFactRelation_toFactId_fkey" FOREIGN KEY ("toFactId") REFERENCES "CanonicalFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalLineage" ADD CONSTRAINT "CanonicalLineage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalLineage" ADD CONSTRAINT "CanonicalLineage_rawObjectId_fkey" FOREIGN KEY ("rawObjectId") REFERENCES "RawObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalLineage" ADD CONSTRAINT "CanonicalLineage_factId_fkey" FOREIGN KEY ("factId") REFERENCES "CanonicalFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
