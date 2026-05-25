# Intel API — Expansão v2 — Plano de Novos Endpoints

> **Status:** Planejamento — ainda não implementado  
> **Versão base:** v1 (adiciona endpoints ao módulo `/intel` existente)  
> **Audiência:** Engenheiros frontend + backend que implementarão os novos endpoints  
> **Base URL:** `/api/v1`  
> **Referência atual:** [intel-api.md](./intel-api.md)

---

## Contexto

O módulo Intel atual entrega forecast, anomalias e recomendações. Esta expansão adiciona **análises cross-source** que nenhuma ferramenta isolada (JIRA, GitHub, OpsGenie) consegue entregar sozinha, porque requerem a combinação de dados de entrega, custo, incidentes e capacidade que só existem unificados aqui.

**Premissa de design:** o módulo gera insights, não espelha o que a ferramenta de origem já exibe. Ciclo de vida de tarefa por etapa, por exemplo, é responsabilidade do JIRA/Linear. O que está aqui é o que só pode ser visto com dados consolidados.

---

## Novos Endpoints — Sumário

| Rota                             | Propósito                                                              |
| -------------------------------- | ---------------------------------------------------------------------- |
| `GET /intel/on-time-delivery`    | Taxa de entrega no prazo (tasks com `due_date`)                        |
| `GET /intel/work-mix`            | Composição do trabalho por tipo (features vs bugs vs dívida)           |
| `GET /intel/rework-rate`         | Taxa e custo de retrabalho (tasks re-abertas e re-completadas)         |
| `GET /intel/estimation-accuracy` | Desvio entre estimativa e tempo real                                   |
| `GET /intel/key-person-risk`     | Concentração de responsabilidade por pessoa                            |
| `GET /intel/team-health`         | Scorecard multi-dimensional por time                                   |
| `GET /intel/incident-patterns`   | Padrões de incidentes: frequência, hotspots, severidade                |
| `GET /intel/deploy-quality`      | Correlação entre deploys e incidentes subsequentes                     |
| `GET /intel/sla-suggestions`     | Sugestão de SLA baseada em histórico real (sem templates configurados) |
| `GET /intel/trend-degradation`   | Detecção de degradação gradual silenciosa (regressão linear)           |

---

## Permissões

Todos os endpoints requerem `intel.read`. Nenhum endpoint desta expansão realiza escrita.

| Rota                         | Método | Permissão    | Requer módulo adicional ativo                            |
| ---------------------------- | ------ | ------------ | -------------------------------------------------------- |
| `/intel/on-time-delivery`    | GET    | `intel.read` | —                                                        |
| `/intel/work-mix`            | GET    | `intel.read` | —                                                        |
| `/intel/rework-rate`         | GET    | `intel.read` | `cogs` (para custo em $)                                 |
| `/intel/estimation-accuracy` | GET    | `intel.read` | —                                                        |
| `/intel/key-person-risk`     | GET    | `intel.read` | —                                                        |
| `/intel/team-health`         | GET    | `intel.read` | `cogs` + `dora` para score completo                      |
| `/intel/incident-patterns`   | GET    | `intel.read` | Integração de incidentes ativa (OpsGenie ou incident.io) |
| `/intel/deploy-quality`      | GET    | `intel.read` | Integração de incidentes ativa                           |
| `/intel/sla-suggestions`     | GET    | `intel.read` | —                                                        |
| `/intel/trend-degradation`   | GET    | `intel.read` | —                                                        |

> Quando um módulo adicional necessário não está ativo (ex: `cogs`, `dora`), o endpoint retorna `200` com `data` parcial e o campo `warnings[]` indicando o que não pôde ser computado.

> **`403 FORBIDDEN`** é retornado em todos os endpoints quando o módulo `intel` não está ativo para o tenant (entitlement da subscription). Endpoints que dependem de integrações de incidentes retornam `200` com `data: null` e `warnings` (não `403`) quando a integração não está configurada.

---

## Envelope de resposta padrão

Segue o mesmo padrão dos endpoints existentes:

```typescript
interface ApiResponse<T> {
  data: T;
  meta: { request_id: string; version: string; timestamp: string };
  error: null | { code: string; message: string; details?: unknown };
}
```

---

## Endpoints

---

### GET /intel/on-time-delivery

Taxa de entrega no prazo para tasks que possuem `due_date`. Mostra tendência por período e quebra por equipe, projeto e prioridade.

**Caso de uso:** identificar se o time está melhorando ou piorando sua capacidade de cumprir prazos. Funciona sem SLA configurado — usa o `due_date` da task como contrato.

**Limitação conhecida:** tasks sem `due_date` são excluídas do cálculo. Consultas com baixo volume de tasks com `due_date` retornam `low_sample: true`. Recomenda-se exibir um aviso no frontend quando `total_tasks_with_due_date` < 10 ou quando `coverage_percent` (proporção de tasks com `due_date` sobre total concluídas) for < 30%.

**Query Params:**

| Param            | Tipo   | Obrigatório | Default       | Notas                                                           |
| ---------------- | ------ | ----------- | ------------- | --------------------------------------------------------------- |
| `project_id`     | UUID   | ❌          | —             | Escopo por projeto                                              |
| `team_id`        | UUID   | ❌          | —             | Escopo por time                                                 |
| `priority`       | enum   | ❌          | —             | Filtro: `P0` \| `P1` \| `P2` \| `P3` \| `P4`                    |
| `task_type`      | enum   | ❌          | —             | Filtro: `feature` \| `bug` \| `chore` \| `spike` \| `tech_debt` |
| `period`         | string | ❌          | last 3 months | `YYYY-Qn` ou `YYYY-MM`. Período de análise                      |
| `compare_period` | string | ❌          | —             | Período anterior para delta. Mesmo formato de `period`          |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "team_id": null,
    "on_time_rate_percent": 72.4,
    "coverage_percent": 68.2,
    "total_tasks_with_due_date": 58,
    "delivered_on_time": 42,
    "delivered_late": 16,
    "low_sample": false,
    "comparison": {
      "period": "2026-Q1",
      "on_time_rate_percent": 65.1,
      "delta_pp": 7.3,
      "trend": "improving"
    },
    "breakdown_by_priority": [
      { "priority": "P0", "on_time_rate_percent": 100, "total": 3 },
      { "priority": "P1", "on_time_rate_percent": 80.0, "total": 15 },
      { "priority": "P2", "on_time_rate_percent": 68.4, "total": 38 },
      { "priority": "P3", "on_time_rate_percent": 50.0, "total": 2 }
    ],
    "breakdown_by_type": [
      { "task_type": "bug", "on_time_rate_percent": 60.0, "total": 20 },
      { "task_type": "feature", "on_time_rate_percent": 78.9, "total": 38 }
    ]
  },
  "meta": {
    "request_id": "req_otd_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                  | Tipo                                   | Descrição                                                                                                                                                   |
| ---------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `on_time_rate_percent` | number                                 | `(delivered_on_time / total_tasks_with_due_date) × 100`                                                                                                     |
| `coverage_percent`     | number                                 | `(total_tasks_with_due_date / total_tasks_concluídas_no_período) × 100`. Proporção de tasks concluídas com `due_date` preenchido. Exibir aviso quando < 30% |
| `low_sample`           | boolean                                | `true` quando `total_tasks_with_due_date` < 10. Interpretar com cautela                                                                                     |
| `comparison.delta_pp`  | number                                 | Diferença em pontos percentuais vs `compare_period`. Positivo = melhora                                                                                     |
| `comparison.trend`     | `improving` \| `declining` \| `stable` | > +5pp = `improving`, < −5pp = `declining`, entre −5pp e +5pp = `stable`                                                                                    |

**Error Scenarios:**

| Status | Code           | Quando                                           |
| ------ | -------------- | ------------------------------------------------ |
| 400    | `BAD_REQUEST`  | Formato inválido de `period` ou `compare_period` |
| 401    | `UNAUTHORIZED` | JWT ausente ou inválido                          |

---

### GET /intel/work-mix

Composição do trabalho entregue por tipo de task (feature, bug, chore, tech_debt, spike) em um período. Inclui tendência entre períodos para detectar degradação de qualidade ou acúmulo de dívida técnica.

**Caso de uso:** se bugs representam 40% do trabalho do trimestre vs 15% no anterior, é um sinal de que algo na qualidade do produto piorou. Se `tech_debt` cresce enquanto `feature` cai, pode indicar refinamento consciente ou dívida acumulada impedindo entregas.

**Query Params:**

| Param            | Tipo   | Obrigatório | Default          | Notas                                      |
| ---------------- | ------ | ----------- | ---------------- | ------------------------------------------ |
| `project_id`     | UUID   | ❌          | —                | Escopo por projeto                         |
| `team_id`        | UUID   | ❌          | —                | Escopo por time                            |
| `period`         | string | ❌          | current quarter  | `YYYY-Qn` ou `YYYY-MM`                     |
| `compare_period` | string | ❌          | previous quarter | Período anterior para delta. Mesmo formato |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "project_id": null,
    "team_id": "team-a1b2c3",
    "total_delivered": 84,
    "untyped_excluded_count": 3,
    "mix": [
      {
        "task_type": "feature",
        "count": 38,
        "percent": 45.2,
        "delta_pp": -8.1,
        "signal": "watch"
      },
      {
        "task_type": "bug",
        "count": 30,
        "percent": 35.7,
        "delta_pp": 12.4,
        "signal": "alert"
      },
      {
        "task_type": "chore",
        "count": 10,
        "percent": 11.9,
        "delta_pp": 1.2,
        "signal": "stable"
      },
      {
        "task_type": "tech_debt",
        "count": 5,
        "percent": 6.0,
        "delta_pp": 3.0,
        "signal": "stable"
      },
      {
        "task_type": "spike",
        "count": 1,
        "percent": 1.2,
        "delta_pp": -1.1,
        "signal": "stable"
      }
    ],
    "compare_period": "2026-Q1",
    "alerts": [
      {
        "level": "warning",
        "message": "Bugs representam 35.7% do trabalho entregue (+12.4pp vs trimestre anterior). Pode indicar queda de qualidade ou aumento de bugs de produção."
      }
    ]
  },
  "meta": {
    "request_id": "req_wm_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                    | Tipo           | Descrição                                                                                                        |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `total_delivered`        | integer        | Tasks com `status: done` no período. Não inclui tasks com `task_type: null`                                      |
| `untyped_excluded_count` | integer        | Tasks concluídas sem `task_type` definido — excluídas do mix. Valor > 0 indica gap no type mapping da integração |
| `mix[].percent`          | number         | Proporção do tipo sobre `total_delivered`                                                                        |
| `mix[].delta_pp`         | number \| null | Variação em pontos percentuais vs `compare_period`. `null` quando `compare_period` não fornecido                 |
| `mix[].signal`           | string         | Sinal de qualidade para este tipo no período (ver tabela abaixo)                                                 |
| `alerts`                 | array          | Alertas gerados automaticamente quando critérios de sinal são atingidos                                          |

**Signal Values (por tipo):**

| Valor     | Aplicável a        | Critério                      |
| --------- | ------------------ | ----------------------------- |
| `alert`   | `bug`, `tech_debt` | `delta_pp` > +10pp            |
| `decline` | `feature`          | `delta_pp` < −10pp            |
| `watch`   | `bug`, `tech_debt` | `delta_pp` entre +5pp e +10pp |
| `watch`   | `feature`          | `delta_pp` entre −5pp e −10pp |
| `stable`  | Qualquer tipo      | Variação absoluta ≤ 5pp       |

**Error Scenarios:**

| Status | Code           | Quando                       |
| ------ | -------------- | ---------------------------- |
| 400    | `BAD_REQUEST`  | Formato inválido de `period` |
| 401    | `UNAUTHORIZED` | —                            |

---

### GET /intel/rework-rate

Taxa e custo financeiro de retrabalho: tasks que foram concluídas, re-abertas e concluídas novamente (`CogsEntry.revision > 0`).

**Caso de uso:** o JIRA mostra re-aberturas por contagem. Aqui o insight é o **custo real do retrabalho em horas e $**, por projeto/time, com tendência. Permite ao gestor priorizar melhorias de processo com dados financeiros.

**Dependência:** custo em $ requer que o módulo `cogs` esteja ativo e com entradas para o período. Sem `cogs`, retorna apenas contagens (`cost_usd` e `cost_hours` serão `null`).

**Query Params:**

| Param        | Tipo   | Obrigatório | Default         | Notas                  |
| ------------ | ------ | ----------- | --------------- | ---------------------- |
| `project_id` | UUID   | ❌          | —               | Escopo por projeto     |
| `team_id`    | UUID   | ❌          | —               | Escopo por time        |
| `period`     | string | ❌          | current quarter | `YYYY-Qn` ou `YYYY-MM` |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "team_id": null,
    "total_tasks_completed": 84,
    "rework_count": 11,
    "rework_rate_percent": 13.1,
    "cost_hours": 62.5,
    "cost_usd": 4375.0,
    "warnings": [],
    "breakdown_by_type": [
      {
        "task_type": "bug",
        "rework_count": 6,
        "rework_rate_percent": 20.0,
        "cost_hours": 30.0,
        "cost_usd": 2100.0
      },
      {
        "task_type": "feature",
        "rework_count": 4,
        "rework_rate_percent": 9.8,
        "cost_hours": 28.0,
        "cost_usd": 1960.0
      },
      {
        "task_type": "chore",
        "rework_count": 1,
        "rework_rate_percent": 7.7,
        "cost_hours": 4.5,
        "cost_usd": 315.0
      }
    ],
    "top_reworked_tasks": [
      {
        "task_id": "task-cc9012",
        "title": "Fix payment gateway timeout",
        "revisions": 3,
        "cost_usd": 875.0,
        "assignee_id": "user-88bc"
      }
    ]
  },
  "meta": {
    "request_id": "req_rw_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                 | Tipo           | Descrição                                                                                                                                      |
| --------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `rework_rate_percent` | number         | `(rework_count / total_tasks_completed) × 100`                                                                                                 |
| `cost_usd`            | number \| null | Soma dos `CogsEntry.total_cost` onde `revision > 0`. `null` se módulo `cogs` inativo                                                           |
| `cost_hours`          | number \| null | Soma das `CogsEntry.hours_worked` onde `revision > 0`. `null` se módulo `cogs` inativo                                                         |
| `warnings`            | string[]       | Ex: `["cogs_module_inactive: cost fields unavailable"]`                                                                                        |
| `top_reworked_tasks`  | array          | Top 5 tasks com mais revisões. Ordenado por `revisions` DESC. `cost_usd` e `cost_hours` serão `null` em cada item quando módulo `cogs` inativo |

**Error Scenarios:**

| Status | Code           | Quando                       |
| ------ | -------------- | ---------------------------- |
| 400    | `BAD_REQUEST`  | Formato inválido de `period` |
| 401    | `UNAUTHORIZED` | —                            |

---

### GET /intel/estimation-accuracy

Compara `hours_estimated` vs `hours_actual` por tipo de task, prioridade e time. Calcula overrun percentual médio e tendência histórica.

**Caso de uso:** o JIRA mostra desvio por sprint isolado. Aqui o insight é se o time **consistentemente** super ou subestima determinados tipos de trabalho, e se está melhorando ao longo do tempo. Útil para refinar processos de planejamento.

**Limitação:** tasks sem `hours_estimated` ou sem `hours_actual` são excluídas. Resposta inclui `coverage_percent` indicando a fração de tasks com ambos os campos preenchidos.

**Query Params:**

| Param        | Tipo   | Obrigatório | Default       | Notas                  |
| ------------ | ------ | ----------- | ------------- | ---------------------- |
| `project_id` | UUID   | ❌          | —             | Escopo por projeto     |
| `team_id`    | UUID   | ❌          | —             | Escopo por time        |
| `period`     | string | ❌          | last 6 months | `YYYY-Qn` ou `YYYY-MM` |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "project_id": null,
    "team_id": "team-a1b2c3",
    "coverage_percent": 78.5,
    "overall_overrun_percent": 34.2,
    "overall_bias": "overrun",
    "breakdown_by_type": [
      {
        "task_type": "bug",
        "avg_estimated_hours": 3.2,
        "avg_actual_hours": 5.8,
        "avg_overrun_percent": 81.2,
        "sample_size": 20,
        "bias": "overrun"
      },
      {
        "task_type": "feature",
        "avg_estimated_hours": 8.5,
        "avg_actual_hours": 9.1,
        "avg_overrun_percent": 7.1,
        "sample_size": 38,
        "bias": "accurate"
      },
      {
        "task_type": "tech_debt",
        "avg_estimated_hours": 12.0,
        "avg_actual_hours": 9.5,
        "avg_overrun_percent": -20.8,
        "sample_size": 5,
        "bias": "underrun"
      }
    ],
    "low_coverage_warning": false,
    "breakdown_by_priority": [
      {
        "priority": "P0",
        "avg_estimated_hours": 6.0,
        "avg_actual_hours": 13.2,
        "avg_overrun_percent": 120.0,
        "sample_size": 3,
        "bias": "overrun"
      },
      {
        "priority": "P1",
        "avg_estimated_hours": 4.2,
        "avg_actual_hours": 6.5,
        "avg_overrun_percent": 55.3,
        "sample_size": 15,
        "bias": "overrun"
      }
    ]
  },
  "meta": {
    "request_id": "req_ea_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                  | Tipo                                  | Descrição                                                                                                                            |
| ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `coverage_percent`     | number                                | `(tasks com ambos os campos / total tasks concluídas no período) × 100`                                                              |
| `avg_overrun_percent`  | number                                | `((actual - estimated) / estimated) × 100`. Negativo = underrun                                                                      |
| `bias`                 | `overrun` \| `underrun` \| `accurate` | `overrun` > +15%, `underrun` < -15%, `accurate` entre -15% e +15%                                                                    |
| `overall_bias`         | string                                | Bias agregado de todos os tipos                                                                                                      |
| `low_coverage_warning` | boolean                               | `true` quando `coverage_percent` < 30%. Indica que a maioria das tasks não tem ambos os campos preenchidos — interpretar com cautela |

**Error Scenarios:**

| Status | Code           | Quando                       |
| ------ | -------------- | ---------------------------- |
| 400    | `BAD_REQUEST`  | Formato inválido de `period` |
| 401    | `UNAUTHORIZED` | —                            |

---

### GET /intel/key-person-risk

Identifica concentração de responsabilidade por pessoa em projetos e epics ativos. Aponta riscos de dependência onde uma única pessoa representa ponto único de falha.

**Caso de uso:** o gestor precisa saber, antes de uma pessoa sair de férias ou do time, qual o impacto real nas entregas em andamento. Também é útil para distribuição de onboarding ou redistribuição de carga.

**Query Params:**

| Param                             | Tipo   | Obrigatório | Default | Notas                                          |
| --------------------------------- | ------ | ----------- | ------- | ---------------------------------------------- |
| `project_id`                      | UUID   | ❌          | —       | Escopo por projeto                             |
| `team_id`                         | UUID   | ❌          | —       | Escopo por time                                |
| `concentration_threshold_percent` | number | ❌          | 30      | % de tasks para considerar concentração: 10–80 |

> Todos os membros com ao menos uma task ativa no escopo são retornados, ordenados por `concentration_percent` DESC. Membros abaixo do threshold aparecem com `risk_level: "low"` para dar contexto da distribuição total de carga.

**Response — 200 OK:**

```json
{
  "data": {
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "team_id": null,
    "concentration_threshold_percent": 30,
    "total_active_tasks": 52,
    "people": [
      {
        "user_id": "user-88bc",
        "full_name": "Ana Souza",
        "active_tasks_assigned": 18,
        "concentration_percent": 34.6,
        "risk_level": "high",
        "epics_owned": [
          {
            "epic_id": "aaa",
            "epic_name": "Auth Revamp",
            "completion_percent": 60
          }
        ],
        "blocking_others": 3,
        "blast_radius": {
          "tasks_directly_blocked": 3,
          "epics_impacted": 2,
          "estimated_sp_at_risk": 24
        }
      },
      {
        "user_id": "user-f31a9b",
        "full_name": "Carlos Lima",
        "active_tasks_assigned": 9,
        "concentration_percent": 17.3,
        "risk_level": "low",
        "epics_owned": [],
        "blocking_others": 0,
        "blast_radius": {
          "tasks_directly_blocked": 0,
          "epics_impacted": 0,
          "estimated_sp_at_risk": 0
        }
      }
    ]
  },
  "meta": {
    "request_id": "req_kpr_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                                 | Tipo                        | Descrição                                                                                    |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `concentration_percent`               | number                      | `(active_tasks_assigned / total_active_tasks) × 100`                                         |
| `risk_level`                          | `high` \| `medium` \| `low` | `high` ≥ threshold, `medium` ≥ threshold/2, `low` abaixo                                     |
| `blocking_others`                     | integer                     | Quantidade de tasks desta pessoa que são bloqueadoras de outras tasks (via `TaskDependency`) |
| `blast_radius.tasks_directly_blocked` | integer                     | Tasks que ficam bloqueadas se esta pessoa parar                                              |
| `blast_radius.estimated_sp_at_risk`   | integer                     | Story points em risco considerando bloqueados + tarefas atribuídas                           |

**Error Scenarios:**

| Status | Code           | Quando                                          |
| ------ | -------------- | ----------------------------------------------- |
| 400    | `BAD_REQUEST`  | `concentration_threshold_percent` fora de 10–80 |
| 401    | `UNAUTHORIZED` | —                                               |

---

### GET /intel/team-health

Scorecard multi-dimensional por time, combinando dados de entrega, qualidade, capacidade, confiabilidade e custo. Não é um único número — é um radar de 6 dimensões para o gestor identificar rapidamente onde cada time está fora do padrão.

**Caso de uso:** visão executiva consolidada. Cada dimensão tem nível (`good`, `watch`, `alert`) e contexto para drill-down. O módulo não prescreve a causa — aponta onde investigar.

**Dependências:** quanto mais módulos ativos, mais dimensões preenchidas. Com apenas Core + Integrations, 3 dimensões ficam disponíveis. `warnings[]` indica o que está incompleto.

**Query Params:**

| Param     | Tipo   | Obrigatório | Default         | Notas                                        |
| --------- | ------ | ----------- | --------------- | -------------------------------------------- |
| `team_id` | UUID   | ❌          | —               | Se omitido, retorna todos os times do tenant |
| `period`  | string | ❌          | current quarter | `YYYY-Qn` ou `YYYY-MM`                       |

> Quando `team_id` é omitido, todos os times do tenant são retornados em um único array sem paginação. Para tenants com muitos times (> 20), recomenda-se sempre filtrar por `team_id` para evitar payloads grandes.

**Response — 200 OK:**

```json
{
  "data": [
    {
      "team_id": "team-a1b2c3",
      "team_name": "Platform Engineering",
      "period": "2026-Q2",
      "warnings": [],
      "dimensions": {
        "velocity": {
          "available": true,
          "level": "watch",
          "value": 14.2,
          "unit": "points_per_week",
          "trend": "declining",
          "context": "Velocidade caiu 18% vs período anterior"
        },
        "on_time_delivery": {
          "available": true,
          "level": "alert",
          "value": 48.3,
          "unit": "percent",
          "trend": "declining",
          "context": "Menos da metade das tasks com prazo estão sendo entregues no prazo"
        },
        "work_quality": {
          "available": true,
          "level": "watch",
          "value": 28.5,
          "unit": "percent_bugs",
          "trend": "increasing",
          "context": "Bugs representam 28.5% do trabalho (+10pp vs período anterior)"
        },
        "capacity": {
          "available": true,
          "level": "good",
          "value": 91.2,
          "unit": "percent_utilization",
          "trend": "stable",
          "context": "Capacidade dentro do intervalo normal (70–110%)"
        },
        "dora": {
          "available": true,
          "level": "good",
          "value": "high",
          "unit": "dora_level",
          "trend": "stable",
          "context": "DORA overall level: high"
        },
        "budget_burn": {
          "available": true,
          "level": "good",
          "value": 72.4,
          "unit": "percent_of_budget",
          "trend": "stable",
          "context": "72.4% do orçamento consumido no período"
        }
      },
      "overall_level": "watch"
    }
  ],
  "meta": {
    "request_id": "req_th_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Dimensões e critérios de nível:**

| Dimensão           | Fonte                     | `good`                     | `watch`           | `alert`                           |
| ------------------ | ------------------------- | -------------------------- | ----------------- | --------------------------------- |
| `velocity`         | Core / Tasks              | trend estável ou crescente | trend down <20%   | trend down ≥20% ou confidence <40 |
| `on_time_delivery` | Core / Tasks + `due_date` | ≥ 75%                      | 50–74%            | < 50%                             |
| `work_quality`     | Core / Tasks              | bugs < 15% do mix          | bugs 15–25%       | bugs > 25%                        |
| `capacity`         | COGS                      | 70–110%                    | < 70% ou 110–130% | > 130%                            |
| `dora`             | DORA / HealthMetric       | `elite` ou `high`          | `medium`          | `low`                             |
| `budget_burn`      | COGS / CogsBudget         | < 85% no período           | 85–100%           | > 100%                            |

**`overall_level`:** nível mais grave entre todas as dimensões disponíveis.

**Field Reference:**

| Campo                     | Tipo                         | Descrição                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dimensions[x].available` | boolean                      | `false` quando módulo necessário está inativo. Demais campos ficam `null`                                                                                                                                                                             |
| `dimensions[x].level`     | `good` \| `watch` \| `alert` | Nível de saúde desta dimensão                                                                                                                                                                                                                         |
| `dimensions[x].trend`     | string                       | Tendência vs período anterior. Métricas de taxa (`velocity`, `on_time_delivery`, `dora`): `improving` \| `declining` \| `stable`. Métricas de volume/percentual (`work_quality`, `capacity`, `budget_burn`): `increasing` \| `decreasing` \| `stable` |
| `warnings`                | string[]                     | Ex: `["dora_module_inactive: dora dimension unavailable"]`                                                                                                                                                                                            |

**Error Scenarios:**

| Status | Code           | Quando                       |
| ------ | -------------- | ---------------------------- |
| 400    | `BAD_REQUEST`  | Formato inválido de `period` |
| 401    | `UNAUTHORIZED` | —                            |

---

### GET /intel/incident-patterns

Análise de padrões em incidentes: frequência temporal, serviços recorrentes (hotspots), distribuição por severidade e horário de ocorrência.

**Caso de uso:** identifica se a frequência de incidentes está crescendo, quais serviços quebram mais e se existe padrão de horário. O gestor pode usar para priorizar esforços de reliability sem precisar do DORA — mesmo que o módulo DORA não esteja configurado.

**Disponibilidade:** requer pelo menos uma integração de incidentes ativa (OpsGenie ou incident.io). Sem isso, retorna `200` com `data: null` e `warnings: ["no_incident_integration_active"]`.

**Query Params:**

| Param            | Tipo   | Obrigatório | Default                                        | Notas                                                                 |
| ---------------- | ------ | ----------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `project_id`     | UUID   | ❌          | —                                              | Filtra incidentes por `affected_services` cruzado com `ProjectSource` |
| `period`         | string | ❌          | últimos 90 dias (backend resolve como YYYY-MM) | `YYYY-Qn` ou `YYYY-MM`                                                |
| `compare_period` | string | ❌          | período equivalente anterior                   | Mesmo formato de `period`                                             |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "total_incidents": 23,
    "warnings": [],
    "frequency": {
      "incidents_per_week": 2.56,
      "trend": "increasing",
      "compare_period": "2026-Q1",
      "incidents_per_week_prior": 1.23,
      "delta_percent": 108.1
    },
    "severity_distribution": [
      {
        "severity": "critical",
        "count": 3,
        "percent": 13.0,
        "avg_mttr_hours": 4.2
      },
      {
        "severity": "high",
        "count": 8,
        "percent": 34.8,
        "avg_mttr_hours": 6.8
      },
      {
        "severity": "medium",
        "count": 10,
        "percent": 43.5,
        "avg_mttr_hours": 12.1
      },
      { "severity": "low", "count": 2, "percent": 8.7, "avg_mttr_hours": 1.5 }
    ],
    "hotspot_services": [
      {
        "service": "payments-api",
        "count": 8,
        "percent": 34.8,
        "last_incident_at": "2026-05-22T03:14:00Z"
      },
      {
        "service": "auth-service",
        "count": 5,
        "percent": 21.7,
        "last_incident_at": "2026-05-20T11:30:00Z"
      }
    ],
    "time_of_day_distribution": [
      { "hour_utc": 2, "count": 5 },
      { "hour_utc": 3, "count": 4 },
      { "hour_utc": 14, "count": 3 }
    ],
    "mtta_p50_minutes": 8.4,
    "mttr_p50_hours": 7.3
  },
  "meta": {
    "request_id": "req_ip_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                      | Tipo                                     | Descrição                                                                                                                                                      |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frequency.trend`          | `increasing` \| `decreasing` \| `stable` | Baseado em `delta_percent`: >20% = increasing, <-20% = decreasing                                                                                              |
| `hotspot_services`         | array                                    | Serviços de `IncidentEvent.affected_services[]` com maior recorrência. Top 10                                                                                  |
| `time_of_day_distribution` | array                                    | Distribuição de incidentes por hora UTC. Apenas horas com ao menos 1 incidente são retornadas — horas sem ocorrência são omitidas. Útil para ajuste de on-call |
| `mtta_p50_minutes`         | number \| null                           | Mediana do tempo de reconhecimento (`acknowledged_at - opened_at`). `null` se sem dados                                                                        |
| `mttr_p50_hours`           | number \| null                           | Mediana do tempo de resolução (`resolved_at - opened_at`). `null` se sem dados                                                                                 |

**Error Scenarios:**

| Status | Code           | Quando                       |
| ------ | -------------- | ---------------------------- |
| 400    | `BAD_REQUEST`  | Formato inválido de `period` |
| 401    | `UNAUTHORIZED` | —                            |

---

### GET /intel/deploy-quality

Correlaciona eventos de deploy com incidentes que ocorreram nas 24h ou 48h seguintes. Quantifica a proporção de deploys que causaram incidentes e a tendência de hotfixes e rollbacks.

**Caso de uso:** um time pode ter alta frequência de deploys (DORA excelente em deploy frequency) mas ainda assim estar causando muitos incidentes pós-deploy. Este endpoint expõe essa contradição.

**Disponibilidade:** requer integração de incidentes ativa. Sem dados de incidente, `incident_correlated_percent` retorna `null` com warning. Análise de hotfixes/rollbacks continua disponível a partir de `DeployEvent`.

**Query Params:**

| Param                   | Tipo    | Obrigatório | Default | Notas                                               |
| ----------------------- | ------- | ----------- | ------- | --------------------------------------------------- |
| `project_id`            | UUID    | ❌          | —       | Escopo por projeto                                  |
| `window_days`           | integer | ❌          | 90      | Janela histórica: 7–365 dias                        |
| `incident_window_hours` | integer | ❌          | 24      | Janela pós-deploy para considerar correlação: 1–72h |

**Response — 200 OK:**

```json
{
  "data": {
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "window_days": 90,
    "incident_window_hours": 24,
    "total_deploys": 47,
    "hotfix_count": 6,
    "hotfix_rate_percent": 12.8,
    "rollback_count": 2,
    "rollback_rate_percent": 4.3,
    "incident_correlated_count": 9,
    "incident_correlated_percent": 19.1,
    "warnings": [],
    "trend": {
      "hotfix_rate_direction": "increasing",
      "rollback_rate_direction": "stable",
      "incident_correlation_direction": "increasing"
    },
    "worst_deploys": [
      {
        "deploy_id": "deploy-xyz",
        "ref": "v2.3.1",
        "deployed_at": "2026-05-10T15:00:00Z",
        "is_hotfix": true,
        "is_rollback": false,
        "incident_count_within_window": 2,
        "incidents": [
          {
            "incident_id": "inc-001",
            "severity": "critical",
            "opened_at": "2026-05-10T16:30:00Z"
          }
        ]
      }
    ]
  },
  "meta": {
    "request_id": "req_dq_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                         | Tipo                                     | Descrição                                                                                                                             |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `hotfix_rate_percent`         | number                                   | `(hotfix_count / total_deploys) × 100`                                                                                                |
| `rollback_rate_percent`       | number                                   | `(rollback_count / total_deploys) × 100`                                                                                              |
| `incident_correlated_percent` | number \| null                           | % dos deploys seguidos de pelo menos 1 incidente na janela. `null` sem integração de incidentes                                       |
| `worst_deploys`               | array                                    | Top 5 deploys com maior número de incidentes correlacionados. Ordenado por `incident_count_within_window` DESC. Útil para post-mortem |
| `trend.x_direction`           | `increasing` \| `decreasing` \| `stable` | Comparação primeira metade vs segunda metade da janela temporal                                                                       |

**Error Scenarios:**

| Status | Code           | Quando                                                              |
| ------ | -------------- | ------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`  | `window_days` fora de 7–365 ou `incident_window_hours` fora de 1–72 |
| 401    | `UNAUTHORIZED` | —                                                                   |

---

### GET /intel/sla-suggestions

Com base no histórico real de cycle times, sugere thresholds de SLA para cada combinação `(task_type, priority)` observada. Funciona **sem nenhum SLA configurado** — usa apenas as tasks já concluídas.

**Caso de uso:** o gestor ainda não configurou SLAs (ou quer revisar os existentes). Este endpoint analisa o que já aconteceu historicamente e propõe targets defensivos baseados em percentis. O gestor decide qual percentil usar e pode criar o `SlaTemplate` a partir da sugestão.

**Limitação:** requer um mínimo de tasks concluídas com `cycle_time_hours` preenchido. Combinações com amostra insuficiente são retornadas com `low_sample: true` e sem `suggested_target_hours`.

**Query Params:**

| Param               | Tipo    | Obrigatório | Default | Notas                                                    |
| ------------------- | ------- | ----------- | ------- | -------------------------------------------------------- |
| `project_id`        | UUID    | ❌          | —       | Escopo por projeto                                       |
| `team_id`           | UUID    | ❌          | —       | Escopo por time                                          |
| `min_sample_size`   | integer | ❌          | 10      | Mínimo de tasks por combinação para gerar sugestão: 5–50 |
| `target_percentile` | number  | ❌          | 75      | Percentil usado como target sugerido: 50, 75, 90 ou 95   |
| `window_days`       | integer | ❌          | 180     | Janela histórica para análise: 30–365 dias               |

**Response — 200 OK:**

```json
{
  "data": {
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "team_id": null,
    "target_percentile": 75,
    "window_days": 180,
    "suggestions": [
      {
        "task_type": "bug",
        "priority": "P1",
        "sample_size": 34,
        "low_sample": false,
        "percentiles": {
          "p50_hours": 3.2,
          "p75_hours": 7.1,
          "p90_hours": 14.8,
          "p95_hours": 21.3
        },
        "suggested_target_hours": 7.1,
        "suggested_warning_at_percent": 80,
        "rationale": "75% dos bugs P1 são resolvidos em até 7.1h. Usar este valor garante que 3 em cada 4 tarefas similares cumpram o SLA."
      },
      {
        "task_type": "bug",
        "priority": "P2",
        "sample_size": 7,
        "low_sample": true,
        "percentiles": null,
        "suggested_target_hours": null,
        "rationale": "Amostra insuficiente (7 tasks, mínimo 10). Aguardar mais dados para sugestão confiável."
      },
      {
        "task_type": "feature",
        "priority": "P2",
        "sample_size": 52,
        "low_sample": false,
        "percentiles": {
          "p50_hours": 18.5,
          "p75_hours": 32.0,
          "p90_hours": 56.0,
          "p95_hours": 80.0
        },
        "suggested_target_hours": 32.0,
        "suggested_warning_at_percent": 80,
        "rationale": "75% das features P2 são entregues em até 32h. Considere 40h se quiser uma margem mais conservadora (p90)."
      }
    ],
    "sla_template_hints": [
      {
        "applies_to": ["bug"],
        "rules": {
          "P0": { "target_minutes": null, "warning_at_percent": 80 },
          "P1": { "target_minutes": 426, "warning_at_percent": 80 },
          "P2": { "target_minutes": null, "warning_at_percent": 80 }
        },
        "note": "P0 e P2 sem sugestão por amostra insuficiente. Preencha manualmente antes de criar o template."
      },
      {
        "applies_to": ["feature"],
        "rules": {
          "P2": { "target_minutes": 1920, "warning_at_percent": 80 }
        },
        "note": "Apenas P2 com amostra suficiente para features neste escopo."
      }
    ]
  },
  "meta": {
    "request_id": "req_slas_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                                          | Tipo            | Descrição                                                                                                                                                                                           |
| ---------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suggested_target_hours`                       | number \| null  | Valor do percentil escolhido em `target_percentile`. `null` se `low_sample: true`                                                                                                                   |
| `suggested_warning_at_percent`                 | integer         | Fixo em 80 (padrão dos SlaTemplates existentes)                                                                                                                                                     |
| `rationale`                                    | string          | Explicação em linguagem natural da sugestão ou motivo da ausência                                                                                                                                   |
| `sla_template_hints`                           | array           | Um item por `task_type` com amostra suficiente. Cada item é compatível com `POST /sla/templates`. `rules` com `target_minutes: null` precisam ser preenchidos pelo gestor antes de criar o template |
| `sla_template_hints[].rules[P].target_minutes` | integer \| null | `round(suggested_target_hours × 60)`. `null` onde amostra insuficiente                                                                                                                              |

**Error Scenarios:**

| Status | Code           | Quando                                                                         |
| ------ | -------------- | ------------------------------------------------------------------------------ |
| 400    | `BAD_REQUEST`  | `target_percentile` fora de [50, 75, 90, 95] ou `min_sample_size` fora de 5–50 |
| 401    | `UNAUTHORIZED` | —                                                                              |

---

### GET /intel/trend-degradation

Detecta métricas com degradação gradual contínua usando regressão linear — casos que o z-score pontual não captura porque cada ponto individualmente parece normal, mas a tendência de longo prazo é consistentemente negativa.

**Caso de uso:** "Nenhuma anomalia pontual foi detectada, mas nossa velocity caiu 2 pontos por semana durante 3 meses." Este endpoint encontra exatamente esse padrão silencioso antes que se torne uma crise.

**Query Params:**

| Param                    | Tipo    | Obrigatório | Default | Notas                                                                                                                                                  |
| ------------------------ | ------- | ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `project_id`             | UUID    | ❌          | —       | Escopo por projeto                                                                                                                                     |
| `team_id`                | UUID    | ❌          | —       | Escopo por time                                                                                                                                        |
| `window_days`            | integer | ❌          | 90      | Janela histórica: 30–365 dias                                                                                                                          |
| `min_points`             | integer | ❌          | 5       | Mínimo de pontos na série para análise: 3–20                                                                                                           |
| `significance_threshold` | number  | ❌          | 0.05    | Limite de significância: 0.01–0.20. Valores menores são mais conservadores (menos falsos positivos). O padrão 0.05 é adequado para a maioria dos casos |

**Response — 200 OK:**

```json
{
  "data": {
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "team_id": null,
    "window_days": 90,
    "degrading_metrics": [
      {
        "metric_name": "deployment_frequency",
        "direction": "down",
        "slope_per_day": -0.08,
        "r_squared": 0.72,
        "p_value": 0.003,
        "statistically_significant": true,
        "first_value": 1.8,
        "last_value": 0.6,
        "decline_percent": 66.7,
        "data_points": 12,
        "interpretation": "Frequência de deploys caiu de 1.8/dia para 0.6/dia nos últimos 90 dias — declínio de 66.7%. A tendência é estatisticamente significativa (p=0.003)."
      },
      {
        "metric_name": "sprint_velocity",
        "direction": "down",
        "slope_per_day": -0.21,
        "r_squared": 0.61,
        "p_value": 0.018,
        "statistically_significant": true,
        "first_value": 22.0,
        "last_value": 13.5,
        "decline_percent": 38.6,
        "data_points": 9,
        "interpretation": "Velocidade caiu de 22 para 13.5 SP/semana — declínio de 38.6% em 90 dias."
      }
    ],
    "stable_metrics": ["lead_time", "change_failure_rate"],
    "insufficient_data_metrics": ["mttr"]
  },
  "meta": {
    "request_id": "req_td_01",
    "version": "v1",
    "timestamp": "2026-05-25T10:00:00Z"
  },
  "error": null
}
```

**Field Reference:**

| Campo                       | Tipo               | Descrição                                                                                                                                                                           |
| --------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metric_name`               | string             | Nome da métrica analisada. Valores possíveis: `deployment_frequency`, `sprint_velocity`, `lead_time`, `change_failure_rate`, `mttr`, `on_time_rate`, `bug_rate`                     |
| `direction`                 | `"up"` \| `"down"` | Direção da tendência detectada. `"down"` = métrica está caindo ao longo do tempo                                                                                                    |
| `slope_per_day`             | number             | Inclinação da regressão linear: variação do valor por dia. Negativo = declining                                                                                                     |
| `r_squared`                 | 0.0–1.0            | Coeficiente de determinação. Quanto maior, mais a série segue a tendência linear (>0.5 é relevante)                                                                                 |
| `p_value`                   | number             | Probabilidade de a tendência ser aleatória. < `significance_threshold` = significativa. Exibir como contexto avançado; a maioria dos usuários deve usar `statistically_significant` |
| `statistically_significant` | boolean            | `p_value < significance_threshold`. Este é o campo principal para lógica de UI                                                                                                      |
| `decline_percent`           | number             | `((last_value - first_value) / first_value) × 100`. Negativo = queda                                                                                                                |
| `stable_metrics`            | string[]           | Métricas analisadas sem tendência significativa                                                                                                                                     |
| `insufficient_data_metrics` | string[]           | Métricas com menos de `min_points` pontos — não analisadas                                                                                                                          |

**Error Scenarios:**

| Status | Code           | Quando                                                                   |
| ------ | -------------- | ------------------------------------------------------------------------ |
| 400    | `BAD_REQUEST`  | `window_days` fora de 30–365, `significance_threshold` fora de 0.01–0.20 |
| 401    | `UNAUTHORIZED` | —                                                                        |

---

## Atualização em `/intel/recommendations`

Os novos endpoints alimentam novos tipos de recomendação no endpoint de recomendações existente. A lista de `RecommendationType` deve ser expandida:

| Novo tipo                    | Gatilho                                                                       | Prioridade                                   | `context` fields                                                              |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| `low_on_time_delivery`       | `on_time_rate_percent` < 50%                                                  | `high`                                       | `{ on_time_rate_percent, period }`                                            |
| `on_time_delivery_declining` | Tendência `declining` por 2+ períodos consecutivos                            | `medium`                                     | `{ current_rate, prior_rate, periods_declining }`                             |
| `bug_rate_spike`             | Bugs > 25% do work mix **e** `delta_pp` > +10pp                               | `high`                                       | `{ bug_percent, delta_pp, period }`                                           |
| `rework_rate_high`           | `rework_rate_percent` > 15%                                                   | `medium`                                     | `{ rework_rate_percent, cost_usd }`                                           |
| `key_person_dependency`      | Alguma pessoa com `risk_level: high`                                          | `high`                                       | `{ user_id, full_name, concentration_percent, epics_owned_count }`            |
| `deploy_quality_degrading`   | `hotfix_rate_percent` > 15% ou `incident_correlated_percent` > 20%            | `high`                                       | `{ hotfix_rate_percent, rollback_rate_percent, incident_correlated_percent }` |
| `suggest_sla_configuration`  | Nenhum `SlaTemplate` ativo **e** sugestões disponíveis com amostra suficiente | `medium`                                     | `{ task_types_with_data, total_suggestions_available }`                       |
| `silent_metric_degradation`  | Métrica em `degrading_metrics` com `statistically_significant: true`          | `medium` → `high` se `decline_percent` > 40% | `{ metric_name, decline_percent, p_value, window_days }`                      |

---

## Sumário de Permissões — Tabela Completa (existentes + novos)

| Rota                             | Método | Permissão    | Módulo requerido                 |
| -------------------------------- | ------ | ------------ | -------------------------------- |
| `/intel/velocity/forecast`       | GET    | `intel.read` | —                                |
| `/intel/epics/:epic_id/forecast` | GET    | `intel.read` | —                                |
| `/intel/sla/risk`                | GET    | `intel.read` | —                                |
| `/intel/anomalies`               | GET    | `intel.read` | —                                |
| `/intel/recommendations`         | GET    | `intel.read` | —                                |
| `/intel/capacity`                | GET    | `intel.read` | —                                |
| `/intel/roadmap`                 | GET    | `intel.read` | —                                |
| `/intel/dependencies`            | GET    | `intel.read` | —                                |
| `/intel/export`                  | GET    | `intel.read` | —                                |
| `/intel/on-time-delivery`        | GET    | `intel.read` | —                                |
| `/intel/work-mix`                | GET    | `intel.read` | —                                |
| `/intel/rework-rate`             | GET    | `intel.read` | `cogs` (custo em $)              |
| `/intel/estimation-accuracy`     | GET    | `intel.read` | —                                |
| `/intel/key-person-risk`         | GET    | `intel.read` | —                                |
| `/intel/team-health`             | GET    | `intel.read` | `cogs` + `dora` (score completo) |
| `/intel/incident-patterns`       | GET    | `intel.read` | Integração de incidentes ativa   |
| `/intel/deploy-quality`          | GET    | `intel.read` | Integração de incidentes ativa   |
| `/intel/sla-suggestions`         | GET    | `intel.read` | —                                |
| `/intel/trend-degradation`       | GET    | `intel.read` | —                                |

---

## Notas de implementação para o backend

> Esta seção é informativa para o frontend entender limitações de dados. Não são contratos de UI.

- `cycle_time_hours` na `Task` é calculado como `completed_at - started_at`. Tasks sem `started_at` ou `completed_at` são excluídas de cálculos baseados em cycle time (sla-suggestions, estimation-accuracy).
- `CogsEntry.revision` é incrementado pelo módulo COGS quando uma task é re-concluída após re-abertura. Tasks sem entrada COGS correspondente ficam fora do rework-rate se o módulo COGS estiver inativo.
- A correlação de deploy com incidentes usa `IncidentEvent.opened_at` dentro da janela `[deployed_at, deployed_at + incident_window_hours]`. Não é causalidade provada — é sinal de correlação temporal.
- `sla_template_hints` em `/intel/sla-suggestions` é apenas uma estrutura de sugestão. O POST para `/sla/templates` deve ser feito explicitamente pelo gestor — o módulo Intel nunca cria templates automaticamente.
- Os novos tipos de análise (`work_mix`, `on_time_delivery`, `rework`, `estimation_accuracy`) serão adicionados como novos valores de `type` no endpoint existente `GET /intel/export`. A versão atual do export suporta apenas `tasks | epics | velocity | capacity | anomalies`.

---

## Referências

| Documento                                            | Conteúdo                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| [intel-api.md](./intel-api.md)                       | Contratos dos 9 endpoints existentes                            |
| [sla-api.md](./sla-api.md)                           | Contrato de `POST /sla/templates` para uso após sla-suggestions |
| [cogs-api.md](./cogs-api.md)                         | Estrutura de `CogsEntry` e campos de revisão                    |
| [dora-api.md](./dora-api.md)                         | Scorecard DORA e campos de `HealthMetric`                       |
| [integrations-api.md](./integrations-api.md)         | Configuração de integrações de incidentes                       |
| [../openapi/intel-v1.yaml](../openapi/intel-v1.yaml) | OpenAPI spec a ser atualizado após aprovação deste plano        |
