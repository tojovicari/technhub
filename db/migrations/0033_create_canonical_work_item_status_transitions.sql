-- Histórico de transição de status de work items (Jira changelog, Linear
-- issue.history) — Camada Canônica. Alimenta o cálculo de
-- started_working_at/completed_at na Enriched Layer (Velocity, Cycle Time)
-- e a reconstrução de WIP histórico no perfil de time.
--
-- Correlaciona com canonical_work_items por chave natural
-- (tenant_id, provider_integration_id, work_item_external_id), não por FK
-- direto — mesmo padrão de team_resource_links, evita depender de upsertMany
-- devolver ids.
CREATE TABLE canonical_work_item_status_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider_integration_id UUID NOT NULL REFERENCES provider_integrations(id),
    work_item_external_id VARCHAR(255) NOT NULL,
    external_change_id VARCHAR(255) NOT NULL,  -- id do history/changelog no provider — idempotência de sync
    from_status VARCHAR(100),
    to_status VARCHAR(100) NOT NULL,
    transitioned_at TIMESTAMP WITH TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_integration_change UNIQUE (tenant_id, provider_integration_id, external_change_id)
);

CREATE INDEX idx_work_item_status_transitions_lookup
    ON canonical_work_item_status_transitions (tenant_id, provider_integration_id, work_item_external_id);

ALTER TABLE canonical_work_item_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_work_item_status_transitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON canonical_work_item_status_transitions
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
