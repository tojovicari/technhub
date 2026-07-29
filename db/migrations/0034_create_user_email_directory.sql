-- Índice cross-tenant email → (tenant_id, user_id), deliberadamente SEM RLS
-- (mesmo racional de `tenants`, 0003: é a raiz que permite resolver "a qual
-- tenant esse email pertence" antes mesmo do tenant ser conhecido — RLS
-- derrotaria o propósito). Existe pra suportar login SSO-first: autentica
-- via GitHub sem saber o tenant de antemão, resolve o(s) tenant(s) depois
-- via este índice.
--
-- PRIMARY KEY (user_id), não composto: é um espelho 1:1 de uma linha por
-- `users.id` (um usuário tem exatamente um primary_email), então user_id
-- sozinho já é a chave natural. O índice único em (tenant_id, email) espelha
-- `users.unique_tenant_primary_email` (0006) como invariante redundante.
CREATE TABLE user_email_directory (
    email VARCHAR(255) NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id)
);

CREATE INDEX idx_user_email_directory_email ON user_email_directory (email);
CREATE UNIQUE INDEX idx_user_email_directory_tenant_email ON user_email_directory (tenant_id, email);

-- Backfill dos usuários já existentes. FORCE ROW LEVEL SECURITY vale mesmo
-- pra migrations (a role da app não tem BYPASSRLS) — desliga temporariamente
-- pra ler `users` cross-tenant, religa antes do fim da transação (mesmo
-- padrão já usado nas migrations 0029 e 0031).
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

INSERT INTO user_email_directory (email, tenant_id, user_id)
SELECT primary_email, tenant_id, id FROM users;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
