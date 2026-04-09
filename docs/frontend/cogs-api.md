# COGS API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

> **Role note:** COGS endpoints expose financial data. Only users with `cogs.read` or `cogs.write` permissions should have access — typically restricted to CTOs, Finance partners, and senior managers.

---

## Overview

COGS (Cost of Goods Sold) tracks the engineering cost of tasks, epics, projects, and teams. Costs can be:
- **Manually entered** (hourly rates × actual hours)
- **Estimated from story points** (velocity × team rate)
- **Synced from time-tracking tools**

The module supports budgets (per period) and burn-rate dashboards.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/cogs/entries` | POST | `cogs.write` |
| `/cogs/entries/estimate` | POST | `cogs.write` |
| `/cogs/entries` | GET | `cogs.read` |
| `/cogs/rollup` | GET | `cogs.read` |
| `/cogs/epics/:epic_id` | GET | `cogs.read` |
| `/cogs/budgets` | POST | `cogs.budget.manage` |
| `/cogs/budgets` | GET | `cogs.read` |
| `/cogs/burn-rate` | GET | `cogs.read` |

---

## Endpoints

---

### POST /cogs/entries

Create a cost entry for a task, epic, user, or team.

**Permission:** `cogs.write`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Must match JWT `tenant_id` |
| `category` | enum | ✅ | — | See Category enum below |
| `source` | enum | ❌ | `manual` | See Source enum below |
| `task_id` | string (UUID) | ❌ | null | Link to a task |
| `epic_id` | string (UUID) | ❌ | null | Link to an epic |
| `project_id` | string (UUID) | ❌ | null | Link to a project |
| `team_id` | string (UUID) | ❌ | null | Link to a team |
| `user_id` | string (UUID) | ❌ | null | The user who incurred the cost |
| `hours` | number | ❌ | null | Hours worked |
| `hourly_rate` | number | ❌ | null | Rate in base currency |
| `amount` | number | ❌ | null | Fixed cost (use instead of hours × rate) |
| `currency` | string | ❌ | `USD` | ISO 4217 currency code |
| `recorded_at` | ISO datetime | ❌ | now | Date of the cost event |
| `notes` | string | ❌ | null | Free-text annotation |
| `confidence` | enum | ❌ | `high` | `high` \| `medium` \| `low` |
| `metadata` | object | ❌ | null | Arbitrary key-value pairs |

> `total_cost` is computed by the server as `hours × hourly_rate` (if both provided) or `amount`. You don't send it.

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "task_id": "task-cc9012",
  "epic_id": "epic-bb5678",
  "project_id": "proj-aa1234",
  "user_id": "user-88bc",
  "category": "engineering",
  "source": "timetracking",
  "hours": 8,
  "hourly_rate": 120,
  "currency": "USD",
  "recorded_at": "2026-04-10T00:00:00Z",
  "confidence": "high",
  "notes": "Backend implementation of OTLP exporter"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "cogs-entry-001",
    "tenant_id": "tenant-7a4b",
    "task_id": "task-cc9012",
    "epic_id": "epic-bb5678",
    "project_id": "proj-aa1234",
    "team_id": null,
    "user_id": "user-88bc",
    "category": "engineering",
    "source": "timetracking",
    "hours": 8,
    "hourly_rate": 120,
    "total_cost": 960,
    "amount": null,
    "currency": "USD",
    "recorded_at": "2026-04-10T00:00:00Z",
    "confidence": "high",
    "notes": "Backend implementation of OTLP exporter",
    "metadata": null,
    "created_at": "2026-04-10T14:00:00Z"
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T14:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `category`, invalid enum, neither hours+rate nor amount provided |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### POST /cogs/entries/estimate

Generate a cost estimate for untracked work based on story points and team velocity.

**Permission:** `cogs.write`

**When to use:** When no time-tracking data exists and you want to estimate cost from story points.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | — |
| `epic_id` | string (UUID) | ❌ | Scope estimate to epic |
| `project_id` | string (UUID) | ❌ | Scope estimate to project |
| `team_id` | string (UUID) | ❌ | Team whose velocity/rate to use |
| `story_points` | integer | ✅ | Points to estimate cost for |
| `hourly_rate` | number | ✅ | Rate to apply |
| `velocity_hours_per_point` | number | ❌ | Override velocity; defaults to team's computed velocity |
| `category` | enum | ❌ | `engineering` | — |
| `confidence` | enum | ❌ | `low` | Estimates default to `low` confidence |
| `notes` | string | ❌ | — | — |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "epic_id": "epic-bb5678",
  "project_id": "proj-aa1234",
  "team_id": "team-c1d2e3",
  "story_points": 34,
  "hourly_rate": 120,
  "confidence": "medium",
  "notes": "Estimate for remaining epic backlog"
}
```

**Response — 201 Created:** Single CogsEntry with `source: "story_points"` and `confidence: "medium"`.

---

### GET /cogs/entries

List cost entries with flexible filtering.

**Permission:** `cogs.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Filter by project |
| `epic_id` | string (UUID) | ❌ | — | Filter by epic |
| `task_id` | string (UUID) | ❌ | — | Filter by task |
| `team_id` | string (UUID) | ❌ | — | Filter by team |
| `user_id` | string (UUID) | ❌ | — | Filter by user |
| `category` | string | ❌ | — | Filter by category |
| `source` | string | ❌ | — | Filter by source |
| `date_from` | ISO datetime | ❌ | — | `recorded_at` ≥ this date |
| `date_to` | ISO datetime | ❌ | — | `recorded_at` ≤ this date |
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string | ❌ | — | Pagination cursor |

**Response — 200 OK:** Paginated list of CogsEntry objects.

---

### GET /cogs/rollup

Aggregate cost totals grouped by a dimension. Use for cost breakdown charts.

**Permission:** `cogs.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `group_by` | enum | ✅ | — | `category` \| `user` \| `project` \| `epic` \| `team` |
| `project_id` | string (UUID) | ❌ | — | Scope to project |
| `team_id` | string (UUID) | ❌ | — | Scope to team |
| `date_from` | ISO datetime | ❌ | — | — |
| `date_to` | ISO datetime | ❌ | — | — |

**Response — 200 OK:**

```json
{
  "data": {
    "group_by": "category",
    "total_cost": 48200,
    "currency": "USD",
    "groups": [
      { "key": "engineering", "label": "Engineering",   "total_cost": 38400, "entry_count": 32 },
      { "key": "tooling",     "label": "Tooling",       "total_cost": 6200,  "entry_count": 8  },
      { "key": "overhead",    "label": "Overhead",      "total_cost": 3600,  "entry_count": 5  }
    ]
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

---

### GET /cogs/epics/:epic_id

Detailed cost analysis for a single epic — planned vs actual, ROI indicators.

**Permission:** `cogs.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `epic_id` | string (UUID) | The epic to analyze |

**Response — 200 OK:**

```json
{
  "data": {
    "epic_id": "epic-bb5678",
    "epic_name": "Observability Stack Migration",
    "total_cost": 28800,
    "currency": "USD",
    "by_category": [
      { "category": "engineering", "total_cost": 24000 },
      { "category": "tooling",     "total_cost": 4800  }
    ],
    "planned_vs_actual": {
      "planned_cost": 30000,
      "actual_cost": 28800,
      "variance": -1200,
      "variance_percent": -4.0
    },
    "completion_percent": 85,
    "projected_total_cost": 33882,
    "cost_per_story_point": 480,
    "confidence": "high"
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> **`projected_total_cost`**: Extrapolated based on current burn rate and remaining work. Treat as an estimate.  
> **`variance_percent`**: Negative = under budget.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Epic not found in this tenant |

---

### POST /cogs/budgets

Create or update a budget for a period. Upserts on `(tenant_id, period, project_id, team_id)`.

**Permission:** `cogs.budget.manage`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | — |
| `period` | string | ✅ | Format: `YYYY-Qn` (e.g. `2026-Q2`) or `YYYY-MM` (e.g. `2026-04`) |
| `amount` | number | ✅ | Budget amount in base currency |
| `currency` | string | ❌ | `USD` |
| `project_id` | string (UUID) | ❌ | Scope to project; null = tenant-wide |
| `team_id` | string (UUID) | ❌ | Scope to team |
| `notes` | string | ❌ | — |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "period": "2026-Q2",
  "amount": 500000,
  "currency": "USD",
  "project_id": "proj-aa1234",
  "notes": "Platform team Q2 engineering budget"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "budget-001",
    "tenant_id": "tenant-7a4b",
    "period": "2026-Q2",
    "amount": 500000,
    "currency": "USD",
    "project_id": "proj-aa1234",
    "team_id": null,
    "notes": "Platform team Q2 engineering budget",
    "created_at": "2026-04-10T12:00:00Z",
    "updated_at": "2026-04-10T12:00:00Z"
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

---

### GET /cogs/budgets

List budgets for the tenant.

**Permission:** `cogs.read`

**Query Params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `period` | string | ❌ | Filter to a specific period |
| `project_id` | string (UUID) | ❌ | Filter to a project |
| `team_id` | string (UUID) | ❌ | Filter to a team |
| `limit` | integer | ❌ | Default 25, max 100 |
| `cursor` | string | ❌ | Pagination cursor |

**Response — 200 OK:** Paginated list of Budget objects.

---

### GET /cogs/burn-rate

Compute spend velocity and projected budget usage for a period.

**Permission:** `cogs.read`

**Query Params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `period` | string | ✅ | `YYYY-Qn` or `YYYY-MM` — e.g. `2026-Q2` |
| `project_id` | string (UUID) | ❌ | Scope to a project |
| `team_id` | string (UUID) | ❌ | Scope to a team |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "budget_amount": 500000,
    "spent_to_date": 162400,
    "currency": "USD",
    "days_elapsed": 10,
    "days_total": 91,
    "burn_rate_per_day": 16240,
    "projected_total": 477256,
    "projected_remaining": 22744,
    "burn_status": "on_track",
    "completion_percent": 11.0
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing or malformed `period` |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

## Common Types

### CogsCategory

| Value | Meaning |
|---|---|
| `engineering` | Developer time and labor |
| `overhead` | Management, meetings, coordination |
| `tooling` | Licenses, software subscriptions |
| `cloud` | Infrastructure, compute, storage |
| `administrative` | HR, compliance, legal overhead |
| `other` | Uncategorized |

### CogsSource

| Value | Meaning |
|---|---|
| `timetracking` | From a time-tracking integration |
| `story_points` | Estimated via velocity |
| `estimate` | Manual rough estimate |
| `manual` | Directly entered |

### Confidence

| Value | Meaning |
|---|---|
| `high` | Actual tracked data |
| `medium` | Partially estimated |
| `low` | Rough estimate or projection |

### BurnStatus

| Value | Meaning |
|---|---|
| `on_track` | Projected spend ≤ budget |
| `at_risk` | Projected to exceed budget slightly |
| `over_budget` | Already exceeded budget |

### Period Format

| Format | Example | Meaning |
|---|---|---|
| `YYYY-Qn` | `2026-Q2` | Fiscal quarter |
| `YYYY-MM` | `2026-04` | Calendar month |
