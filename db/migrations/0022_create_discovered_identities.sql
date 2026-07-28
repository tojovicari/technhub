-- Camada de staging para identidades externas descobertas durante o sync
-- (autores de PR, assignees de issue/incidente, quem disparou um deploy)
-- que ainda não correspondem a um `users` real — `users.status` já previa
-- o estado 'DISCOVERED' desde a spec original, mas o sync nunca o
-- populava. Alimenta GET /tenants/:tenantId/discovered-users, de onde um
-- ADMIN convida/vincula a pessoa via POST /tenants/:tenantId/users +
-- POST /tenants/:tenantId/users/:userId/aliases (mecanismos já existentes,
-- nenhuma escrita nova é necessária aqui).
CREATE TABLE discovered_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider VARCHAR(50) NOT NULL,
    external_user_id VARCHAR(255) NOT NULL,
    external_username VARCHAR(255),
    external_email VARCHAR(255),
    external_avatar_url TEXT,

    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_external_identity UNIQUE (tenant_id, provider, external_user_id)
);

CREATE INDEX idx_discovered_identities_tenant_id ON discovered_identities (tenant_id);

ALTER TABLE discovered_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovered_identities FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON discovered_identities
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
