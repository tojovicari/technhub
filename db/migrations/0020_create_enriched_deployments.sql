-- Enriched Layer para Deploys (Seção 5 da spec) — mesmo padrão de
-- enriched_work_items: id compartilha PK com canonical_deployments,
-- team_id NOT NULL (GitHub Actions segue o modelo 1 integração = 1 time,
-- igual Jira/Linear).
CREATE TABLE enriched_deployments (
    id UUID PRIMARY KEY REFERENCES canonical_deployments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

    semantic_environment VARCHAR(20) NOT NULL, -- 'PRODUCTION', 'STAGING', 'OTHER'

    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    applied_rule_version TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_enriched_deployments_tenant_id ON enriched_deployments (tenant_id);
CREATE INDEX idx_enriched_deployments_team_id ON enriched_deployments (team_id);

ALTER TABLE enriched_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enriched_deployments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON enriched_deployments
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
