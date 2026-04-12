-- Add hourlyRate to User (for COGS derivation; sensitive field)
ALTER TABLE "User" ADD COLUMN "hourlyRate" DOUBLE PRECISION;

-- Add hourlyRate to Team (fallback rate when user has no individual rate)
ALTER TABLE "Team" ADD COLUMN "hourlyRate" DOUBLE PRECISION;

-- Add revision tracking and isDerived flag to CogsEntry
ALTER TABLE "CogsEntry"
  ADD COLUMN "revision"      INTEGER   NOT NULL DEFAULT 1,
  ADD COLUMN "supersededAt"  TIMESTAMP(3),
  ADD COLUMN "isDerived"     BOOLEAN   NOT NULL DEFAULT false;

-- Index to efficiently find active derived entries per task
CREATE INDEX "CogsEntry_tenantId_taskId_isDerived_idx"
  ON "CogsEntry"("tenantId", "taskId", "isDerived");

-- Index to query superseded entries for audit
CREATE INDEX "CogsEntry_supersededAt_idx"
  ON "CogsEntry"("supersededAt");
