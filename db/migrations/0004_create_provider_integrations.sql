-- Módulo de Integrações (.spec/spec-engineering-intelligence.md, Seção 4.2).
-- Uma integração ativa por (tenant, provider) no MVP. Credenciais nunca em texto puro:
-- encrypted_credentials guarda o JSON de ProviderCredentials cifrado via pgcrypto,
-- com a chave de criptografia mantida fora do banco (env var / Fly secret).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE provider_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,   -- 'github', 'gitlab', 'jira', 'linear', 'slack', 'teams', ...
    category VARCHAR(50) NOT NULL,   -- 'issue_tracker', 'vcs', 'cicd', 'incident', 'communication'
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ERROR', 'DISABLED'

    encrypted_credentials BYTEA NOT NULL, -- pgp_sym_encrypt(json_credentials, chave_da_app)

    last_cursor TEXT,                     -- espelha SyncContext.cursor / SyncResult.nextCursor
    last_synced_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider UNIQUE (tenant_id, provider)
);

CREATE INDEX idx_provider_integrations_tenant_id ON provider_integrations (tenant_id);

-- Segregação de acessos (Seção 4.3): RLS habilitada e forçada, mesmo para o owner da tabela.
ALTER TABLE provider_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_integrations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON provider_integrations
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
