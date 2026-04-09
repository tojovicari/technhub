# COGS API — Frontend Reference

**Base URL:** `/api/v1`
**Version:** v1
**Auth:** Todos os endpoints exigem `Authorization: Bearer <JWT>`

> **Atenção de acesso:** Endpoints COGS expõem dados financeiros. Apenas usuários com permissões `cogs.read` / `cogs.write` / `cogs.budget.manage` devem ter acesso — tipicamente CTOs, Finance partners e managers sênior.

---

## Visão Geral

O módulo COGS (Cost of Goods Sold) registra o custo de engenharia de tasks, epics, projetos e times. Os custos podem ser:

- **Inseridos manualmente** — taxa horária × horas trabalhadas × fator de overhead
- **Estimados por story points** — baseado na velocidade histórica do time (horas/SP)
- **Futuramente sincronizados** — de integrações de time-tracking (Harvest, Toggl, etc.)

O módulo também suporta **orçamentos por período** (mensal ou trimestral) e o cálculo de **burn rate** em tempo real.

---

## Permissões

| Rota | Método | Permissão exigida |
|---|---|---|
| `/cogs/entries` | `POST` | `cogs.write` |
| `/cogs/entries/estimate` | `POST` | `cogs.write` |
| `/cogs/entries` | `GET` | `cogs.read` |
| `/cogs/rollup` | `GET` | `cogs.read` |
| `/cogs/epics/:epic_id` | `GET` | `cogs.read` |
| `/cogs/budgets` | `POST` | `cogs.budget.manage` |
| `/cogs/budgets` | `GET` | `cogs.read` |
| `/cogs/burn-rate` | `GET` | `cogs.read` |

---

## Envelope de resposta

Todas as respostas seguem o envelope padrão:

```json
{
  "data": { ... },
  "meta": {
    "request_id": "req-1p",
    "version": "v1",
    "timestamp": "2026-04-09T23:02:57.365Z"
  },
  "error": null
}
```

Em caso de erro, `data` é `null` e `error` é preenchido:

```json
{
  "data": null,
  "meta": { ... },
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid body",
    "details": { "issues": [ ... ] }
  }
}
```

---

## Campos de resposta — nota de casing

Os campos retornados pelo servidor estão em **camelCase** (gerados diretamente pelo Prisma ORM). Exemplos: `tenantId`, `periodDate`, `totalCost`, `hoursWorked`, `hourlyRate`.

> Recomendação ao frontend: normalizar para snake_case no adapter de dados, ou usar os campos como retornados.

---

## Endpoints

---

### POST /cogs/entries

Cria um registro de custo para um user, task, epic ou projeto.

**Permissão:** `cogs.write`

**Caso de uso:** registrar horas trabalhadas de um developer em um projeto; registrar custo fixo de tooling (ex.: licença GitHub Enterprise, minutos de CI).

#### Cálculo de custo

O servidor calcula automaticamente:

```
totalCost = hours_worked × hourly_rate × overhead_rate
```

O `overhead_rate` é um multiplicador (ex.: `1.3` = 30% de overhead sobre o custo direto). Para custos fixos (tooling, cloud), passe `hours_worked: 1`, `hourly_rate: <valor>`, `overhead_rate: 1.0`.

#### Request Body

| Campo | Tipo | Obrigatório | Padrão | Observação |
|---|---|---|---|---|
| `period_date` | string (`YYYY-MM-DD`) | ✅ | — | Data de competência do custo |
| `category` | enum | ✅ | — | Ver [CogsCategory](#cogscategory) |
| `source` | enum | ✅ | — | Ver [CogsSource](#cogssource) |
| `hours_worked` | number ≥ 0 | ✅ | `0` | Horas trabalhadas no período |
| `hourly_rate` | number ≥ 0 | ✅ | `0` | Taxa horária em moeda base (USD) |
| `overhead_rate` | number 0–10 | ✅ | `1.0` | Multiplicador de overhead (ex.: `1.3` = +30%) |
| `confidence` | enum | ❌ | `"medium"` | Ver [Confidence](#confidence) |
| `user_id` | string (UUID) | ❌ | `null` | User que incorreu no custo |
| `team_id` | string (UUID) | ❌ | `null` | Time associado |
| `project_id` | string (UUID) | ❌ | `null` | Projeto associado |
| `epic_id` | string (UUID) | ❌ | `null` | Epic associado |
| `task_id` | string (UUID) | ❌ | `null` | Task associada |
| `subcategory` | string (max 100) | ❌ | `null` | Ex.: `"github"`, `"aws-ec2"` |
| `notes` | string (max 1000) | ❌ | `null` | Texto livre de anotação |
| `approved_by` | string (UUID) | ❌ | `null` | UUID do approver |
| `metadata` | object | ❌ | `null` | Campos arbitrários para rastreabilidade |

#### Request Example — custo de engenharia (horas reais)

```json
{
  "period_date": "2026-04-01",
  "user_id": "cfb704a9-c953-4cca-9fd0-9cb9e7ad8c7c",
  "project_id": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
  "hours_worked": 8,
  "hourly_rate": 75,
  "overhead_rate": 1.3,
  "category": "engineering",
  "source": "manual",
  "confidence": "high",
  "notes": "Sprint work April week 1"
}
```

#### Request Example — custo fixo de tooling

```json
{
  "period_date": "2026-04-01",
  "project_id": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
  "hours_worked": 0,
  "hourly_rate": 0,
  "overhead_rate": 1.0,
  "category": "tooling",
  "subcategory": "github",
  "source": "manual",
  "confidence": "high",
  "notes": "GitHub Actions CI minutes",
  "metadata": { "minutes": 450 }
}
```

#### Response — 201 Created

```json
{
  "data": {
    "id": "445094ff-5ac9-454b-a800-39cf9eeceec3",
    "tenantId": "ten_1",
    "periodDate": "2026-04-01T00:00:00.000Z",
    "userId": "cfb704a9-c953-4cca-9fd0-9cb9e7ad8c7c",
    "teamId": null,
    "projectId": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
    "epicId": null,
    "taskId": null,
    "hoursWorked": 8,
    "hourlyRate": 75,
    "overheadRate": 1.3,
    "totalCost": 780,
    "category": "engineering",
    "subcategory": null,
    "source": "manual",
    "confidence": "high",
    "notes": "Sprint work April week 1",
    "approvedBy": null,
    "metadata": null,
    "createdAt": "2026-04-09T23:02:57.362Z",
    "updatedAt": "2026-04-09T23:02:57.362Z"
  },
  "meta": {
    "request_id": "req-1p",
    "version": "v1",
    "timestamp": "2026-04-09T23:02:57.365Z"
  },
  "error": null
}
```

> **`totalCost`**: calculado como `8 × 75 × 1.3 = 780`. Campo read-only — não envie na requisição.

#### Erros

| Status | Code | Quando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Campo obrigatório ausente, enum inválido, `overhead_rate` fora de 0–10 |
| 401 | `UNAUTHORIZED` | Token ausente ou expirado |
| 403 | `FORBIDDEN` | User sem permissão `cogs.write` |

---

### POST /cogs/entries/estimate

Gera uma entry de custo estimado a partir de story points, usando a velocidade histórica do time.

**Permissão:** `cogs.write`

**Caso de uso:** quando não há dados de time-tracking, estimar o custo de um epic ou projeto com base nos story points entregues e na velocidade histórica (horas/SP calculada a partir das tasks concluídas).

#### Como a estimativa funciona

1. O servidor busca tasks concluídas (`status: done`) do projeto/epic com `hoursActual > 0` e `storyPoints > 0` (últimas 30 tasks).
2. Calcula a velocidade média: `velocity = avg(hoursActual / storyPoints)`.
3. Estima as horas: `hoursEstimated = story_points × velocity` (fallback: `story_points × 4h` se não houver histórico).
4. O `hourly_rate` é salvo como `0` na v1 — a entry precisa ser atualizada com a taxa real posteriormente.
5. A `confidence` reflete a qualidade do histórico: `"medium"` se há dados suficientes, `"low"` se usou fallback.

> **Limitação atual (v1):** `totalCost` será `0` porque `hourly_rate` não é buscado automaticamente do perfil do user. O `metadata` retorna `velocity_used` e `history_sample_size` para transparência do cálculo.

#### Request Body

| Campo | Tipo | Obrigatório | Padrão | Observação |
|---|---|---|---|---|
| `story_points` | integer ≥ 1 | ✅ | — | Pontos a estimar |
| `user_id` | string (UUID) | ✅ | — | User de referência para contexto histórico |
| `period_date` | string (`YYYY-MM-DD`) | ✅ | — | Data de competência |
| `project_id` | string (UUID) | ❌ | `null` | Escopo do histórico de velocidade |
| `epic_id` | string (UUID) | ❌ | `null` | Escopo do histórico de velocidade |
| `category` | enum | ❌ | `"engineering"` | Ver [CogsCategory](#cogscategory) |
| `notes` | string (max 500) | ❌ | `null` | — |

#### Request Example

```json
{
  "project_id": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
  "story_points": 5,
  "user_id": "cfb704a9-c953-4cca-9fd0-9cb9e7ad8c7c",
  "period_date": "2026-04-01",
  "category": "engineering",
  "notes": "Estimate Q2 backlog"
}
```

#### Response — 201 Created

```json
{
  "data": {
    "id": "8a4a1695-a2e8-4f78-a3ad-d1995211f8b3",
    "tenantId": "ten_1",
    "periodDate": "2026-04-01T00:00:00.000Z",
    "userId": "cfb704a9-c953-4cca-9fd0-9cb9e7ad8c7c",
    "teamId": null,
    "projectId": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
    "epicId": null,
    "taskId": null,
    "hoursWorked": 20,
    "hourlyRate": 0,
    "overheadRate": 1,
    "totalCost": 0,
    "category": "engineering",
    "subcategory": null,
    "source": "story_points",
    "confidence": "low",
    "notes": "Estimate Q2 backlog",
    "approvedBy": null,
    "metadata": {
      "story_points": 5,
      "velocity_used": null,
      "history_sample_size": 0
    },
    "createdAt": "2026-04-09T23:03:25.380Z",
    "updatedAt": "2026-04-09T23:03:25.380Z"
  },
  "meta": { "request_id": "req-1s", "version": "v1", "timestamp": "2026-04-09T23:03:25.382Z" },
  "error": null
}
```

> - `hoursWorked: 20` = 5 SPs × 4h (fallback; sem histórico no exemplo)
> - `confidence: "low"` porque `history_sample_size: 0`
> - `totalCost: 0` — limitação v1, `hourly_rate` não é resolvido automaticamente
> - `metadata.velocity_used`: `null` = fallback usado; número = horas/SP calculadas

#### Erros

| Status | Code | Quando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `story_points` ausente ou ≤ 0, `user_id` inválido |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Sem `cogs.write` |
| 404 | `NOT_FOUND` | `user_id` não encontrado no tenant |

---

### GET /cogs/entries

Lista entries de custo com filtros.

**Permissão:** `cogs.read`

**Caso de uso:** tela de detalhamento de custos — todas as entries de um projeto ou epic em um período, com paginação.

#### Query Params

| Param | Tipo | Padrão | Observação |
|---|---|---|---|
| `project_id` | string (UUID) | — | Filtrar por projeto |
| `epic_id` | string (UUID) | — | Filtrar por epic |
| `task_id` | string (UUID) | — | Filtrar por task |
| `team_id` | string (UUID) | — | Filtrar por time |
| `user_id` | string (UUID) | — | Filtrar por user |
| `category` | enum | — | Ver [CogsCategory](#cogscategory) |
| `source` | enum | — | Ver [CogsSource](#cogssource) |
| `date_from` | string (`YYYY-MM-DD`) | — | `periodDate ≥` esta data |
| `date_to` | string (`YYYY-MM-DD`) | — | `periodDate ≤` esta data |
| `limit` | integer 1–100 | `20` | Itens por página |
| `cursor` | string | — | Cursor de paginação (valor de `next_cursor` da resposta anterior) |

#### Response — 200 OK

```json
{
  "data": {
    "data": [
      {
        "id": "445094ff-5ac9-454b-a800-39cf9eeceec3",
        "tenantId": "ten_1",
        "periodDate": "2026-04-01T00:00:00.000Z",
        "userId": "cfb704a9-c953-4cca-9fd0-9cb9e7ad8c7c",
        "teamId": null,
        "projectId": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
        "epicId": null,
        "taskId": null,
        "hoursWorked": 8,
        "hourlyRate": 75,
        "overheadRate": 1.3,
        "totalCost": 780,
        "category": "engineering",
        "subcategory": null,
        "source": "manual",
        "confidence": "high",
        "notes": "Sprint work April week 1",
        "approvedBy": null,
        "metadata": null,
        "createdAt": "2026-04-09T23:02:57.362Z",
        "updatedAt": "2026-04-09T23:02:57.362Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req-33", "version": "v1", "timestamp": "2026-04-09T23:10:57.933Z" },
  "error": null
}
```

> **Paginação cursor-based:** passe `cursor=<next_cursor>` para a próxima página. `next_cursor: null` = última página.
>
> **Nota estrutural:** o array de itens está em `data.data` (duplo `data`). Será normalizado para `data.items` em v2.

---

### GET /cogs/rollup

Agrega custo total por uma dimensão. Use para gráficos de breakdown de custo.

**Permissão:** `cogs.read`

**Caso de uso:** gráfico de pizza de custos por categoria em um projeto; tabela de custo por developer; visão de custo por projeto no mês.

#### Query Params

| Param | Tipo | Obrigatório | Padrão | Observação |
|---|---|---|---|---|
| `group_by` | enum | ❌ | `"category"` | `category` \| `user` \| `project` \| `epic` \| `team` |
| `project_id` | string (UUID) | ❌ | — | Escopa todas as entries ao projeto |
| `epic_id` | string (UUID) | ❌ | — | Escopa ao epic |
| `team_id` | string (UUID) | ❌ | — | Escopa ao time |
| `user_id` | string (UUID) | ❌ | — | Escopa ao user |
| `date_from` | string (`YYYY-MM-DD`) | ❌ | — | `periodDate ≥` |
| `date_to` | string (`YYYY-MM-DD`) | ❌ | — | `periodDate ≤` |

#### Response — 200 OK

```json
{
  "data": {
    "total_cost": 780,
    "total_hours": 28,
    "cost_per_story_point": null,
    "group_by": "category",
    "breakdown": {
      "engineering": 780,
      "tooling": 0
    },
    "entry_count": 3,
    "filters": {
      "project_id": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
      "epic_id": null,
      "team_id": null,
      "user_id": null,
      "date_from": null,
      "date_to": null
    }
  },
  "meta": { "request_id": "req-34", "version": "v1", "timestamp": "2026-04-09T23:10:58.071Z" },
  "error": null
}
```

> **`breakdown`:** objeto `{ [chave]: totalCost }` onde a chave depende do `group_by`:
> - `group_by=category` → chave = nome da categoria (`"engineering"`, `"tooling"`, ...)
> - `group_by=user` → chave = UUID do user (ou `"unassigned"` para entries sem user)
> - `group_by=project` → chave = UUID do projeto (ou `"unassigned"`)
> - `group_by=epic` → chave = UUID do epic (ou `"unassigned"`)
> - `group_by=team` → chave = UUID do time (ou `"unassigned"`)
>
> **`cost_per_story_point`:** calculado apenas quando `project_id` ou `epic_id` é informado e há tasks concluídas com SPs. `null` caso contrário.
>
> **`filters`:** espelha os filtros aplicados na query, útil para auditoria e logging no frontend.

---

### GET /cogs/epics/:epic_id

Análise detalhada de custo de um epic — custo real vs. estimado, ROI, breakdown por categoria.

**Permissão:** `cogs.read`

**Caso de uso:** tela de detalhe do epic para o CTO — quanto custou, quanto foi orçado, ROI se houver valor de negócio definido.

#### Path Params

| Param | Tipo | Observação |
|---|---|---|
| `epic_id` | string (UUID) | ID do epic no sistema |

#### Response — 200 OK (sem entries ainda)

```json
{
  "data": {
    "epic_id": "6087b5cd-12e9-4d88-b4ae-8754d797488c",
    "epic_name": "Core API MVP",
    "epic_status": "active",
    "actual_cost": 0,
    "estimated_cost": null,
    "business_value": null,
    "roi_percent": null,
    "planned_vs_actual": null,
    "cost_by_category": {},
    "total_hours": 0
  },
  "meta": { "request_id": "req-4l", "version": "v1", "timestamp": "2026-04-09T23:12:24.229Z" },
  "error": null
}
```

#### Response — 200 OK (com dados completos)

```json
{
  "data": {
    "epic_id": "6087b5cd-12e9-4d88-b4ae-8754d797488c",
    "epic_name": "Observability Stack Migration",
    "epic_status": "completed",
    "actual_cost": 28800,
    "estimated_cost": 30000,
    "business_value": 150000,
    "roi_percent": 421.0,
    "planned_vs_actual": {
      "estimated": 30000,
      "actual": 28800,
      "diff": -1200,
      "diff_percent": -4.0
    },
    "cost_by_category": {
      "engineering": 24000,
      "tooling": 4800
    },
    "total_hours": 320
  }
}
```

> **`estimated_cost` e `business_value`:** populados a partir de entries com `source: "estimate"` vinculadas ao epic via `metadata`. Se não houver nenhuma entry de estimativa, ambos são `null` e `planned_vs_actual` é `null`.
>
> **`roi_percent`:** `((business_value - actual_cost) / actual_cost) × 100`. `null` se `business_value` não definido.
>
> **`diff_percent` negativo** = abaixo do orçamento (bom sinal).
>
> **`cost_by_category`:** objeto `{ [categoria]: totalCost }`. `{}` se sem entries.

#### Erros

| Status | Code | Quando |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Epic não existe neste tenant |

---

### POST /cogs/budgets

Cria ou atualiza um orçamento para um período. Faz **upsert** pela chave `(tenant, project_id, team_id, period)`.

**Permissão:** `cogs.budget.manage`

**Caso de uso:** configurar orçamento mensal ou trimestral de um projeto ou time. Chamar novamente com o mesmo período/projeto atualiza o valor (não duplica).

#### Request Body

| Campo | Tipo | Obrigatório | Padrão | Observação |
|---|---|---|---|---|
| `period` | string | ✅ | — | Formato `YYYY-Qn` (ex.: `2026-Q2`) ou `YYYY-MM` (ex.: `2026-04`) |
| `budget_amount` | number > 0 | ✅ | — | Valor do orçamento em moeda base |
| `currency` | string (3 chars) | ❌ | `"USD"` | ISO 4217 |
| `project_id` | string (UUID) | ❌ | `null` | Escopo ao projeto; `null` = tenant-wide |
| `team_id` | string (UUID) | ❌ | `null` | Escopo ao time |
| `notes` | string (max 500) | ❌ | `null` | — |

#### Request Example

```json
{
  "project_id": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
  "period": "2026-04",
  "budget_amount": 5000,
  "currency": "USD",
  "notes": "Q2 April budget"
}
```

#### Response — 201 Created

```json
{
  "data": {
    "id": "f844f62d-6d10-47df-bdb7-31baf457b08a",
    "tenantId": "ten_1",
    "projectId": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
    "teamId": null,
    "period": "2026-04",
    "budgetAmount": 5000,
    "currency": "USD",
    "notes": "Q2 April budget",
    "createdAt": "2026-04-09T23:11:29.502Z",
    "updatedAt": "2026-04-09T23:11:29.502Z"
  },
  "meta": { "request_id": "req-3k", "version": "v1", "timestamp": "2026-04-09T23:11:29.506Z" },
  "error": null
}
```

> **Upsert:** se já existir um budget para o mesmo `(project_id, team_id, period)`, o `budgetAmount`, `currency` e `notes` são atualizados. O `id` e `createdAt` permanecem os mesmos.

#### Erros

| Status | Code | Quando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `period` com formato inválido, `budget_amount` ≤ 0 |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Sem `cogs.budget.manage` |

---

### GET /cogs/budgets

Lista os orçamentos do tenant com filtros opcionais.

**Permissão:** `cogs.read`

#### Query Params

| Param | Tipo | Observação |
|---|---|---|
| `project_id` | string (UUID) | Filtrar por projeto |
| `team_id` | string (UUID) | Filtrar por time |
| `period` | string | Filtrar por período exato (ex.: `2026-04`) |

#### Response — 200 OK

```json
{
  "data": {
    "data": [
      {
        "id": "f844f62d-6d10-47df-bdb7-31baf457b08a",
        "tenantId": "ten_1",
        "projectId": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
        "teamId": null,
        "period": "2026-04",
        "budgetAmount": 5000,
        "currency": "USD",
        "notes": "Q2 April budget",
        "createdAt": "2026-04-09T23:11:29.502Z",
        "updatedAt": "2026-04-09T23:11:29.502Z"
      }
    ]
  },
  "meta": { "request_id": "req-3l", "version": "v1", "timestamp": "2026-04-09T23:11:29.637Z" },
  "error": null
}
```

> Ordenado por `period` decrescente. Sem paginação cursor — retorna todos os budgets do escopo filtrado.
>
> **Nota estrutural:** itens em `data.data` (igual ao `/entries`). Será `data.items` em v2.

---

### GET /cogs/burn-rate

Calcula o gasto atual vs. orçamento para um período.

**Permissão:** `cogs.read`

**Caso de uso:** widget de saúde financeira — mostrar percentual de budget consumido, quanto resta, e se o projeto está dentro do orçamento.

#### Query Params

| Param | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `period` | string | ✅ | `YYYY-Qn` ou `YYYY-MM` — ex.: `2026-04`, `2026-Q2` |
| `project_id` | string (UUID) | ❌ | Escopa ao projeto |
| `team_id` | string (UUID) | ❌ | Escopa ao time |

#### Response — 200 OK

```json
{
  "data": {
    "period": "2026-04",
    "period_start": "2026-04-01",
    "period_end": "2026-04-30",
    "project_id": "fe4a4ed2-edc3-4155-a436-c92f6cf44d0b",
    "team_id": null,
    "actualCost": 780,
    "budgetAmount": 5000,
    "burnPercent": 15.6,
    "remaining": 4220,
    "status": "on_track",
    "budget_configured": true
  },
  "meta": { "request_id": "req-3m", "version": "v1", "timestamp": "2026-04-09T23:11:29.781Z" },
  "error": null
}
```

> **Campos calculados:**
> - `burnPercent`: `(actualCost / budgetAmount) × 100`; pode ultrapassar 100 se over budget
> - `remaining`: `budgetAmount - actualCost`; negativo se over budget
> - `status`: ver [BurnStatus](#burnstatus)
> - `budget_configured`: `true` se há pelo menos um budget configurado para o período/escopo
>
> **Se não houver budget configurado:** `budgetAmount: 0`, `budget_configured: false`, `burnPercent: 0`, `status: "on_track"`.
>
> **Nota de casing:** `actualCost`, `budgetAmount`, `burnPercent`, `remaining` estão em camelCase (retornados diretamente do motor de cálculo). Será normalizado para snake_case em v2.

#### Erros

| Status | Code | Quando |
|---|---|---|
| 400 | `BAD_REQUEST` | `period` com formato inválido (ex.: `2026/04`, `abril`) |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Sem `cogs.read` |

---

## Tipos Comuns

### CogsCategory

| Valor | Uso |
|---|---|
| `engineering` | Tempo e labor de desenvolvimento |
| `overhead` | Gestão, meetings, coordenação |
| `tooling` | Licenças, subscriptions de software |
| `cloud` | Infraestrutura, compute, storage |
| `administrative` | RH, compliance, overhead administrativo |
| `other` | Não categorizado |

### CogsSource

| Valor | Significado |
|---|---|
| `timetracking` | Vindo de integração de time-tracking |
| `story_points` | Estimado via velocidade (endpoint `/estimate`) |
| `estimate` | Estimativa manual registrada como plano de custo |
| `manual` | Entrada direta pelo usuário |

### Confidence

Indica a qualidade/confiabilidade do dado de custo.

| Valor | Significado |
|---|---|
| `high` | Dado rastreado com precisão (horas reais aprovadas) |
| `medium` | Parcialmente estimado (velocidade com histórico suficiente) |
| `low` | Estimativa grosseira (sem histórico, fallback 4h/SP) |

### BurnStatus

| Valor | Critério |
|---|---|
| `on_track` | `burnPercent ≤ 90%` — dentro do esperado |
| `at_risk` | Projetado a exceder levemente, ou já acima de 90% do orçamento |
| `over_budget` | `actualCost > budgetAmount` — orçamento estourado |

### Formato de Período

| Formato | Exemplo | Resolução no servidor |
|---|---|---|
| `YYYY-Qn` | `2026-Q2` | 1º de abril a 30 de junho de 2026 |
| `YYYY-MM` | `2026-04` | 1º a 30 de abril de 2026 |

---

## Fluxos de uso recomendados

### Dashboard de custo de projeto

```
1. GET /cogs/rollup?project_id=<id>&group_by=category    → breakdown por categoria (pie chart)
2. GET /cogs/rollup?project_id=<id>&group_by=user        → custo por developer (tabela/bar chart)
3. GET /cogs/burn-rate?project_id=<id>&period=2026-04    → widget de saúde financeira
4. GET /cogs/entries?project_id=<id>&limit=20            → tabela detalhada de entries
```

### Detalhe de Epic (visão CTO)

```
1. GET /cogs/epics/:epic_id                              → custo real vs. estimado, ROI
2. GET /cogs/rollup?epic_id=<id>&group_by=category       → breakdown de categorias do epic
```

### Configurar orçamento e monitorar

```
1. POST /cogs/budgets                                    → definir budget do período/projeto
2. GET  /cogs/burn-rate?period=2026-04&project_id=<id>  → monitorar consumo em tempo real
```

### Registrar custo de um sprint

```
1. POST /cogs/entries  (uma por developer, com horas reais)
2. POST /cogs/entries  (tooling: GitHub Actions, Datadog, etc.)
3. GET  /cogs/rollup?project_id=<id>&date_from=2026-04-01&date_to=2026-04-07  → resumo do sprint
```

---

## Inconsistências conhecidas (v1) a corrigir em v2

| Problema | Impacto | Plano |
|---|---|---|
| Campos em camelCase nas respostas | Frontend precisa adaptar | Normalizar para snake_case em v2 |
| `data.data` nas listagens | Código mais verboso | Mover para `data.items` em v2 |
| `hourly_rate: 0` no `/estimate` | `totalCost: 0` sempre | Resolver rate do user no servidor em v2 |
| Sin paginação no `/budgets` | Pode crescer sem controle | Adicionar cursor em v2 |
