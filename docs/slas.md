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

Exemplos de condições suportadas:

| `field`           | Exemplos de `op`           | Exemplos de `value`                      |
|-------------------|----------------------------|------------------------------------------|
| `task_type`       | `in`, `eq`                 | `["bug", "tech_debt"]`                   |
| `priority`        | `in`, `gte`                | `["P0", "P1"]`                           |
| `labels`          | `contains`, `any`          | `"production"`, `["hotfix","sev1"]`      |
| `component`       | `eq`, `in`                 | `"checkout"`, `["payments","billing"]`   |
| `source`          | `eq`                       | `"jira"`, `"github"`                     |
| `project_id`      | `in`                       | `["proj_abc"]`                           |
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
    "task_id":    "tsk_42",
    "source":     "jira",
    "task_type":  "bug",
    "priority":   "P1",
    "status":     "in_progress",
    "labels":     ["production", "backend"],
    "component":  "checkout",
    "project_id": "proj_abc",
    "started_at": "2026-04-08T10:00:00Z"
  }
}
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
| `applies_to`      | enum[]    | Tipos de task: `bug`, `feature`, `chore`, `spike`, `tech_debt`     |
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
