# 📄 Especificação Técnica: Plataforma de Engineering Intelligence

- **Status:** Em Construção / Especificação Concluída
- **Versão:** 0.4.0
- **Data:** 22 de Julho de 2026
- **Objetivo:** Plataforma modular de métricas de engenharia (DORA, Flow Metrics, SPACE e Operacionais) com ingestão assíncrona batch, arquitetura plugável, mapeamento semântico dinâmico por time e gestão unificada de identidades.

---

## 1. Visão Geral da Arquitetura de Dados

O sistema adota o padrão ELT (Extract, Load, Transform) estruturado em 4 camadas de dados isoladas. Essa separação garante auditabilidade, suporte a reprocessamento histórico e desacoplamento total entre as APIs externas e as regras de negócio do dashboard.

+-------------------+ +-------------------+ +-------------------+ +-------------------+
| 1. Raw Layer | --> | 2. Canonical L. | --> | 3. Enriched L. | --> | 4. Analytics L. |
| (JSON Bruto) | | (Dados Nativos) | | (Semântica) | | (Aggregates) |
+-------------------+ +-------------------+ +-------------------+ +-------------------+
Payloads de API Modelos Comuns Aplica Regras de Dashboards DORA,
sem alterações (Língua Franca) Domínio/Mapeamentos Flow, SPACE e Ops

### Princípios Norteadores de Design:

1. Assincronismo & Batch First: Ingestão agendada via cron/workers (ex: execuções a cada 1h, 6h ou diárias). Elimina a complexidade de processamento em tempo real, já que a ferramenta é voltada para gestão e inteligência.
2. Pluggable Architecture (Provedores Extensíveis): O core da aplicação interage exclusivamente com a Camada Canônica. Novas ferramentas (GitLab, Bitbucket, Opsgenie, etc.) são adicionadas como novos conectores isolados herdando da classe BaseProvider.
3. Mapeamento Semântico Desconectado & Flexibilidade Total: Nenhuma métrica, gatilho de deploy ou tipo de card possui regra hardcoded. O significado do dado é definido por regras configuráveis por time.
4. Privacidade por Design: Dados sensíveis de comunicação (Slack/Teams) são ingeridos exclusivamente como metadados agregados, sem armazenamento de corpo de mensagens.
5. Isolamento Multi-Tenant por Padrão: Toda tabela que armazena dado de negócio (Camadas Canônica, Enriquecida e de Identidade) carrega `tenant_id` e é protegida por Row-Level Security (RLS) no PostgreSQL — ver Seção 4.3. O filtro por `tenant_id` na camada de aplicação continua existindo, mas nunca é a única barreira contra vazamento de dado entre tenants (empresas clientes).

---

## 2. Ecossistema de Origens e Matriz de Cobertura

O sistema integra 5 categorias de ferramentas para cobrir os principais frameworks da indústria:

- Issue Trackers: Jira / Linear / Azure Boards
- Version Control: GitHub / GitLab / Azure Repos
- CI / CD: GitHub Actions / ArgoCD / Azure Pipelines
- Incident Mgmt: Waroom / PagerDuty
- Communication: Slack / Microsoft Teams

Azure Boards, Azure Repos e Azure Pipelines cobrem, juntos, as 3 categorias acima como conectores independentes (`azure_boards`, `azure_repos`, `azure_pipelines`) — mesmo padrão do par GitHub/GitHub Actions. Construídos sem credencial real de teste (mesmo regime do ArgoCD): ver `docs/BACKLOG.md` para os pontos ainda não verificados ao vivo.

### Matriz de Mapeamento Metrológico:

| Categoria       | Provedores Suportados (MVP)          | Métricas / Dimensões Atendidas                                                                                            |
| :-------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------ |
| Issue Tracker   | Jira, Linear, Azure Boards           | Flow Metrics: Velocity, Distribution, Load (WIP), Time.<br>SPACE: Activity.<br>Operacionais: Toil, Retrabalho.            |
| Version Control | GitHub, GitLab, Azure Repos          | DORA: Lead Time for Changes.<br>SPACE: Activity, Communication & Collaboration.<br>Operacionais: Code Churn / Retrabalho. |
| CI / CD         | GitHub Actions, ArgoCD, Azure Pipelines | DORA: Deployment Frequency.                                                                                            |
| Incidents       | Waroom, PagerDuty                    | DORA: Change Failure Rate, MTTR (Failed Service Recovery).                                                                |
| Communication   | Slack, Microsoft Teams               | SPACE: Communication & Collaboration, Efficiency & Flow (Interrupções/Suporte e Atividade Fora do Horário).               |

---

## 3. Mapeamento Semântico (Domain Context Engine)

Como cada time utiliza as ferramentas de maneira distinta, o sistema adota um motor de regras semânticas com 3 níveis de precedência: Configuração do Time > Configuração da Organização > Fallback Padrão do Sistema.

### 3.1. Estrutura do JSON de Regras (mapping_rules)

{
"tenant_id": "org_123",
"team_id": "squad_checkout",
"updated_at": "2026-07-21T09:30:00Z",
"rules": {
"work_item_type": [
{
"target_category": "BUG",
"match_mode": "ANY",
"conditions": [
{ "field": "issue_type", "operator": "IN", "values": ["Bug", "Defect"] },
{ "field": "labels", "operator": "CONTAINS_ANY", "values": ["bugfix", "prod-issue"] }
]
},
{
"target_category": "TECHNICAL_DEBT",
"match_mode": "ANY",
"conditions": [
{ "field": "issue_type", "operator": "EQUALS", "values": ["Technical Debt"] },
{ "field": "labels", "operator": "CONTAINS_ANY", "values": ["debt", "refactor", "chore"] }
]
},
{
"target_category": "TOIL",
"match_mode": "ANY",
"conditions": [
{ "field": "issue_type", "operator": "EQUALS", "values": ["Ops Task"] },
{ "field": "labels", "operator": "CONTAINS_ANY", "values": ["toil", "manual-ops", "access-request"] }
]
}
],
"workflow_states": [
{
"target_state": "IN_PROGRESS",
"is_active_time": true,
"raw_status_values": ["In Dev", "Doing", "In Progress"]
},
{
"target_state": "WAITING_REVIEW",
"is_active_time": false,
"raw_status_values": ["In Review", "Waiting QA", "PR Opened"]
},
{
"target_state": "DONE",
"is_active_time": false,
"raw_status_values": ["Closed", "Merged", "Done"]
}
]
}
}

---

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

### 4.4. Alertas In-App

Sistema de alertas operacionais dentro do produto (não confundir com `src/notifications/`, que é e-mail transacional outbound). Tabela tenant-scoped `alerts`, RLS no mesmo padrão da Seção 4.3, colunas principais:

- `type` (`CHECK`, 12 valores fechados): `sync_stale`, `sync_run_finished`, `integration_reconnect_required`, `billing_past_due`, `billing_subscription_expired`, `billing_subscription_confirmed`, `billing_subscription_cancelled`, `onboarding_incomplete`, `team_without_contributors`, `users_limit_reached`, `teams_limit_reached`, `integrations_limit_reached`.
- `severity` (`CHECK`): `info` | `warning` | `critical`.
- `integration_id` — só preenchido em alertas de sync/reconexão; `ON DELETE CASCADE` de `provider_integrations`.
- `team_id` (`0048_add_onboarding_alerts.sql`) — só preenchido em `team_without_contributors`; `ON DELETE CASCADE` de `teams`. Junto com `integration_id`, forma a chave de dedup/resolução de "alerta aberto" (`(tenant_id, type, integration_id, team_id)`, índice parcial `WHERE resolved_at IS NULL`) — os dois `NULL` identifica o único alerta de nível de tenant (`onboarding_incomplete`).
- `read_at` — estado lido/não-lido é por **tenant**, não por usuário.
- `resolved_at` — `NULL` = alerta aberto; preenchido quando a causa desaparece sozinha. Nunca é apagado (histórico).

Gatilhos (todos disparam via chamada direta de função, sem fila/pub-sub — mesmo estilo do resto do código):

1. **`sync_stale`** — scan periódico (`POST /internal/alerts/scan-stale`, cron a cada ~4h) comparando `provider_integrations.last_synced_at` contra o dia corrente (UTC).
2. **`sync_run_finished`** — todo run de `SyncOrchestrator.runSyncForIntegration` (sucesso ou falha), manual ou em lote.
3. **`integration_reconnect_required`** — `provider_integrations.consecutive_failures` (contador dedicado, já que `status` sozinho volta a `ACTIVE` no próximo sucesso) atinge um limiar fixo em código.
4. **`billing_past_due`** / **`billing_subscription_expired`** — webhooks Stripe `invoice.payment_failed` e `customer.subscription.deleted`, só na transição real (não em retry do webhook).
5. **`onboarding_incomplete`** — mesmo scan de `sync_stale`: tenant sem nenhum time (`teams`) e sem ninguém materializado além do ADMIN bootstrap (`users` count ≤ 1). Nível de tenant, `integration_id`/`team_id` sempre `NULL`.
6. **`team_without_contributors`** — mesmo scan, por time: nenhuma linha em `team_memberships` para aquele `team_id`.
7. **`users_limit_reached`** / **`teams_limit_reached`** / **`integrations_limit_reached`** (`0049_add_resource_limits_to_plans.sql`, `0050_add_limit_alert_types.sql`) — a contagem atual do tenant (`countByTenant`) atinge `plans.max_users`/`max_teams`/`max_integrations` (`NULL` = ilimitado, resolvido via `BillingService.getResourceLimit`). Diferente dos demais, esses três **também bloqueiam com `403`** na hora, em `POST /tenants/:tenantId/users`, `.../teams` e `.../integrations` — o alerta é criado no mesmo momento do bloqueio; o scan periódico só cobre a *resolução* (e a criação proativa de um tenant já acima do limite sem tentativa recente, ex: downgrade).
8. **`billing_subscription_confirmed`** (`0052_add_billing_lifecycle_alert_types.sql`) — todo `checkout.session.completed` (upgrade self-service ou link enterprise, mesmo evento Stripe pros dois — ver Seção sobre `enterprise_checkout_links` abaixo), só na confirmação inicial, não em renovação mensal rotineira.
9. **`billing_subscription_cancelled`** — `BillingService.cancelSubscription` (cancelamento pelo próprio ADMIN via app) ou `customer.subscription.updated` com `cancel_at_period_end` virando `true` sem o app ter iniciado (cancelamento "de surpresa" via Portal do Stripe) — o guard `!current.cancelledAt` já existente nesse handler evita duplicar quando o app já processou o cancelamento primeiro.

### 4.4.1. Links de checkout enterprise (`enterprise_checkout_links`)

Rastreamento de conversão dos links de checkout gerados pelo gestor do SaaS (`POST {prefix}/tenants/:tenantId/enterprise-checkout-links`) pra planos enterprise/privados — mesmo mecanismo de Stripe Checkout Session do upgrade self-service (`BillingService.createCheckoutSession`), sem fluxo nenhum fora do Stripe. Tabela tenant-scoped, RLS no mesmo padrão da Seção 4.3. `status` (`CHECK`): `pending` | `paid` | `expired`, atualizado pelos webhooks `checkout.session.completed`/`checkout.session.expired` via `stripe_checkout_session_id` (chave única). TTL da sessão é o default do Stripe (24h, não configurável via API além disso).

Referência completa da API (endpoints, exemplos, limitações): `docs/alerts-api.md`.

---

## 5. Schemas da Camada Canônica e Enriquecida

Todas as tabelas desta seção são tenant-scoped (Seção 1, Princípio 5 / Seção 4.3): carregam `tenant_id` e têm RLS habilitada e forçada.

CREATE TABLE canonical_work_items (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
provider VARCHAR(50) NOT NULL, -- 'jira', 'linear'
external_id VARCHAR(255) NOT NULL, -- 'JIRA-123'
raw_issue_type VARCHAR(100) NOT NULL, -- 'Story', 'Defect'
raw_status VARCHAR(100) NOT NULL, -- 'In Dev'
raw_labels TEXT[], -- ['tech-debt', 'checkout']
title TEXT NOT NULL,
assignee_external_id VARCHAR(255),
created_at TIMESTAMP WITH TIME ZONE NOT NULL,
updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- external_id só é único dentro do namespace do provider de um tenant (instâncias
    -- self-hosted como Jira Server podem coincidir em IDs entre tenants diferentes).
    CONSTRAINT unique_tenant_provider_item UNIQUE (tenant_id, provider, external_id)

);

CREATE TABLE canonical_chat_stats (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
provider VARCHAR(50) NOT NULL, -- 'slack', 'teams'
user_external_id VARCHAR(255) NOT NULL,
channel_external_id VARCHAR(255),
date DATE NOT NULL,

    messages_sent_count INT DEFAULT 0,
    off_hours_messages_count INT DEFAULT 0,
    mentions_received_count INT DEFAULT 0,
    support_threads_answered_count INT DEFAULT 0,

    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_tenant_user_chat_day UNIQUE (tenant_id, provider, user_external_id, channel_external_id, date)

);

CREATE TABLE canonical_pull_requests (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
provider VARCHAR(50) NOT NULL, -- 'github', 'gitlab'
external_id VARCHAR(255) NOT NULL, -- número do PR no provider
repository VARCHAR(255) NOT NULL, -- 'owner/repo'
title TEXT NOT NULL,
state VARCHAR(20) NOT NULL, -- 'OPEN', 'MERGED', 'CLOSED'

    author_external_id VARCHAR(255),
    reviewer_external_ids TEXT[] NOT NULL DEFAULT '{}',
    source_branch VARCHAR(255) NOT NULL,
    target_branch VARCHAR(255) NOT NULL,

    lines_added INT NOT NULL DEFAULT 0,
    lines_deleted INT NOT NULL DEFAULT 0,
    comments_count INT NOT NULL DEFAULT 0,

    first_commit_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL,
    merged_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,

    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- repository entra na constraint porque external_id (número do PR) só é
    -- único dentro de um repositório, não globalmente no provider.
    CONSTRAINT unique_tenant_provider_repository_pull_request UNIQUE (tenant_id, provider, repository, external_id)

);
-- Implementado em db/migrations/0001_create_canonical_pull_requests.sql,
-- 0002_add_tenant_scoping_to_canonical_pull_requests.sql e
-- 0005_enable_row_level_security_on_canonical_pull_requests.sql (RLS + FK para tenants).

CREATE TABLE canonical_incidents (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
tenant_id UUID NOT NULL REFERENCES tenants(id),
provider VARCHAR(50) NOT NULL, -- 'waroom', 'pagerduty'
external_id VARCHAR(255) NOT NULL, -- identificador amigável no provider, ex: 'INC-2026-0042'
title TEXT NOT NULL,
severity VARCHAR(20) NOT NULL, -- 'SEV1'..'SEV4', 'UNKNOWN'
status VARCHAR(20) NOT NULL, -- 'TRIGGERED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'CANCELED'

    service_name VARCHAR(255),
    assignee_external_id VARCHAR(255),

    triggered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,

    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_incident UNIQUE (tenant_id, provider, external_id)

);
-- Implementado em db/migrations/0015_create_canonical_incidents.sql (RLS + FK para tenants desde a criação).

CREATE TABLE enriched_work_items (
id UUID PRIMARY KEY REFERENCES canonical_work_items(id) ON DELETE CASCADE,
tenant_id UUID NOT NULL REFERENCES tenants(id), -- denormalizado a partir de team_id só para permitir a policy de RLS sem JOIN
team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

    semantic_category VARCHAR(50) NOT NULL, -- 'BUG', 'FEATURE', 'TECHNICAL_DEBT', 'TOIL', 'RISK'
    semantic_state VARCHAR(50) NOT NULL,    -- 'BACKLOG', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE'
    is_active_work BOOLEAN NOT NULL,

    started_working_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    applied_rule_version TIMESTAMP WITH TIME ZONE NOT NULL

);

---

## 6. Motor de Métricas Flexíveis & Gatilhos por Time

Nenhuma métrica possui gatilhos travados. Toda métrica obedece à equação de evento configurável pelo usuário por time:

Valor da Métrica = f(Evento Inicial, Evento Final, Filtro de Categoria, Agrupamento)

### 6.1. Exemplos de Gatilhos Mapeáveis

- Deployment Frequency: Pode ser acionada por Pipeline de CI/CD (GitHub Actions) em um time, ou por transição para a coluna Done do Jira em outro time.
- Lead Time for Changes: Início configurável (1º commit ou abertura de card) e Fim configurável (Deploy CI/CD ou Merge de PR).
- Toil Ratio: Calculado combinando horas em cards marcados como Toil divididas pela Capacidade Total do Time em Horas (default_monthly_capacity_hours).
- Retrabalho (Code Churn / Rework): Medido por % de código reescrito pós-merge ou por devolução de cards de QA para In Dev.

---

## 7. Contratos de Interface (TypeScript BaseProvider Specification)

// src/integrations/core/base.provider.ts
import { SyncContext, SyncResult, ProviderCredentials } from './canonical.types';

export abstract class BaseProvider {
abstract readonly providerName: string;
abstract readonly category: 'issue_tracker' | 'vcs' | 'cicd' | 'incident' | 'communication';

abstract testConnection(credentials: ProviderCredentials): Promise<{ success: boolean; message?: string }>;
abstract syncIncremental(context: SyncContext): Promise<SyncResult>;
}

---

## 8. Estrutura do Módulo no Código (TypeScript/Node.js)

src/
└── integrations/ # Módulo isolado de ingestão
├── core/ # Interfaces, base provider, orquestração
│ ├── base.provider.ts
│ ├── canonical.types.ts
│ └── sync.orchestrator.ts
│
├── providers/ # Submódulo por ferramenta
│ ├── github/
│ ├── jira/
│ ├── linear/
│ ├── incident-io/
│ └── slack/
│
└── jobs/ # Agendadores (Cron / Queue workers)
└── fetch-daily-metrics.job.ts
