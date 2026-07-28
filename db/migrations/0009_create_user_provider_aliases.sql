-- Aliases de Provedores Conectados, conforme .spec/spec-engineering-intelligence.md,
-- Seção 4.1 — com correção de isolamento multi-tenant (Seção 1, Princípio 5):
-- a DDL original da spec não tem tenant_id direto (só via JOIN em users), e a
-- unique constraint original (provider, external_user_id) impediria a mesma
-- identidade externa (ex: um contractor) de ser vinculada em dois tenants
-- diferentes. tenant_id denormalizado resolve as duas coisas.
CREATE TABLE user_provider_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'github', 'jira', 'slack', 'teams', 'linear'
    external_user_id VARCHAR(255) NOT NULL,
    external_username VARCHAR(255),
    external_email VARCHAR(255),

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_external_id UNIQUE (tenant_id, provider, external_user_id)
);

CREATE INDEX idx_user_provider_aliases_tenant_id ON user_provider_aliases (tenant_id);
CREATE INDEX idx_user_provider_aliases_user_id ON user_provider_aliases (user_id);

ALTER TABLE user_provider_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_provider_aliases FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON user_provider_aliases
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
