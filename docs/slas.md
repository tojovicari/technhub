# SLAs, Compliance e Alertas

## Visão Geral

O módulo de SLA define expectativas de tempo de resolução por tipo e prioridade de tarefa, monitora compliance em tempo real, e aciona alertas quando o prazo está em risco ou foi violado.

---

## Conceitos

| Conceito            | Descrição                                                                 |
|---------------------|---------------------------------------------------------------------------|
| **SLA Template**    | Conjunto de regras que define os prazos por tipo/prioridade de tarefa     |
| **SLA Instance**    | Aplicação de um template a uma task específica (com clock iniciado)       |
| **SLA Clock**       | Tempo decorrido desde o `started_at` da task                              |
| **Compliance**      | % de tasks que cumpriram o SLA no período                                 |
| **Breach**          | Task que ultrapassou o prazo sem ser concluída                            |

---

## SLAs Personalizados contra Dados Ingeridos

SLA Templates são criados pelo tenant e avaliados automaticamente sobre dados ingeridos pelo módulo de integrações. O SLA Engine consome eventos de sincronização e aplica os templates cujas condições forem satisfeitas.

### Modelo de Condições (`condition`)

Cada template expõe um campo `condition` (JSONB) que é avaliado contra os atributos da task sincronizada. Suporta combinação de campos nativos e metadados do provider (labels, components, story points, sprints, etc.).

A estrutura é **recursiva**: cada `condition` tem um `operator` (`AND` | `OR`) e uma lista de `rules`, onde cada regra pode ser uma comparação simples ou outro grupo aninhado.

```json
{
  "operator": "AND",
  "rules": [
    { "field": "task_type",   "op": "in",       "value": ["bug"] },
    { "field": "priority",    "op": "in",       "value": ["P0", "P1"] },
    { "field": "labels",      "op": "contains", "value": "production" },
    { "field": "source",      "op": "eq",       "value": "jira" }
  ]
}
```

Exemplo com grupo aninhado:

```json
{
  "operator": "AND",
  "rules": [
    { "field": "priority", "op": "in", "value": ["P0", "P1"] },
    {
      "operator": "OR",
      "rules": [
        { "field": "original_type", "op": "in",       "value": ["Incident", "Major Incident"] },
        { "field": "labels",        "op": "contains", "value": "production" }
      ]
    }
  ]
}
```

Exemplos de condições suportadas:

| `field`           | Exemplos de `op`           | Exemplos de `value`                      |
|-------------------|----------------------------|------------------------------------------|
| `task_type`       | `in`, `eq`                 | `["bug", "tech_debt"]`                   |
| `priority`        | `in`, `gte`                | `["P0", "P1"]`                           |
| `labels`          | `contains`, `any`          | `"production"`, `["hotfix","sev1"]`      |
| `component`       | `eq`, `in`                 | `"checkout"`, `["payments","billing"]`   |
| `source`          | `eq`                       | `"jira"`, `"github"`                     |
| `project_id`      | `in`                       | `["proj_abc"]`                           |
| `original_type`   | `eq`, `in`                 | `"Incident"`, `["Security Finding","Bug"]`|
| `story_points`    | `gte`, `lte`               | `5`                                      |
| `sprint_name`     | `contains`                 | `"alpha"`                                |

O campo `condition` é avaliado na ordem de prioridade do template (`priority` no schema abaixo). O primeiro template cujas condições são satisfeitas é aplicado à task (sem sobreposição).

---

### Fluxo Event-Driven de SLA

```
[Integrations Module]
  integration.task.synced.v1
  integration.task.updated.v1
         │
         ▼
[SLA Engine — consumidor de eventos]
         │
         ├──▶ Carrega templates ativos do tenant (ordered by priority)
         │
         ├──▶ Avalia condition de cada template contra payload do evento
         │
         ├── Nenhum match → nenhuma instância criada / existente encerrada
         │
         └── Match encontrado:
               ├── Task não tem instância ativa →
               │     cria SLA Instance (started_at = task.started_at ou now)
               │
               ├── Task tem instância ativa com template diferente →
               │     encerra instância anterior (status = superseded)
               │     cria nova instância
               │
               └── Task concluída/cancelada →
                     encerra instância (status = met | breached)
```

#### Contrato do evento consumido

```json
{
  "event_type": "integration.task.synced.v1",
  "tenant_id":  "ten_1",
  "payload": {
    "task_id":       "tsk_42",
    "source":        "jira",
    "task_type":     "bug",
    "priority":      "P1",
    "status":        "in_progress",
    "labels":        ["production", "backend"],
    "component":     "checkout",
    "project_id":    "proj_abc",
    "started_at":    "2026-04-08T10:00:00Z",
    "original_type": "Incident",
    "title":         "Login failure on checkout",
    "assignee_id":   "usr_99"
  }
}
```

> **`title` e `assignee_id`** são os campos adicionais que o módulo SLA declara precisar
> para seu read-model local (`SlaTaskSnapshot`). Eles são opcionais no contrato — se ausentes,
> o snapshot fica sem título/assignee, mas a avaliação de SLA funciona normalmente.

---

## Tipos do Provider e Normalização de Tipos

Cada provider (Jira, GitHub) tem seus próprios tipos de issue — `Incident`, `Security Finding`,
`Customer Request`, etc. — que não existem no enum canônico do CTO.ai (`bug`, `feature`, `chore`,
`spike`, `tech_debt`). O sistema resolve isso com dois mecanismos complementares:

### `original_type` — o tipo exato do provider

Todo task sincronizado guarda o tipo original do provider no campo `original_type` (ex: `"Incident"`,
`"Security Finding"`, `"Task"`). Esse campo está disponível no condition DSL do SLA template, permitindo
SLAs que referenciam tipos reais sem precisar de mapeamento.

```json
{
  "name": "SLA Incidents Críticos",
  "applies_to": [],
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "original_type", "op": "in", "value": ["Incident", "Major Incident"] },
      { "field": "priority",      "op": "in", "value": ["P0", "P1"] }
    ]
  }
}
```

> **`applies_to: []`** — array vazio desativa o pré-filtro por tipo canônico. O template avalia
> qualquer task que passe pela `condition`. Use quando o critério de seleção está todo na condition
> (ex: `original_type`).

### `typeMapping` — de-para configurável por connection

Além do `original_type`, o tenant pode configurar um mapeamento explícito de tipos do provider
para os tipos canônicos. Isso garante que DORA e COGS agrupem corretamente — ex: `"Incident"` deve
entrar no cálculo de MTTR como `bug`.

#### Descobrir os tipos que existem na connection

```
GET /api/v1/integrations/connections/:id/original-types
```

Retorna os `original_type` distintos já ingeridos para aquela connection:

```json
{
  "data": {
    "connection_id": "conn-jira-abc",
    "provider": "jira",
    "original_types": [
      "Bug",
      "Incident",
      "Security Finding",
      "Task",
      "Epic",
      "Customer Request"
    ]
  }
}
```

> **Para o frontend:** use `GET /api/v1/integrations/original-types` (tenant-scoped) para popular
> o dropdown de valores quando o usuário adiciona uma regra `{ "field": "original_type", ... }`
> no condition builder do template. Esse endpoint retorna a union de todas as connections do tenant,
> que é o escopo correto — o template é avaliado contra tasks de qualquer connection.

#### Ler o mapeamento atual

```
GET /api/v1/integrations/connections/:id/type-mapping
```

```json
{
  "data": {
    "connection_id": "conn-jira-abc",
    "mapping": {
      "Incident":          "bug",
      "Security Finding":  "bug",
      "Customer Request":  "feature",
      "Task":              "chore"
    }
  }
}
```

#### Configurar o mapeamento

```
PATCH /api/v1/integrations/connections/:id/type-mapping
```

```json
{
  "mapping": {
    "Incident":          "bug",
    "Security Finding":  "bug",
    "Customer Request":  "feature",
    "Task":              "chore"
  }
}
```

O valor deve ser um dos tipos canônicos: `bug` | `feature` | `chore` | `spike` | `tech_debt`.
Tipos não mapeados ficam sem `task_type` canônico — não há fallback silencioso.

### Fluxo de resolução do tipo durante a sync

```
Provider emite tipo raw:  "Incident"
        │
        ├── typeMapping["Incident"] = "bug"  →  taskType = "bug"
        │   (configurado pelo tenant via PATCH /type-mapping)
        │
        ├── heurística interna match ("defect" → bug, "task" → chore, etc.)
        │   (apenas para tipos conhecidos — sem fallback para tipos desconhecidos)
        │
        └── sem match  →  taskType = null  (warnings no log)

originalType = "Incident"  ←  sempre gravado, independente do mapeamento
```

### Como o frontend monta a tela de configuração de tipos

```
┌──────────────────────────────────────────────────────────────────┐
│  Configurar connection Jira                                      │
│                                                                  │
│  1. GET /connections/:id/original-types                          │
│     → ["Bug", "Incident", "Security Finding", "Task", ...]      │
│                                                                  │
│  2. Renderizar tabela de mapeamento:                             │
│     ┌────────────────────┬───────────────────┐                  │
│     │ Tipo no Jira       │ Tipo canônico      │                  │
│     ├────────────────────┼───────────────────┤                  │
│     │ Bug                │ [bug       ▼]      │                  │
│     │ Incident           │ [bug       ▼]      │                  │
│     │ Security Finding   │ [bug       ▼]      │                  │
│     │ Customer Request   │ [feature   ▼]      │                  │
│     │ Task               │ [chore     ▼]      │                  │
│     │ Epic               │ (não mapear)       │                  │
│     └────────────────────┴───────────────────┘                  │
│                                                                  │
│  3. PATCH /connections/:id/type-mapping                          │
└──────────────────────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────────────────────┐
│  Criar SLA Template — condition builder                          │
│                                                                  │
│  Campo:    [original_type ▼]                                     │
│  Operador: [in            ▼]                                     │
│  Valor:    [Incident      ▼]  ← dropdown do GET /original-types  │
│            [Major Incident▼]  ← multi-select                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Entidade: SLA Template

| Campo             | Tipo      | Descrição                                                          |
|-------------------|-----------|--------------------------------------------------------------------|
| `id`              | UUID      |                                                                    |
| `tenant_id`       | UUID      | FK → Tenant                                                        |
| `name`            | string    | Ex: "SLA Bugs de Produção P0/P1"                                   |
| `description`     | string?   |                                                                    |
| `condition`       | JSONB     | Condições avaliadas contra dados ingeridos (ver acima)             |
| `priority`        | int       | Ordem de avaliação entre templates do tenant (menor = primeiro)    |
| `applies_to`      | enum[]    | Pré-filtro por tipo canônico (`bug`, `feature`, `chore`, `spike`, `tech_debt`). **Array vazio** = sem filtro — avalia qualquer task pelas `condition` rules (necessário quando a condição usa `original_type`) |
| `rules`           | JSONB     | Mapa de prioridade → prazo em minutos (ver abaixo)                 |
| `escalation_rule` | JSONB?    | Quem notificar em cada gatilho                                     |
| `project_ids`     | UUID[]?   | Restringe a projetos específicos (null = global no tenant)         |
| `is_default`      | boolean   | Aplicado quando nenhuma outra condição for satisfeita              |
| `is_active`       | boolean   |                                                                    |
| `created_at`      | timestamp |                                                                    |

### Exemplo de `rules`
```json
{
  "P0": { "target_minutes": 120,  "warning_at_percent": 80 },
  "P1": { "target_minutes": 480,  "warning_at_percent": 80 },
  "P2": { "target_minutes": 1440, "warning_at_percent": 75 },
  "P3": { "target_minutes": 4320, "warning_at_percent": 70 },
  "P4": { "target_minutes": 10080,"warning_at_percent": 0  }
}
```

### Exemplo de `escalation_rule`
```json
{
  "at_risk":  { "notify": ["assignee", "team_lead"] },
  "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": false }
}
```

---

## Entidade: SLA Instance

Criada automaticamente quando uma task com SLA template ativo entra em `in_progress`.

| Campo              | Tipo      | Descrição                                               |
|--------------------|-----------|---------------------------------------------------------|
| `id`               | UUID      |                                                         |
| `task_id`          | UUID      | FK → Task                                               |
| `sla_template_id`  | UUID      | FK → SLA Template                                       |
| `target_minutes`   | int       | Prazo copiado do template no momento da criação         |
| `started_at`       | timestamp | Quando o clock iniciou (task → `in_progress`)           |
| `deadline_at`      | timestamp | `started_at + target_minutes`                           |
| `completed_at`     | timestamp?| Quando a task foi concluída                             |
| `status`           | enum      | `running` \| `met` \| `at_risk` \| `breached`          |
| `actual_minutes`   | int?      | Minutos reais até resolução                             |
| `breach_minutes`   | int?      | Quanto tempo além do prazo (se breached)                |
| `task_snapshot`    | object?   | Read-model local com metadados da task (ver abaixo)     |

### `task_snapshot` — read-model local do módulo SLA

O módulo SLA mantém uma cópia local dos campos de task que precisa para o dashboard,
atualizada a cada evento `core.task.updated.v1` recebido. Nunca acessa a tabela `Task` diretamente.

| Campo         | Tipo    | Descrição                              |
|---------------|---------|----------------------------------------|
| `title`       | string  | Título da task no provider             |
| `assignee_id` | UUID?   | ID do usuário responsável              |
| `priority`    | string  | Prioridade (P0–P4)                     |
| `project_id`  | UUID    | Projeto canônico no CTO.ai             |

---

## Fluxo de SLA

```
Task criada
    │
    ▼
Task → in_progress
    │
    └──→ [SLA Engine] cria SLA Instance
              │
              ├── Scheduler verifica periodicamente:
              │    ├── se (now - started_at) >= warning_at_percent × target → status = at_risk → ALERTA
              │    └── se (now - started_at) >= target → status = breached → ALERTA + ESCALAÇÃO
              │
              └── Task → done / cancelled
                   └──→ SLA Instance finalizada
                         ├── completed_at = agora
                         ├── actual_minutes calculado
                         └── status = met (se dentro do prazo) ou breached
```

---

## Dashboard de SLA

### APIs de Métricas Disponíveis

```
GET /api/v1/sla/summary                → visão consolidada do tenant
GET /api/v1/sla/summary/by-template    → breakdown por template SLA
GET /api/v1/sla/instances              → lista paginada de instâncias (com filtros)
```

Todos aceitam query params opcionais: `project_id` (UUID), `from` e `to` (ISO 8601).

#### `GET /api/v1/sla/summary`

Retorna métricas agregadas de todos os SLAs do tenant no período.

```json
{
  "data": {
    "period": { "from": null, "to": null },
    "total_instances": 12,
    "running": 4,
    "at_risk": 2,
    "breached": 3,
    "met": 3,
    "compliance_rate": 50.0,
    "breach_rate": 50.0,
    "at_risk_rate": 50.0,
    "mean_resolution_minutes": 184,
    "breach_severity_avg_minutes": 63
  }
}
```

- `compliance_rate` = `met / (met + breached) × 100` — `null` enquanto não há instâncias finalizadas
- `breach_rate` = `breached / (met + breached) × 100`
- `at_risk_rate` = `at_risk / running × 100`
- `mean_resolution_minutes` — média de `actual_minutes` das instâncias `met`
- `breach_severity_avg_minutes` — média de `breach_minutes` das instâncias `breached`

#### `GET /api/v1/sla/summary/by-template`

Retorna o mesmo conjunto de métricas agrupado por template, ordenado por `priority` crescente (mais específico primeiro). Ideal para o painel de acompanhamento por regra de SLA.

```json
{
  "data": [
    {
      "template": { "id": "c443da7a-...", "name": "N3", "priority": 10 },
      "running": 2,
      "at_risk": 0,
      "breached": 0,
      "met": 0,
      "total_instances": 2,
      "compliance_rate": null,
      "breach_rate": null,
      "mean_resolution_minutes": null,
      "breach_severity_avg_minutes": null
    }
  ]
}
```

### Visão Operacional (Tech Manager)
- **Compliance Rate** por projeto e por sprint: `% tasks met / total tasks com SLA`
- **Tasks at risk** no momento (filtráveis por projeto, time, responsável)
- **Tasks breached** nos últimos 7/30 dias
- **Tempo médio de resolução** por prioridade e tipo

### Visão Executiva (CTO)
- **SLA scorecard** por time/projeto ao longo do tempo
- **Tendência de compliance** (melhora ou piora WoW/MoM)
- **Top 5 breaches** por severidade no período
- **Custo de violações** (correlacionado ao COGS)

---

## Métricas de SLA

| Métrica                     | Fórmula                                               |
|-----------------------------|-------------------------------------------------------|
| Compliance Rate             | `tasks_met / total_com_sla × 100`                     |
| Breach Rate                 | `tasks_breached / total_com_sla × 100`                |
| Mean Time to Resolution     | `avg(actual_minutes)` por prioridade                  |
| SLA Breach Severity         | `avg(breach_minutes)` das tasks violadas              |
| At-Risk Rate                | `tasks_at_risk / tasks_running × 100`                 |

---

## Alertas

Os alertas são enviados via o sistema de notificações e roteados por canal configurado (Slack, email, Teams).

| Trigger         | Destinatários (default)               | Mensagem                                       |
|-----------------|---------------------------------------|------------------------------------------------|
| At-risk (80%)   | Assignee + Team Lead                  | "PROJ-123 está perto do prazo SLA (P1, 2h)"   |
| Breached        | Assignee + Lead + Manager             | "PROJ-123 violou SLA P1. +37 min acima do limite" |
| Breach em spike | Tech Lead + CTO                       | "Múltiplas violações de P0 nas últimas 24h"    |

### Configuração de Alertas
Cada regra de escalação pode ser sobrescrita por projeto via `SLA Template.escalation_rule`.

---

## SLA para Diferentes Contextos

| Contexto              | Tipo de Task      | Considerações Especiais                        |
|-----------------------|-------------------|------------------------------------------------|
| Bug em produção       | `bug` + P0/P1     | SLA curto; escalation automática               |
| Feature request       | `feature`         | SLA mais flexível; foco em ciclo total         |
| Tech debt             | `tech_debt`       | SLA opcional; monitorado por acumulação        |
| On-call / incidente   | `bug` + P0        | Integração com PagerDuty/Opsgenie (Fase 4)     |
| Demanda interna       | `chore`           | SLA administrativo (ex: 5 dias úteis)          |

---

## Pausa de SLA (SLA Pause)

Situações em que o clock deve ser pausado:

- Task movida para `blocked` (aguardando dependência externa)
- Fora do horário comercial (se configurado — ex: 9h–18h, dias úteis)
- Aguardando resposta do solicitante

A pausa é registrada como `SLAPause { started_at, ended_at, reason }` e descontada do `actual_minutes`.

---

## Relatórios Automáticos

| Relatório              | Frequência  | Formato   | Destinatários        |
|------------------------|-------------|-----------|----------------------|
| SLA Weekly Digest      | Semanal     | Slack/PDF | Tech Managers        |
| SLA Executive Summary  | Mensal      | PDF/Email | CTO, Director        |
| Breach Detail Report   | On-demand   | CSV/PDF   | Qualquer             |
| Compliance Trend       | Mensal      | Dashboard | Tech Manager, CTO    |

---

## Exemplos Práticos de Configuração

Esta seção ilustra cenários reais de uso do módulo SLA — do template à instância ativa —
com os payloads de API correspondentes. Escrita para referência do time de frontend ao
projetar dashboards, formulários de configuração e alertas.

---

### Cenário 1 — Bug Crítico de Produção (P0/P1)

**Objetivo:** garantir resolução rápida de bugs com label `production` ou prioridade máxima.
Aciona escalation automática para o manager se breach ocorrer.

#### 1. Criar o template — `POST /api/v1/sla/templates`

```json
{
  "name": "Bug Crítico de Produção",
  "description": "SLA para bugs P0/P1 com label production. Escalation automática.",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "task_type", "op": "eq",      "value": "bug" },
      { "field": "priority",  "op": "in",      "value": ["P0", "P1"] },
      { "field": "labels",    "op": "contains", "value": "production" }
    ]
  },
  "applies_to": ["bug"],
  "priority": 10,
  "rules": {
    "P0": { "target_minutes": 60,  "warning_at_percent": 70 },
    "P1": { "target_minutes": 240, "warning_at_percent": 80 }
  },
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  },
  "project_ids": [],
  "is_default": false,
  "is_active": true
}
```

#### 2. Task sincronizada que dispara o SLA — `POST /api/v1/sla/evaluate` (chamado internamente pelo worker)

```json
{
  "task_id":   "a3f1c2d4-0001-0000-0000-000000000001",
  "tenant_id": "ten_1",
  "task_type": "bug",
  "priority":  "P1",
  "status":    "in_progress",
  "labels":    ["production", "backend"],
  "component": "checkout",
  "project_id": "proj-payments-001",
  "source":    "jira",
  "started_at": "2026-04-10T09:00:00Z"
}
```

#### 3. Instância criada (visível em `GET /api/v1/sla/instances?task_id=<id>`)

```json
{
  "id": "inst-0001",
  "task_id": "a3f1c2d4-0001-0000-0000-000000000001",
  "sla_template_id": "<id do template acima>",
  "tenant_id": "ten_1",
  "target_minutes": 240,
  "started_at":  "2026-04-10T09:00:00Z",
  "deadline_at": "2026-04-10T13:00:00Z",
  "completed_at": null,
  "status": "running",
  "actual_minutes": null,
  "breach_minutes": null,
  "template": { "id": "...", "name": "Bug Crítico de Produção" },
  "task_snapshot": {
    "title": "Login failure on checkout",
    "assignee_id": "usr_99",
    "priority": "P1",
    "project_id": "proj-payments-001"
  }
}
```

#### 4. Progressão de status ao longo do tempo

| Horário (exemplo) | Evento | Status da instância |
|---|---|---|
| 09:00 | Task vai a `in_progress` | `running` |
| 12:12 | 80% do prazo atingido (192min) | `at_risk` — alerta para assignee + team lead |
| 13:00 | Deadline atingido sem conclusão | `breached` — escalation, incident criado |
| 13:47 | Task vai a `done` | `breached` + `actual_minutes: 287`, `breach_minutes: 47` |

#### Relação com outras entidades

- **Task** (`core` module): `task.slaStatus` é atualizado para `ok → at_risk → breached`
- **COGS**: o custo de breach pode ser correlacionado via `GET /api/v1/cogs/entries?task_id=<id>` para calcular custo da violação
- **DORA**: breaches de P0 impactam a métrica de MTTR (Mean Time to Restore) do projeto

---

### Cenário 2 — Feature Request com SLA de Sprint

**Objetivo:** monitorar features que devem ser entregues dentro do ciclo de sprint (2 semanas).
Sem escalation — apenas visibilidade operacional para o tech manager.

#### 1. Criar o template — `POST /api/v1/sla/templates`

```json
{
  "name": "Feature — SLA de Sprint (2 semanas)",
  "description": "Features devem ser concluídas dentro de um sprint. SLA de 14 dias úteis.",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "task_type", "op": "eq", "value": "feature" },
      { "field": "priority",  "op": "in", "value": ["P2", "P3"] }
    ]
  },
  "applies_to": ["feature"],
  "priority": 50,
  "rules": {
    "P2": { "target_minutes": 14400, "warning_at_percent": 75 },
    "P3": { "target_minutes": 20160, "warning_at_percent": 70 }
  },
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee"],             "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead"], "create_incident": false }
  },
  "project_ids": [],
  "is_default": false,
  "is_active": true
}
```

> `14400 min` = 10 dias úteis (2 semanas). `20160 min` = 14 dias corridos.

#### 2. Task que dispara o SLA

```json
{
  "task_id":    "feat-0042",
  "tenant_id":  "ten_1",
  "task_type":  "feature",
  "priority":   "P2",
  "status":     "in_progress",
  "labels":     ["q2-backlog"],
  "project_id": "proj-core-api",
  "source":     "jira",
  "started_at": "2026-04-01T08:00:00Z"
}
```

#### 3. O que o frontend consome para o dashboard de sprint

```
GET /api/v1/sla/instances?status=at_risk         → features próximas do deadline
GET /api/v1/sla/instances?status=running          → todas as features em andamento com SLA
GET /api/v1/sla/instances?task_id=feat-0042       → detalhe da task específica
```

#### Relação com outras entidades

- **Core/Epic**: a feature provavelmente está vinculada a um epic — o frontend pode cruzar `task.epicId` com `GET /api/v1/cogs/epics/:epic_id` para ver o impacto no custo do epic
- **Core/Project**: `GET /api/v1/core/projects/:id` traz o contexto do projeto para o painel de sprint

---

### Cenário 3 — Tech Debt com Acumulação Monitorada

**Objetivo:** tech debts acumulados com label `critical` ou prioridade P2 devem ser tratados
em até 30 dias. O time é avisado, mas sem urgência de incident.

#### 1. Criar o template — `POST /api/v1/sla/templates`

```json
{
  "name": "Tech Debt Crítico — 30 dias",
  "description": "Tech debts marcados como críticos devem ser resolvidos em até 30 dias.",
  "condition": {
    "operator": "OR",
    "rules": [
      { "field": "labels",   "op": "any", "value": ["critical", "security-risk"] },
      { "field": "priority", "op": "in",  "value": ["P1", "P2"] }
    ]
  },
  "applies_to": ["tech_debt"],
  "priority": 30,
  "rules": {
    "P1": { "target_minutes": 20160, "warning_at_percent": 70 },
    "P2": { "target_minutes": 43200, "warning_at_percent": 70 },
    "P3": { "target_minutes": 43200, "warning_at_percent": 60 }
  },
  "escalation_rule": {
    "at_risk":  { "notify": ["team_lead"],             "create_incident": false },
    "breached": { "notify": ["team_lead", "manager"],  "create_incident": false }
  },
  "project_ids": [],
  "is_default": false,
  "is_active": true
}
```

> `43200 min` = 30 dias corridos.  
> Condição com `OR`: tech debt que tenha `labels = critical` OU `labels = security-risk` OU `priority P1/P2` — qualquer um dos critérios é suficiente.

#### 2. Queries úteis para dashboard de dívida técnica

```
GET /api/v1/sla/instances?status=breached          → tech debts vencidos (visão CTO)
GET /api/v1/sla/instances?status=at_risk            → debts próximos do vencimento
GET /api/v1/sla/instances?status=running            → inventory de todos os debts rastreados
```

---

### Cenário 4 — SLA por Componente Crítico (Payments / Checkout)

**Objetivo:** qualquer task (qualquer tipo) no componente `payments` ou `checkout` tem prazo
menor que o padrão do tenant. Escopo restrito a dois projetos específicos.

#### 1. Criar o template — `POST /api/v1/sla/templates`

```json
{
  "name": "Componentes Críticos — Payments & Checkout",
  "description": "Qualquer task em payments ou checkout tem SLA reduzido.",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "component", "op": "in", "value": ["payments", "checkout"] }
    ]
  },
  "applies_to": ["bug", "feature", "chore", "tech_debt"],
  "priority": 20,
  "rules": {
    "P0": { "target_minutes": 60,   "warning_at_percent": 75 },
    "P1": { "target_minutes": 180,  "warning_at_percent": 80 },
    "P2": { "target_minutes": 1440, "warning_at_percent": 75 },
    "P3": { "target_minutes": 4320, "warning_at_percent": 70 }
  },
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  },
  "project_ids": [
    "proj-payments-001",
    "proj-checkout-002"
  ],
  "is_default": false,
  "is_active": true
}
```

> **`project_ids` não vazio**: o template só avalia tasks desses dois projetos,
> mesmo que o componente `payments` apareça em outros projetos do tenant.

#### Ordem de avaliação no engine (priority)

```
priority 10  →  Bug Crítico de Produção          (mais específico)
priority 20  →  Componentes Críticos              (este template)
priority 30  →  Tech Debt Crítico
priority 50  →  Feature — SLA de Sprint
priority 100 →  SLA Padrão (is_default = true)   (fallback)
```

O engine para no **primeiro match**. Uma task `bug P1 labels=production component=payments`
vai bater no template de priority 10 (Bug Crítico), não neste.

---

### Cenário 5 — SLA Padrão (Fallback do Tenant)

**Objetivo:** qualquer task que não se encaixe nos templates específicos ainda tem um prazo
mínimo monitorado. Evita que tasks fiquem sem SLA por omissão.

#### 1. Criar o template — `POST /api/v1/sla/templates`

```json
{
  "name": "SLA Padrão",
  "description": "Fallback: aplicado a tasks que não ativam nenhum outro template.",
  "condition": {
    "operator": "AND",
    "rules": []
  },
  "applies_to": ["bug", "feature", "chore", "spike", "tech_debt"],
  "priority": 100,
  "rules": {
    "P0": { "target_minutes": 120,   "warning_at_percent": 80 },
    "P1": { "target_minutes": 480,   "warning_at_percent": 80 },
    "P2": { "target_minutes": 2880,  "warning_at_percent": 75 },
    "P3": { "target_minutes": 10080, "warning_at_percent": 70 },
    "P4": { "target_minutes": 43200, "warning_at_percent": 0  }
  },
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee"], "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead"], "create_incident": false }
  },
  "project_ids": [],
  "is_default": true,
  "is_active": true
}
```

> `is_default: true` ativa o template como fallback — o engine o usa quando nenhuma condição
> mais específica deu match. A `condition` com `rules: []` nunca falha a avaliação por conta
> própria; o `is_default` é o mecanismo real de fallback.

---

### Visão consolidada: template → task → instância → frontend

```
┌──────────────────────────────────────────────────────────────────┐
│  CTO / Tech Manager configura templates via UI                   │
│  POST /api/v1/sla/templates                                      │
└───────────────────┬──────────────────────────────────────────────┘
                    │  salvo no banco, avaliado automaticamente
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Jira / GitHub sync → worker chama POST /api/v1/sla/evaluate    │
│  com os campos da task (type, priority, labels, component...)    │
└───────────────────┬──────────────────────────────────────────────┘
                    │  engine encontra o template com maior prioridade
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  SlaInstance criada                                              │
│  started_at = task.started_at                                    │
│  deadline_at = started_at + target_minutes                       │
│  status = "running"                                              │
└───────────────────┬──────────────────────────────────────────────┘
                    │  scheduler periódico avalia instâncias ativas
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Status transitions                                              │
│  running → at_risk  (warning_at_percent atingido)               │
│  running → breached (deadline_at ultrapassado)                   │
│  running → met      (task.done antes do deadline)                │
└───────────────────┬──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend consulta                                               │
│  GET /sla/summary                    → scorecard executivo       │
│  GET /sla/summary/by-template        → breakdown por regra SLA   │
│  GET /sla/instances?status=at_risk   → lista de risco atual      │
│  GET /sla/instances?status=breached  → breaches para o CTO       │
│  GET /sla/instances?task_id=<id>     → detalhe de uma task       │
│  task.slaStatus                      → badge na listagem de tasks │
└──────────────────────────────────────────────────────────────────┘
```

### Campos da Task usados como sinal pelo SLA engine

| Campo da Task   | De onde vem | Usado no condition DSL |
|---|---|---|
| `task_type`     | Tipo canônico após normalização / typeMapping (pode ser null se não mapeado) | `{ "field": "task_type", "op": "eq", "value": "bug" }` |
| `original_type` | Tipo exato do provider — nunca normalizado (ex: `"Incident"`, `"Security Finding"`) | `{ "field": "original_type", "op": "in", "value": ["Incident"] }` |
| `priority`      | Jira priority / GitHub milestone label | `{ "field": "priority", "op": "in", "value": ["P0","P1"] }` |
| `labels`        | Jira labels / GitHub labels | `{ "field": "labels", "op": "contains", "value": "production" }` |
| `component`     | Jira component / GitHub team label | `{ "field": "component", "op": "in", "value": ["payments"] }` |
| `project_id`    | Projeto canônico no CTO.ai | filtrado via `project_ids` no template |
| `source`        | `"jira"` ou `"github"` | `{ "field": "source", "op": "eq", "value": "jira" }` |
| `status`        | Status normalizado da task | controla quando o clock inicia (`in_progress`) e para (`done`) |

---

### Cenário 6 — SLA por Tipo Original do Provider (Incidents & Security)

**Objetivo:** SLA específico para tipos que existem no Jira mas não têm equivalente canônico
direto — como `Incident` e `Security Finding`. Usa `original_type` na condition para não depender
do mapeamento canônico.

#### Pré-requisito: descobrir tipos disponíveis no tenant

```
GET /api/v1/integrations/original-types
```

```json
{
  "data": {
    "original_types": ["Bug", "Incident", "Major Incident", "Security Finding", "Task"]
  }
}
```

> Endpoint tenant-scoped: retorna a union de tipos ingeridos em **todas** as connections do tenant.
> Preferível ao endpoint por connection (`/connections/:id/original-types`) aqui porque o template SLA
> é avaliado contra tasks de qualquer connection, não de uma específica.

#### 1. Criar o template — `POST /api/v1/sla/templates`

```json
{
  "name": "Incidents e Security Findings — SLA Urgente",
  "description": "SLA para tipos de incidente e segurança definidos no Jira. Usa original_type para não depender do mapeamento canônico.",
  "condition": {
    "operator": "AND",
    "rules": [
      {
        "field": "original_type",
        "op": "in",
        "value": ["Incident", "Major Incident", "Security Finding"]
      },
      { "field": "priority", "op": "in", "value": ["P0", "P1"] }
    ]
  },
  "applies_to": [],
  "priority": 5,
  "rules": {
    "P0": { "target_minutes": 30,  "warning_at_percent": 70 },
    "P1": { "target_minutes": 120, "warning_at_percent": 80 }
  },
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  },
  "project_ids": [],
  "is_default": false,
  "is_active": true
}
```

> **`applies_to: []`** — o pré-filtro está desativado. O template avalia qualquer task independente
> do `task_type` canônico. O filtro real é a regra `original_type in [...]` na condition.
>
> **`priority: 5`** — avaliado antes de todos os outros templates, pois incidents têm urgência máxima.

#### 2. Evento que dispara o SLA

```json
{
  "task_id":       "tsk-incident-001",
  "tenant_id":     "ten_1",
  "task_type":     "bug",
  "original_type": "Incident",
  "priority":      "P0",
  "status":        "in_progress",
  "labels":        ["on-call", "production"],
  "project_id":    "proj-platform",
  "source":        "jira",
  "started_at":    "2026-04-10T14:00:00Z"
}
```

> `task_type: "bug"` vem do typeMapping configurado pelo tenant (`"Incident" → bug`).
> `original_type: "Incident"` é o tipo exato do Jira — é o que a condition avalia.

#### Relação task_type × original_type

| Situação | task_type | original_type | template ativado? |
|---|---|---|---|
| typeMapping configurado `"Incident" → "bug"` | `"bug"` | `"Incident"` | ✓ — DORA/COGS procedem corretamente |
| typeMapping não configurado para `"Incident"` | `null` | `"Incident"` | ✓ — condition ainda ativa pelo original_type |
| Tipo `"Bug"` nativo do Jira | `"bug"` | `"Bug"` | ✓ — ambas as conditions funcionam |
