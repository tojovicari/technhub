-- Histórico de execução de sync/enrichment por integração — hoje só existe
-- o estado mais recente (provider_integrations.status/last_synced_at), sem
-- registro de execuções passadas. Uma linha por chamada a
-- SyncOrchestrator.runSyncForIntegration ou EnrichmentService.runForIntegration
-- (manual ou via /internal/sync do cron), sucesso ou falha.
--
-- ON DELETE CASCADE de propósito (diferente de work_items/deployments, que
-- bloqueiam a exclusão da integração via FK RESTRICT): isto é log de
-- auditoria/operação, não dado de negócio — não faz sentido travar a
-- exclusão de uma integração só por ter histórico de execução.
CREATE TABLE integration_run_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    integration_id UUID NOT NULL REFERENCES provider_integrations(id) ON DELETE CASCADE,
    run_type VARCHAR(20) NOT NULL CHECK (run_type IN ('sync', 'enrichment')),
    triggered_by VARCHAR(20) NOT NULL CHECK (triggered_by IN ('manual', 'cron')),
    success BOOLEAN NOT NULL,
    summary JSONB,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_run_history_lookup
    ON integration_run_history (tenant_id, integration_id, started_at DESC);

ALTER TABLE integration_run_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_run_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON integration_run_history
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
