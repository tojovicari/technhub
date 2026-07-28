-- Camada Canônica: Deploys (GitHub Actions, ArgoCD), conforme
-- .spec/spec-engineering-intelligence.md, Seção 5. Fecha o quarteto do
-- DORA (falta só Deployment Frequency até aqui). Nasce com tenant_id/RLS
-- desde o início.
CREATE TABLE canonical_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider VARCHAR(50) NOT NULL,          -- 'github_actions', 'argocd'
    external_id VARCHAR(255) NOT NULL,
    environment VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,            -- 'SUCCESS', 'FAILURE', 'IN_PROGRESS', 'CANCELLED'

    service_name VARCHAR(255),
    commit_sha VARCHAR(100),
    triggered_by_external_id VARCHAR(255),

    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,

    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_deployment UNIQUE (tenant_id, provider, external_id)
);

CREATE INDEX idx_canonical_deployments_tenant_id ON canonical_deployments (tenant_id);
CREATE INDEX idx_canonical_deployments_started_at ON canonical_deployments (started_at);

ALTER TABLE canonical_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_deployments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON canonical_deployments
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
