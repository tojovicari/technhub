# SLA API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

The SLA module manages Service Level Agreement templates and tracks compliance per task. A template defines conditions (which tasks it applies to), priority-based time targets, and escalation rules. When a task matches a template, an **SLA instance** is created and tracked automatically.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/sla/templates` | POST | `sla.template.manage` |
| `/sla/templates` | GET | `sla.template.read` |
| `/sla/templates/:id` | GET | `sla.template.read` |
| `/sla/templates/:id` | PATCH | `sla.template.manage` |
| `/sla/templates/:id` | DELETE | `sla.template.manage` |
| `/sla/evaluate` | POST | `sla.evaluate` |
| `/sla/instances` | GET | `sla.template.read` |

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
| `condition` | object | ✅ | — | Filter that determines which tasks this SLA applies to (see Condition) |
| `priority` | object | ✅ | — | Time targets per task priority level (see Priority Rules) |
| `applies_to` | string[] | ❌ | `[]` | `"task"` \| `"bug"` — entity types in scope |
| `rules` | SlaRule[] | ❌ | `[]` | Additional matching rules |
| `escalation_rule` | object | ❌ | null | Notifications and incidents on breach (see Escalation) |
| `project_ids` | string[] | ❌ | `[]` | Restrict to specific projects; empty means all projects |
| `is_default` | boolean | ❌ | `false` | Applied when no other template matches |
| `is_active` | boolean | ❌ | `true` | Active templates are evaluated on new tasks |

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

**Priority Rules** — time targets (in minutes) per priority level:

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
  "name": "Critical Bug SLA",
  "description": "Applies to P0/P1 bugs across all projects",
  "condition": {
    "operator": "AND",
    "rules": [
      { "field": "task_type", "op": "eq", "value": "bug" },
      { "field": "priority", "op": "in", "value": ["P0", "P1"] }
    ]
  },
  "priority": {
    "P0": { "target_minutes": 60,  "warning_at_percent": 75 },
    "P1": { "target_minutes": 240, "warning_at_percent": 80 }
  },
  "applies_to": ["task"],
  "project_ids": [],
  "is_default": false,
  "is_active": true,
  "escalation_rule": {
    "at_risk": { "notify": ["#sre-alerts"], "create_incident": false },
    "breached": { "notify": ["#sre-critical"], "create_incident": true }
  }
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "sla-tpl-001",
    "tenant_id": "tenant-7a4b",
    "name": "Critical Bug SLA",
    "description": "Applies to P0/P1 bugs across all projects",
    "condition": {
      "operator": "AND",
      "rules": [
        { "field": "task_type", "op": "eq", "value": "bug" },
        { "field": "priority", "op": "in", "value": ["P0", "P1"] }
      ]
    },
    "priority": {
      "P0": { "target_minutes": 60,  "warning_at_percent": 75 },
      "P1": { "target_minutes": 240, "warning_at_percent": 80 }
    },
    "applies_to": ["task"],
    "rules": [],
    "escalation_rule": {
      "at_risk":  { "notify": ["#sre-alerts"], "create_incident": false },
      "breached": { "notify": ["#sre-critical"], "create_incident": true }
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
  "priority": {
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

### POST /sla/evaluate

Evaluate which SLA template(s) apply to a given task and create/update SLA instances.

**Permission:** `sla.evaluate`

**Use case:** Call this after creating or updating a task, especially on priority or status change, to ensure SLA tracking is current.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string (UUID) | ✅ | Task to evaluate |

**Request Example:**

```json
{ "task_id": "task-cc9012" }
```

**Response — 200 OK:**

```json
{
  "data": {
    "task_id": "task-cc9012",
    "matched_templates": ["sla-tpl-001"],
    "created_instances": ["sla-inst-aaa111"],
    "superseded_instances": []
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> If the task already had running instances and a different template now matches, old instances are marked `superseded`.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing or invalid `task_id` |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /sla/instances

List SLA instances for the tenant. Use to build compliance dashboards and breach reports.

**Permission:** `sla.template.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `task_id` | string (UUID) | ❌ | — | Filter to instances for a specific task |
| `status` | string | ❌ | — | `running` \| `met` \| `at_risk` \| `breached` \| `superseded` |
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string (UUID) | ❌ | — | Pagination cursor |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "sla-inst-aaa111",
        "task_id": "task-cc9012",
        "sla_template_id": "sla-tpl-001",
        "tenant_id": "tenant-7a4b",
        "target_minutes": 240,
        "started_at": "2026-04-10T10:00:00Z",
        "deadline_at": "2026-04-10T14:00:00Z",
        "completed_at": null,
        "status": "at_risk",
        "actual_minutes": null,
        "breach_minutes": null,
        "created_at": "2026-04-10T10:00:00Z",
        "updated_at": "2026-04-10T13:20:00Z",
        "template": {
          "id": "sla-tpl-001",
          "name": "Critical Bug SLA"
        }
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T14:00:00Z" },
  "error": null
}
```

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

| Field | Type | Example value |
|---|---|---|
| `task_type` | string | `"bug"` |
| `priority` | string | `"P0"` |
| `project_id` | UUID string | `"proj-aa1234"` |
| `tags` | string array | `["security"]` |
| `assignee_id` | UUID string | `"user-88bc"` |
