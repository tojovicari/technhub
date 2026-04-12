# SLA API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

The SLA module manages Service Level Agreement templates and tracks compliance per task. A template defines conditions (which tasks it applies to), priority-based time targets, and escalation rules.

> **Architecture note:** The SLA module uses a **template-based compliance** model. Tasks are evaluated against active templates on each sync event using the SLA Engine (worker). The older `SlaInstance` state-machine model was removed — compliance is now computed on-demand via `GET /sla/compliance`. The `/sla/instances` and `/sla/summary` endpoints are kept as compatibility shims but always reflect compliance data.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/sla/templates` | POST | `sla.template.manage` |
| `/sla/templates` | GET | `sla.template.read` |
| `/sla/templates/:id` | GET | `sla.template.read` |
| `/sla/templates/:id` | PATCH | `sla.template.manage` |
| `/sla/templates/:id` | DELETE | `sla.template.manage` |
| `/sla/compliance` | GET | `sla.template.read` |
| `/sla/instances` | GET | `sla.template.read` |
| `/sla/summary` | GET | `sla.template.read` |
| `/sla/summary/by-template` | GET | `sla.template.read` |

---

## Endpoints

---

### POST /sla/templates

Create a new SLA template.

**Permission:** `sla.template.manage`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `name` | string | ✅ | — | Template label |
| `description` | string | ❌ | null | — |
| `condition` | object | ✅ | — | DSL filter — determines which tasks this template matches (see Condition DSL) |
| `rules` | object | ✅ | — | Time targets per priority: `{ "P0": { "target_minutes": 60, "warning_at_percent": 75 }, ... }` |
| `priority` | integer | ✅ | — | Evaluation order across templates (lower = first). Use `5` for max urgency, `10`–`50` for specific rules, `100` for default fallback |
| `applies_to` | string[] | ❌ | `[]` | Pre-filter by canonical type: `"bug"` \| `"feature"` \| `"chore"` \| `"spike"` \| `"tech_debt"`. **Empty array disables the pre-filter** — any task is evaluated by `condition`. Required when condition uses `original_type`. |
| `escalation_rule` | object | ❌ | null | Who to notify at each trigger (see Escalation) |
| `project_ids` | string[] | ❌ | `[]` | Restrict to specific projects; empty = all tenant projects |
| `is_default` | boolean | ❌ | `false` | Final fallback when no more-specific template matches |
| `is_active` | boolean | ❌ | `true` | Inactive templates are skipped during evaluation |

**Condition object** — determines which tasks this template matches:

```json
{
  "operator": "AND",
  "rules": [
    { "field": "task_type", "op": "eq", "value": "bug" },
    { "field": "priority", "op": "in", "value": ["P0", "P1"] }
  ]
}
```

- `operator`: `AND` | `OR`
- Each rule: `{ field, op, value }` where `op` is one of `eq` | `in` | `contains` | `any` | `gte` | `lte`

**`rules` object** — time targets (in minutes) per priority level:

```json
{
  "P0": { "target_minutes": 60,   "warning_at_percent": 75 },
  "P1": { "target_minutes": 240,  "warning_at_percent": 80 },
  "P2": { "target_minutes": 1440, "warning_at_percent": 80 },
  "P3": { "target_minutes": 4320, "warning_at_percent": 80 },
  "P4": { "target_minutes": 10080,"warning_at_percent": 80 }
}
```

- `target_minutes`: Time budget from task creation to completion
- `warning_at_percent`: When to mark an instance as `at_risk` (% of target consumed)

**Escalation Rule:**

```json
{
  "at_risk": {
    "notify": ["#sre-alerts"],
    "create_incident": false
  },
  "breached": {
    "notify": ["#sre-critical", "on-call"],
    "create_incident": true
  }
}
```

**Full Request Example:**

```json
{
  "name": "Bug Crítico de Produção",
  "description": "SLA P0/P1 para bugs com label production. Escalation automática.",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "task_type", "op": "eq",       "value": "bug" },
      { "field": "priority",  "op": "in",       "value": ["P0", "P1"] },
      { "field": "labels",    "op": "contains", "value": "production" }
    ]
  },
  "rules": {
    "P0": { "target_minutes": 60,  "warning_at_percent": 70 },
    "P1": { "target_minutes": 240, "warning_at_percent": 80 }
  },
  "applies_to": ["bug"],
  "priority": 10,
  "project_ids": [],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  }
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "sla-tpl-001",
    "tenant_id": "tenant-7a4b",
    "name": "Bug Crítico de Produção",
    "description": "SLA P0/P1 para bugs com label production. Escalation automática.",
    "condition": {
      "operator": "AND",
      "rules": [
        { "field": "task_type", "op": "eq",       "value": "bug" },
        { "field": "priority",  "op": "in",       "value": ["P0", "P1"] },
        { "field": "labels",    "op": "contains", "value": "production" }
      ]
    },
    "rules": {
      "P0": { "target_minutes": 60,  "warning_at_percent": 70 },
      "P1": { "target_minutes": 240, "warning_at_percent": 80 }
    },
    "applies_to": ["bug"],
    "priority": 10,
    "escalation_rule": {
      "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
      "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true }
    },
    "project_ids": [],
    "is_default": false,
    "is_active": true,
    "created_at": "2026-04-10T12:00:00Z",
    "updated_at": "2026-04-10T12:00:00Z"
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid condition structure, missing required fields |
| 401 | `UNAUTHORIZED` | Invalid token |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /sla/templates

List all SLA templates for the tenant.

**Permission:** `sla.template.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `is_active` | boolean | ❌ | — | Filter: `true` for active only |
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string (UUID) | ❌ | — | Pagination cursor |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [ /* SlaTemplate objects */ ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

---

### GET /sla/templates/:id

Get a single SLA template by ID.

**Permission:** `sla.template.read`

**Response — 200 OK:** Single SlaTemplate object.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Template not found in this tenant |

---

### PATCH /sla/templates/:id

Update an SLA template. Only send fields that changed.

**Permission:** `sla.template.manage`

**Patchable Fields:** All fields from POST are patchable (all optional).

**Request Example:**

```json
{
  "is_active": false,
  "rules": {
    "P0": { "target_minutes": 45, "warning_at_percent": 70 }
  }
}
```

**Response — 200 OK:** Updated SlaTemplate object.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid field values |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Template not found |

---

### DELETE /sla/templates/:id

Soft-deactivate or permanently delete an SLA template.

**Permission:** `sla.template.manage`

**Response — 204 No Content** (empty body)

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Template not found |

---

### GET /sla/compliance

Returns template-by-template compliance data computed from task snapshots. This is the **primary SLA analytics endpoint**.

**Permission:** `sla.template.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `from` | string (ISO 8601) | ❌ | start of current month | Start of evaluation window |
| `to` | string (ISO 8601) | ❌ | now | End of evaluation window |
| `project_id` | string (UUID) | ❌ | — | Restrict to a specific project |

**Response — 200 OK:**

```json
{
  "data": {
    "period": { "from": "2026-04-01T00:00:00.000Z", "to": "2026-04-12T10:00:00.000Z" },
    "templates": [
      {
        "template_id": "sla-tpl-001",
        "template_name": "Critical Bug SLA",
        "summary": {
          "total": 10,
          "running": 3,
          "at_risk": 1,
          "met": 5,
          "breached": 2,
          "compliance_rate": 71.4
        },
        "tasks": [
          {
            "task_id": "task-cc9012",
            "task_title": "Login failure on checkout",
            "priority": "P1",
            "started_at": "2026-04-10T10:00:00Z",
            "target_minutes": 240,
            "elapsed_minutes": 380,
            "status": "breached"
          }
        ]
      }
    ]
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid query params |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /sla/instances

> ⚠️ **Deprecated compatibility shim.** This endpoint always returns an empty list. The `SlaInstance` model was removed — use `GET /sla/compliance` instead.

**Permission:** `sla.template.read`

**Response — 200 OK:** Always `{ "data": { "items": [], "next_cursor": null } }`

---

### GET /sla/summary

> ℹ️ **Compatibility shim** — delegates to `GET /sla/compliance` and aggregates all templates into a single summary. Prefer `/sla/compliance` for new integrations.

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Restrict to a specific project |
| `from` | string (ISO 8601) | ❌ | — | Start of period filter (applied to `started_at`) |
| `to` | string (ISO 8601) | ❌ | — | End of period filter |

**Response — 200 OK:**

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
  },
  "meta": { "request_id": "req_010", "version": "v1", "timestamp": "2026-04-10T17:00:00Z" },
  "error": null
}
```

**Field reference:**

| Field | Formula | Notes |
|---|---|---|
| `compliance_rate` | `met / (met + breached) × 100` | `null` when no closed instances yet |
| `breach_rate` | `breached / (met + breached) × 100` | `null` when no closed instances yet |
| `at_risk_rate` | `at_risk / running × 100` | `0` when no running instances |
| `mean_resolution_minutes` | `avg(actual_minutes)` of `met` instances | `null` when no `met` instances |
| `breach_severity_avg_minutes` | `avg(breach_minutes)` of `breached` instances | `null` when no `breached` instances |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid query params |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /sla/summary/by-template

Returns the same metrics as `/sla/summary` but broken down per template, sorted by `priority` ascending (most specific first). Use for per-SLA-rule tracking panels.

**Permission:** `sla.template.read`

**Query Params:** Same as `GET /sla/summary` (`project_id`, `from`, `to`).

**Response — 200 OK:**

```json
{
  "data": [
    {
      "template": {
        "id": "c443da7a-dab8-4d6c-a98b-9d44a8d35cbd",
        "name": "N3",
        "priority": 10
      },
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
  ],
  "meta": { "request_id": "req_011", "version": "v1", "timestamp": "2026-04-10T17:00:00Z" },
  "error": null
}
```

> Only templates that have **at least one instance** in the requested period appear in the response. Templates with zero instances are omitted.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid query params |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

## Common Types

### SLA Instance Status

| Value | Meaning |
|---|---|
| `running` | SLA is active, deadline not yet reached |
| `at_risk` | Warning threshold crossed — approaching deadline |
| `met` | Task completed before deadline |
| `breached` | Deadline passed without completion |
| `superseded` | Instance replaced by a newer evaluation |

> `breach_minutes` is populated (positive integer) only when `status = "breached"`.  
> `actual_minutes` is populated when `status = "met"`.

### Condition Operators

| Op | Meaning |
|---|---|
| `eq` | Exact match |
| `in` | Value is in array |
| `contains` | String contains |
| `any` | Array has any matching element |
| `gte` | Greater than or equal |
| `lte` | Less than or equal |

### Matchable Fields in Conditions

| Field | Type | Notes |
|---|---|---|
| `task_type` | string \| null | `"bug"` \| `"feature"` \| `"chore"` \| `"spike"` \| `"tech_debt"`. Can be `null` if no type mapping is configured for the provider's raw type. |
| `original_type` | string | Raw type from the provider — e.g. `"Incident"`, `"Security Finding"`, `"Customer Request"`. Always present; never normalized. Use this to target provider types that have no canonical equivalent, without depending on a type mapping. |
| `priority` | string | `"P0"` \| `"P1"` \| `"P2"` \| `"P3"` \| `"P4"` |
| `labels` | string[] | Jira labels or GitHub issue labels |
| `component` | string | Jira component or team label |
| `source` | string | `"jira"` \| `"github"` |
| `project_id` | string | Canonical project ID in CTO.ai |
| `sprint_name` | string | Jira sprint name — use `contains` op |
| `story_points` | number | Use `gte` / `lte` for range matching |

> **`task_type` vs `original_type`:** `task_type` is the normalized value (may be null if not mapped); `original_type` is always the raw string from the provider. Use `original_type` when the provider has types like `"Incident"` that don't map cleanly to canonical types, or when you want the SLA to fire regardless of whether a mapping is configured.

---

## How the Engine Evaluates Templates

Templates are evaluated in ascending `priority` order. **The first match wins** — no stacking.

```
For each task sync event:
  1. Load all active templates ordered by priority ASC
  2. For each template:
     a. If applies_to is non-empty AND task_type not in applies_to → skip
     b. Evaluate the condition DSL against the task's fields
     c. First match → create/update SLA instance, stop
  3. If no match AND a template has is_default=true → apply that template
  4. If no match and no default → task gets no SLA instance
```

**Key behaviors:**
- `applies_to: []` disables the type pre-filter — the `condition` is the sole gate. Required when targeting `original_type` values (since `original_type` is not a canonical type).
- `is_default: true` acts as the catch-all fallback. It should have a high `priority` number (e.g. `100`) and `condition.rules: []` (always-true condition).
- If a task's attributes change and a different template now matches, the old instance is marked `superseded` and a new one is created.

---

## Template Configuration Scenarios

These scenarios cover the real-world configurations discussed during design. Each starts from the API call that creates the template and shows what happens downstream. Use this as a reference when building the template creation form and the dashboards.

---

### Scenario 1 — Critical Production Bug (P0/P1)

**Goal:** Fast SLA for P0/P1 bugs labeled `production`. Auto-escalation to manager if breached.

**`POST /api/v1/sla/templates`**

```json
{
  "name": "Bug Crítico de Produção",
  "description": "SLA para bugs P0/P1 com label production. Escalation automática.",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "task_type", "op": "eq",       "value": "bug" },
      { "field": "priority",  "op": "in",       "value": ["P0", "P1"] },
      { "field": "labels",    "op": "contains", "value": "production" }
    ]
  },
  "rules": {
    "P0": { "target_minutes": 60,  "warning_at_percent": 70 },
    "P1": { "target_minutes": 240, "warning_at_percent": 80 }
  },
  "applies_to": ["bug"],
  "priority": 10,
  "project_ids": [],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  }
}
```

**Instance lifecycle (P1 bug — 240 min target):**

| Time | Event | Instance status |
|---|---|---|
| 09:00 | Task goes `in_progress` | `running` |
| 12:12 | 80% threshold reached (192 min) | `at_risk` — alert to assignee + team lead |
| 13:00 | Deadline with no resolution | `breached` — escalation + incident created |
| 13:47 | Task goes `done` | `breached` — `actual_minutes: 287`, `breach_minutes: 47` |

**Cross-module impact:**
- **DORA:** P0 breaches feed into MTTR calculations per project.
- **COGS:** `GET /api/v1/cogs/entries?task_id=<id>` to correlate breach window with cost.

---

### Scenario 2 — Feature with Sprint SLA (2 weeks)

**Goal:** Features at P2/P3 must complete within one sprint. No incident on breach — visibility only.

**`POST /api/v1/sla/templates`**

```json
{
  "name": "Feature — SLA de Sprint",
  "description": "Features devem ser concluídas dentro do sprint.",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "task_type", "op": "eq", "value": "feature" },
      { "field": "priority",  "op": "in", "value": ["P2", "P3"] }
    ]
  },
  "rules": {
    "P2": { "target_minutes": 14400, "warning_at_percent": 75 },
    "P3": { "target_minutes": 20160, "warning_at_percent": 70 }
  },
  "applies_to": ["feature"],
  "priority": 50,
  "project_ids": [],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee"],             "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead"], "create_incident": false }
  }
}
```

> `14400 min` = 10 business days. `20160 min` = 14 calendar days.

**Frontend queries for the sprint dashboard:**

```
GET /api/v1/sla/instances?status=at_risk   → features approaching deadline
GET /api/v1/sla/instances?status=running   → all in-flight features with SLA
GET /api/v1/sla/instances?task_id=<id>     → detail for a specific task
```

---

### Scenario 3 — Tech Debt Accumulation (30 days)

**Goal:** Critical or security-risk tech debt resolved within 30 days. Uses `OR` condition — any matching rule triggers the SLA.

**`POST /api/v1/sla/templates`**

```json
{
  "name": "Tech Debt Crítico — 30 dias",
  "description": "Tech debts críticos ou com risco de segurança resolvidos em 30 dias.",
  "condition": {
    "operator": "OR",
    "rules": [
      { "field": "labels",   "op": "any", "value": ["critical", "security-risk"] },
      { "field": "priority", "op": "in",  "value": ["P1", "P2"] }
    ]
  },
  "rules": {
    "P1": { "target_minutes": 20160, "warning_at_percent": 70 },
    "P2": { "target_minutes": 43200, "warning_at_percent": 70 },
    "P3": { "target_minutes": 43200, "warning_at_percent": 60 }
  },
  "applies_to": ["tech_debt"],
  "priority": 30,
  "project_ids": [],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["team_lead"],            "create_incident": false },
    "breached": { "notify": ["team_lead", "manager"], "create_incident": false }
  }
}
```

> `43200 min` = 30 calendar days. With `OR`, any single matching rule fires the SLA.

---

### Scenario 4 — Critical Component Scope (Payments / Checkout)

**Goal:** Any task in `payments` or `checkout` gets a tighter SLA. Scoped to two specific projects — the template ignores the same component in other projects.

**`POST /api/v1/sla/templates`**

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
  "rules": {
    "P0": { "target_minutes": 60,   "warning_at_percent": 75 },
    "P1": { "target_minutes": 180,  "warning_at_percent": 80 },
    "P2": { "target_minutes": 1440, "warning_at_percent": 75 },
    "P3": { "target_minutes": 4320, "warning_at_percent": 70 }
  },
  "applies_to": ["bug", "feature", "chore", "tech_debt"],
  "priority": 20,
  "project_ids": ["proj-payments-001", "proj-checkout-002"],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  }
}
```

**Template evaluation order for this tenant:**

```
priority  5  →  Incidents & Security (original_type)   ← highest urgency
priority 10  →  Bug Crítico de Produção                ← most specific
priority 20  →  Componentes Críticos (this template)
priority 30  →  Tech Debt Crítico
priority 50  →  Feature — SLA de Sprint
priority 100 →  SLA Padrão (is_default = true)         ← fallback
```

> A `bug P1 labels=production component=payments` task matches at priority 10 (Critical Bug) and never reaches this template.

---

### Scenario 5 — Default Fallback SLA

**Goal:** Every task that doesn't match a more-specific template still gets a monitored deadline. Prevents tasks from existing outside any SLA.

**`POST /api/v1/sla/templates`**

```json
{
  "name": "SLA Padrão",
  "description": "Fallback aplicado a tasks que não ativam nenhum outro template.",
  "condition": {
    "operator": "AND",
    "rules": []
  },
  "rules": {
    "P0": { "target_minutes": 120,   "warning_at_percent": 80 },
    "P1": { "target_minutes": 480,   "warning_at_percent": 80 },
    "P2": { "target_minutes": 2880,  "warning_at_percent": 75 },
    "P3": { "target_minutes": 10080, "warning_at_percent": 70 },
    "P4": { "target_minutes": 43200, "warning_at_percent": 0  }
  },
  "applies_to": ["bug", "feature", "chore", "spike", "tech_debt"],
  "priority": 100,
  "project_ids": [],
  "is_default": true,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee"],             "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead"], "create_incident": false }
  }
}
```

> `is_default: true` is the real fallback mechanism — the engine applies this when no higher-priority template matched. `condition.rules: []` means the condition always passes on its own.

---

### Scenario 6 — SLA by Provider Original Type (Incidents & Security Findings)

**Goal:** Urgent SLA for Jira types like `Incident` and `Security Finding` that don't have a direct canonical equivalent. Uses `original_type` in the condition — works even if no type mapping is configured.

**Step 1 — Discover what types exist across all connections for this tenant:**

`GET /api/v1/integrations/original-types`

```json
{
  "data": {
    "original_types": ["Bug", "Epic", "Incident", "Major Incident", "Security Finding", "Task"]
  }
}
```

> One request, no connection_id needed. Returns the union of all types ingested across all provider connections. This matches the scope of the SLA template (tenant-wide), so the dropdown is correct by construction.

**Step 2 — Create the template:**

`POST /api/v1/sla/templates`

```json
{
  "name": "Incidents e Security Findings — SLA Urgente",
  "description": "SLA para tipos de incidente e segurança do Jira. Não depende de type mapping.",
  "condition": {
    "operator": "AND",
    "rules": [
      {
        "field": "original_type",
        "op":    "in",
        "value": ["Incident", "Major Incident", "Security Finding"]
      },
      { "field": "priority", "op": "in", "value": ["P0", "P1"] }
    ]
  },
  "rules": {
    "P0": { "target_minutes": 30,  "warning_at_percent": 70 },
    "P1": { "target_minutes": 120, "warning_at_percent": 80 }
  },
  "applies_to": [],
  "priority": 5,
  "project_ids": [],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk":  { "notify": ["assignee", "team_lead"],            "create_incident": false },
    "breached": { "notify": ["assignee", "team_lead", "manager"], "create_incident": true  }
  }
}
```

> `applies_to: []` — pre-filter disabled; any task is evaluated by the condition.  
> `priority: 5` — evaluated before all other templates.

**SLA evaluate event (sent automatically by the integration worker):**

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

> `task_type: "bug"` comes from the tenant's type mapping (`"Incident" → bug`).  
> `original_type: "Incident"` is the raw Jira type — this is what the condition evaluates.

**`task_type` vs `original_type` matrix:**

| Scenario | `task_type` | `original_type` | SLA activated? |
|---|---|---|---|
| Type mapping `"Incident" → "bug"` configured | `"bug"` | `"Incident"` | ✅ — DORA/COGS also work correctly |
| No mapping configured for `"Incident"` | `null` | `"Incident"` | ✅ — `original_type` condition still matches |
| Native Jira `"Bug"` type | `"bug"` | `"Bug"` | ✅ — both fields work independently |
