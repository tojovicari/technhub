-- Camada Canônica: Work Items (Jira, Linear), conforme
-- .spec/spec-engineering-intelligence.md, Seção 5 (já atualizada com
-- tenant_id/RLS numa rodada anterior). Tenant-scoped: RLS habilitada e
-- forçada, mesmo padrão de todas as outras tabelas (Seção 4.3).
CREATE TABLE canonical_work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider VARCHAR(50) NOT NULL,        -- 'jira', 'linear'
    external_id VARCHAR(255) NOT NULL,    -- 'PROJ-123'
    raw_issue_type VARCHAR(100) NOT NULL, -- 'Story', 'Bug'
    raw_status VARCHAR(100) NOT NULL,     -- 'In Progress'
    raw_labels TEXT[],                    -- ['tech-debt', 'checkout']
    title TEXT NOT NULL,
    assignee_external_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_item UNIQUE (tenant_id, provider, external_id)
);

CREATE INDEX idx_canonical_work_items_tenant_id ON canonical_work_items (tenant_id);
CREATE INDEX idx_canonical_work_items_updated_at ON canonical_work_items (updated_at);

ALTER TABLE canonical_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_work_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON canonical_work_items
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
