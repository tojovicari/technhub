# Módulo de Gestão de Identidades e Times

Parte de [spec-engineering-intelligence.md](./spec-engineering-intelligence.md) (índice) — Seções 1 e 2 (Visão Geral, Ecossistema de Origens) ficam lá; o resto foi quebrado por tópico neste diretório.

## 4. Módulo de Gestão de Identidades e Times (Unified Identity & Access Engine)

Funciona como a fonte da verdade para pessoas e times, combinando agregação telemétrica (aliases) e controle de acesso ao SaaS (Entidade Composta).

+---------------------------------------------------------------------------------+
| USER ENTITY (Entidade Composta) |
| |
| [ Dados da Plataforma ] [ Aliases de Provedores Conectados ] |
| - ID: usr_99 - GitHub: @jsilva |
| - Email Principal: joao@... - Jira: account-id-1234 |
| - Status: ACTIVE / INVITED - Slack: U01234567 |
| - Role: Tech Lead - Teams: teams-guid-88 |
| - Team: Squad Checkout |
+---------------------------------------------------------------------------------+

### 4.1. Schemas DDL do Módulo de Identidades e Times

-- 0. Tabela de Tenants (raiz do isolamento multi-tenant — ver Seção 1, Princípio 5)
CREATE TABLE tenants (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
name VARCHAR(255) NOT NULL,
status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED'

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()

);
-- Não é tenant-scoped (é a própria raiz), portanto não recebe RLS.

-- 1. Tabela de Times (com Parametrização de Capacidade)
CREATE TABLE teams (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
name VARCHAR(255) NOT NULL,

    -- Configuração de Capacidade do Time (Base Configurável por Time em Horas)
    default_monthly_capacity_hours NUMERIC(6,2) NOT NULL DEFAULT 160.00, -- ex: 168.00, 160.00, 140.00
    planning_cycle VARCHAR(50) NOT NULL DEFAULT 'MONTHLY',              -- 'MONTHLY', 'WEEKLY', 'BIWEEKLY_SPRINT'
    working_days_per_week INT NOT NULL DEFAULT 5,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()

);

-- 2. Tabela Principal de Usuários (Entidade Composta)
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

-- 3. Aliases de Provedores Conectados
-- tenant_id denormalizado (Seção 1, Princípio 5 / Seção 4.3): sem ele não dá
-- pra escrever a policy de RLS sem JOIN, e a unique constraint original
-- (sem tenant_id) impediria a mesma identidade externa de ser vinculada em
-- dois tenants diferentes (ex: um contractor atendendo dois clientes).
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

-- 4. Associação e Alocação de Membros em Times
-- tenant_id denormalizado de teams.tenant_id, mesmo motivo do item 3.
CREATE TABLE team_memberships (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
role_in_team VARCHAR(50) DEFAULT 'DEVELOPER',

    -- Dedicação Individual e Sobrescrita
    capacity_allocation_percent NUMERIC(5,2) DEFAULT 100.00,
    custom_monthly_capacity_hours NUMERIC(6,2) NULL,

    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_user_team UNIQUE (user_id, team_id)

);

-- Seção 4: teams, users, user_provider_aliases e team_memberships são todas
-- tenant-scoped — RLS habilitada e forçada em todas (Seção 4.3), mesmo padrão
-- da Camada Canônica (Seção 5).

### 4.2. Módulo de Integrações

Cada tenant conecta suas próprias ferramentas (GitHub, Jira, Slack, etc.) de forma independente. Gerenciar integrações é responsabilidade exclusiva do `ADMIN` (CLAUDE.md — RBAC: "ADMIN: gestão do tenant, faturamento, **integrações**, convites e configs globais"). No MVP, cada tenant tem no máximo uma integração ativa por provider — múltiplas instâncias do mesmo provider por tenant (ex: dois workspaces do Slack) ficam para uma versão futura.

Credenciais (`ProviderCredentials` — Seção 7) nunca são armazenadas em texto puro: `encrypted_credentials` guarda o JSON serializado cifrado via `pgcrypto` (`pgp_sym_encrypt`), com a chave de criptografia mantida fora do banco (variável de ambiente / secret do Fly.io), nunca em migration ou versionada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE provider_integrations (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
provider VARCHAR(50) NOT NULL, -- 'github', 'gitlab', 'jira', 'linear', 'slack', 'teams', ...
category VARCHAR(50) NOT NULL, -- 'issue_tracker', 'vcs', 'cicd', 'incident', 'communication'
status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ERROR', 'DISABLED'

    encrypted_credentials BYTEA NOT NULL, -- pgp_sym_encrypt(json_credentials, chave_da_app)

    last_cursor TEXT,                          -- espelha SyncContext.cursor / SyncResult.nextCursor
    last_synced_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_tenant_provider UNIQUE (tenant_id, provider)

);

### 4.3. Segregação de Acessos (Row-Level Security)

Isolamento multi-tenant (Seção 1, Princípio 5) é garantido em duas camadas independentes — a aplicação nunca é a única linha de defesa:

1. **Aplicação:** todo repositório filtra/escreve explicitamente por `tenant_id`.
2. **Banco (obrigatório, defesa em profundidade):** toda tabela tenant-scoped tem Row-Level Security habilitada:

   ```sql
   ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <tabela> FORCE ROW LEVEL SECURITY;

   CREATE POLICY tenant_isolation ON <tabela>
       USING (tenant_id = current_setting('app.tenant_id')::uuid)
       WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
   ```

   `FORCE ROW LEVEL SECURITY` é necessário porque, por padrão, o Postgres deixa o **owner** da tabela ignorar RLS — e a role usada pela aplicação (`tojovicari` em desenvolvimento local) é a mesma que cria as tabelas. Sem o `FORCE`, a policy simplesmente não vale para as próprias queries da aplicação. O hardening correto de produção é conectar a aplicação com uma role dedicada, não-owner (para a qual `FORCE` deixaria de ser necessário) — isso ainda não foi implementado; é dívida técnica reconhecida, não um gap silencioso.

   Toda transação que acessa uma tabela tenant-scoped precisa, antes, popular a sessão com `SELECT set_config('app.tenant_id', '<uuid>', true)` (equivalente a `SET LOCAL`, mas seguro para parâmetros via query parametrizada — nunca interpolar o UUID diretamente na string SQL). Hoje essa origem é o `tenantId` explícito do `SyncContext` (fluxo de ingestão batch); quando a camada de Auth (CLAUDE.md — "Autenticação") existir, a mesma variável de sessão será populada a partir do tenant resolvido na sessão autenticada do usuário.

   Sem essa variável de sessão definida, qualquer query numa tabela protegida falha (fail-closed) — comportamento intencional: preferimos erro explícito a vazamento silencioso entre tenants.

