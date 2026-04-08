# Entidades do Sistema (Domain Model)

## Visão Geral

O domain model reflete o negócio — não a estrutura das ferramentas externas. Dados do JIRA e GitHub são transformados para essas entidades através do módulo de integrações.

---

## Diagrama de Relacionamento

```
Org / Tenant
 └── Team ──────────────── User (many-to-many)
      └── Project
           ├── Epic
           │    └── Task ──── User (assignee)
           │         ├── HealthMetric
           │         └── COGSEntry
           ├── SLA Template
           └── HealthMetric (nível projeto)
```

---

## Entidades

### User

Representa uma pessoa unificada entre JIRA e GitHub.

| Campo              | Tipo        | Descrição                                        |
|--------------------|-------------|--------------------------------------------------|
| `id`               | UUID        | Identificador interno                            |
| `email`            | string      | Email único (chave de unificação cross-system)   |
| `name`             | string      | Nome de exibição                                 |
| `avatar_url`       | string      | URL do avatar                                    |
| `jira_user_id`     | string?     | ID no JIRA                                       |
| `github_handle`    | string?     | Username no GitHub                               |
| `role`             | enum        | `ic` \| `lead` \| `manager` \| `contractor`      |
| `skills`           | string[]    | Tags de habilidade (frontend, backend, devops)   |
| `cost_per_hour`    | decimal?    | Custo/hora (para cálculo de COGS)                |
| `start_date`       | date        | Início na empresa                                |
| `is_active`        | boolean     | Se está ativo                                    |
| `team_ids`         | UUID[]      | Times que pertence                               |

**Regras:**
- Unificação JIRA ↔ GitHub feita por `email` — campos de identity externos são opcionais
- `cost_per_hour` é confidencial; acesso restrito por role

---

### Team

Agrupador de pessoas. Pode refletir o agrupamento da integração (JIRA project team, GitHub org) ou ser definido manualmente.

| Campo              | Tipo        | Descrição                             |
|--------------------|-------------|---------------------------------------|
| `id`               | UUID        |                                       |
| `name`             | string      |                                       |
| `description`      | string?     |                                       |
| `lead_id`          | UUID        | FK → User                             |
| `member_ids`       | UUID[]      | FKs → User                            |
| `project_ids`      | UUID[]      | Projetos sob responsabilidade do time |
| `budget_quarterly` | decimal?    | Budget trimestral (para alertas COGS) |
| `tags`             | string[]    | backend, platform, mobile, etc.       |

---

### Project

Unidade principal de organização. Mapeia para um JIRA Project e/ou repositório(s) GitHub.

| Campo              | Tipo        | Descrição                                      |
|--------------------|-------------|------------------------------------------------|
| `id`               | UUID        |                                                |
| `key`              | string      | Chave curta (ex: `AUTH`, `PLAT`) — unique      |
| `name`             | string      |                                                |
| `team_id`          | UUID?       | Time responsável                               |
| `repository_ids`   | UUID[]      | Repositórios GitHub associados                 |
| `sla_template_id`  | UUID?       | SLA padrão do projeto                          |
| `status`           | enum        | `planning` \| `active` \| `on_hold` \| `done` |
| `start_date`       | date?       |                                                |
| `target_end_date`  | date?       |                                                |
| `sync_config`      | JSONB       | Frequência e opções de sync por connector      |
| `custom_fields`    | JSONB       | Campos adicionais (flexível)                   |
| `tags`             | string[]    |                                                |

---

### Epic

Agrupador temático de tasks. Representa uma iniciativa ou feature maior.

| Campo                | Tipo        | Descrição                                        |
|----------------------|-------------|--------------------------------------------------|
| `id`                 | UUID        |                                                  |
| `project_id`         | UUID        | FK → Project                                     |
| `source`             | enum        | `jira` \| `github` \| `manual`                   |
| `source_id`          | string?     | ID no sistema de origem                          |
| `name`               | string      |                                                  |
| `description`        | string?     |                                                  |
| `goal`               | string?     | Objetivo / alinhamento com OKR                   |
| `status`             | enum        | `backlog` \| `active` \| `completed` \| `cancelled` |
| `start_date`         | date?       |                                                  |
| `target_end_date`    | date?       |                                                  |
| `actual_end_date`    | date?       |                                                  |
| `owner_id`           | UUID?       | FK → User                                        |
| `total_tasks`        | int         | Calculado                                        |
| `completed_tasks`    | int         | Calculado                                        |
| `total_story_points` | int         | Calculado                                        |
| `actual_hours`       | decimal     | Calculado (soma das tasks)                       |
| `actual_cost`        | decimal     | Calculado (soma dos COGS entries)                |
| `health_score`       | decimal?    | 0–100, calculado pelo Analytics Engine           |

---

### Task

Unidade de trabalho. Mapeia para uma JIRA Issue ou GitHub Issue/PR.

| Campo              | Tipo        | Descrição                                                  |
|--------------------|-------------|------------------------------------------------------------|
| `id`               | UUID        |                                                            |
| `source`           | enum        | `jira` \| `github`                                         |
| `source_id`        | string      | Ex: `PROJ-123` ou `#456`                                   |
| `project_id`       | UUID        | FK → Project                                               |
| `epic_id`          | UUID?       | FK → Epic                                                  |
| `title`            | string      |                                                            |
| `description`      | string?     |                                                            |
| `task_type`        | enum        | `feature` \| `bug` \| `chore` \| `spike` \| `tech_debt`  |
| `priority`         | enum        | `P0` \| `P1` \| `P2` \| `P3` \| `P4`                     |
| `status`           | enum        | `backlog` \| `todo` \| `in_progress` \| `review` \| `done` \| `cancelled` |
| `assignee_id`      | UUID?       | FK → User                                                  |
| `reporter_id`      | UUID?       | FK → User                                                  |
| `story_points`     | int?        | Planejado                                                  |
| `hours_estimated`  | decimal?    |                                                            |
| `hours_actual`     | decimal?    |                                                            |
| `created_at`       | timestamp   |                                                            |
| `started_at`       | timestamp?  | Quando mudou para `in_progress`                            |
| `completed_at`     | timestamp?  |                                                            |
| `due_date`         | date?       |                                                            |
| `sla_id`           | UUID?       | FK → SLA em vigor                                          |
| `sla_status`       | enum        | `ok` \| `at_risk` \| `breached` \| `n/a`                  |
| `cycle_time_hours` | decimal?    | `completed_at - started_at`                                |
| `related_pr_ids`   | string[]    | Hashes/números de PRs correlacionados (GitHub)             |
| `tags`             | string[]    |                                                            |
| `custom_fields`    | JSONB       |                                                            |

---

### SLA

Ver detalhes em [slas.md](slas.md).

---

### HealthMetric

Snapshot de uma métrica em um ponto no tempo. Registros acumulados para séries temporais.

| Campo              | Tipo        | Descrição                                                  |
|--------------------|-------------|------------------------------------------------------------|
| `id`               | UUID        |                                                            |
| `metric_type`      | enum        | `dora` \| `sla` \| `code_quality` \| `team_velocity` \| `custom` |
| `metric_name`      | string      | Ex: `deployment_frequency`, `lead_time_p50`                |
| `scope_type`       | enum        | `project` \| `team` \| `org`                              |
| `scope_id`         | UUID        | FK para o escopo correspondente                            |
| `time_window`      | enum        | `1d` \| `7d` \| `30d` \| `90d`                            |
| `value`            | decimal     | Valor calculado                                            |
| `baseline`         | decimal?    | Valor esperado/meta                                        |
| `status`           | enum        | `healthy` \| `warning` \| `critical`                      |
| `recorded_at`      | timestamp   |                                                            |
| `dimensions`       | JSONB       | Dimensões extras (ex: `{"branch": "main"}`)                |

---

### COGSEntry

Ver detalhes em [cogs.md](cogs.md).

---

### Repository

Representa um repositório GitHub associado a um ou mais projetos.

| Campo              | Tipo        | Descrição                                |
|--------------------|-------------|------------------------------------------|
| `id`               | UUID        |                                          |
| `github_id`        | string      | ID único no GitHub                       |
| `full_name`        | string      | Ex: `org/repo-name`                      |
| `project_ids`      | UUID[]      | Projetos associados (pode ser múltiplos) |
| `default_branch`   | string      | Ex: `main`                               |
| `language`         | string?     | Linguagem principal                      |
| `is_archived`      | boolean     |                                          |
| `last_synced_at`   | timestamp   |                                          |

---

## Convenções

### Status de Task — Workflow
```
backlog → todo → in_progress → review → done
                     ↘ (blocked)    ↗
```
- `cancelled` pode ser atingido de qualquer estado
- `started_at` é definido na transição para `in_progress`
- `cycle_time_hours` é calculado apenas quando `done`

### Prioridade
| Prioridade | Descrição              | SLA padrão |
|-----------|------------------------|------------|
| P0        | Crítico / emergência   | 2 horas    |
| P1        | Alto impacto           | 8 horas    |
| P2        | Médio impacto          | 24 horas   |
| P3        | Baixo impacto          | 72 horas   |
| P4        | Nice to have / backlog | 1 semana   |

### Campos `source` e `source_id`
Toda entidade originada de uma integração mantém referência ao sistema de origem para rastreabilidade e resync.

### `custom_fields` (JSONB)
Campos que variam por organização/projeto (ex: campos customizados do JIRA) são armazenados em JSONB sem schema fixo. Isso evita migrações de schema para customizações pontuais.
