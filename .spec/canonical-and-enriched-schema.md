# Schemas da Camada Canônica e Enriquecida

Parte de [spec-engineering-intelligence.md](./spec-engineering-intelligence.md) (índice) — Seções 1 e 2 (Visão Geral, Ecossistema de Origens) ficam lá; o resto foi quebrado por tópico neste diretório.

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
-- `db/migrations/0054_add_parent_to_canonical_work_items.sql` acrescenta
-- `parent_external_id`/`parent_external_name VARCHAR(255)` (nullable) —
-- referência de 1 salto ao pai/container (épico), traduzida por cada
-- conector (Jira: `parent.key` team-managed, ou o custom field de Epic
-- Link em projetos company-managed clássicos, descoberto via
-- `GET /rest/api/3/field` e cacheado em `provider_integrations.epic_link_field_id`;
-- Linear: `project.id`/`.name`; Azure Boards: id do work item pai via
-- `System.LinkTypes.Hierarchy-Reverse`). Ver `CanonicalWorkItem.parentExternalId`
-- e Seção 3 (`epicGrouping`).
--
-- `SyncOrchestrator.reconcileDanglingParents` (`sync.orchestrator.ts`) roda
-- depois de toda sync bem-sucedida de um provider com `BaseProvider.fetchByExternalIds`
-- (Jira, Azure Boards): busca work items cujo `parent_external_id` aponta
-- pra um `external_id` nunca sincronizado (comum quando o pai é antigo
-- demais pro backfill e raramente editado) diretamente pelo id/key,
-- limitado a `MAX_DANGLING_PARENTS_PER_SYNC` por execução — autocura ao
-- longo de várias syncs, não instantâneo numa execução só.

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
-- `db/migrations/0055_add_epic_grouping_to_enriched_work_items.sql`
-- acrescenta `epic_external_id`/`epic_external_name VARCHAR(255)`
-- (nullable, resolvidos por `src/enrichment/epic-resolver.ts`) e
-- `is_epic_container BOOLEAN NOT NULL DEFAULT false` (item é ele mesmo um
-- épico/container — fica de fora de qualquer quebra por épico, não conta a
-- si mesmo). `epic_external_id/name` nulos = sem épico resolvido, não é
-- erro (mesmo espírito de `team_id` nullable em `enriched_incidents`).

