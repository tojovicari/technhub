-- SLA state machine removal: replace SlaInstance + SlaTaskSnapshot with on-demand compliance endpoint.
-- Tasks are now queried directly by the SLA service at read time — no persistent instance state.

-- Drop SlaInstance foreign keys first
ALTER TABLE IF EXISTS "SlaInstance" DROP CONSTRAINT IF EXISTS "SlaInstance_taskId_fkey";
ALTER TABLE IF EXISTS "SlaInstance" DROP CONSTRAINT IF EXISTS "SlaInstance_slaTemplateId_fkey";

-- Drop tables
DROP TABLE IF EXISTS "SlaInstance";
DROP TABLE IF EXISTS "SlaTaskSnapshot";

-- Drop slaStatus column from Task (now computed on-demand)
ALTER TABLE "Task" DROP COLUMN IF EXISTS "slaStatus";

-- Drop enums
DROP TYPE IF EXISTS "SlaInstanceStatus";
DROP TYPE IF EXISTS "TaskSlaStatus";
