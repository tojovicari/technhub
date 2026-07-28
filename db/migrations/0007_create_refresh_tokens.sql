-- Refresh tokens do fluxo de autenticação (access token curto de 1h + este
-- refresh token de 30 dias, permitindo renovação sem repetir o OAuth e
-- revogação de verdade no logout — algo que um JWT sozinho não permite).
-- Guardado hasheado (SHA-256): nunca o token em claro, mesmo princípio já
-- usado pra credenciais de integração (pgcrypto em provider_integrations).
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_refresh_token_hash UNIQUE (token_hash)
);

CREATE INDEX idx_refresh_tokens_tenant_id ON refresh_tokens (tenant_id);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON refresh_tokens
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
