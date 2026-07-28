-- Tabela Principal de Usuários (Entidade Composta), conforme
-- .spec/spec-engineering-intelligence.md, Seção 4.1. Tenant-scoped: RLS
-- habilitada e forçada seguindo o padrão da Seção 4.3.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    primary_email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,

    -- Perfis de Acesso (RBAC)
    system_role VARCHAR(50) NOT NULL DEFAULT 'USUARIO', -- 'ADMIN', 'GESTOR', 'USUARIO'

    status VARCHAR(50) NOT NULL DEFAULT 'DISCOVERED',   -- 'DISCOVERED', 'INVITED', 'ACTIVE', 'DISABLED'
    invited_at TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_tenant_primary_email UNIQUE (tenant_id, primary_email)
);

CREATE INDEX idx_users_tenant_id ON users (tenant_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON users
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
