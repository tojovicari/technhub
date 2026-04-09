-- AddUniqueConstraint: Epic (tenantId, source, sourceId)
-- Allows safe upsert during GitHub/Jira sync.
-- NULL sourceId values are excluded from uniqueness checks in PostgreSQL.
CREATE UNIQUE INDEX "Epic_tenantId_source_sourceId_key" ON "Epic"("tenantId", "source", "sourceId");

-- AddUniqueConstraint: Task (tenantId, source, sourceId)
CREATE UNIQUE INDEX "Task_tenantId_source_sourceId_key" ON "Task"("tenantId", "source", "sourceId");
