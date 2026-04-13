# Intel API — Frontend Reference

**Base URL:** `/api/v1`
**Version:** v1
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

The Intel module is the **read-only** predictive analytics layer of moasy.tech. It derives insights from data owned by Core, DORA, SLA, and COGS modules and exposes actionable forecasts, risk scores, anomaly reports, and recommendations for technical leadership.

**All routes require:** `intel.read` permission. No write operations exist in this module.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/intel/velocity/forecast` | GET | `intel.read` |
| `/intel/epics/:epic_id/forecast` | GET | `intel.read` |
| `/intel/sla/risk` | GET | `intel.read` |
| `/intel/anomalies` | GET | `intel.read` |
| `/intel/recommendations` | GET | `intel.read` |
| `/intel/capacity` | GET | `intel.read` |
| `/intel/roadmap` | GET | `intel.read` |
| `/intel/dependencies` | GET | `intel.read` |
| `/intel/export` | GET | `intel.read` |

> Task dependency **writes** (`POST`/`DELETE`) live in the Core module at `/core/tasks/:task_id/dependencies`.

---

## Endpoints

---

### GET /intel/velocity/forecast

Forecast team or project sprint velocity using a linearly-weighted moving average over historical completed story points.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | UUID | ❌ | — | Scope to a project |
| `team_id` | UUID | ❌ | — | Scope to a team |
| `window_weeks` | integer | ❌ | 12 | Historical window: 4–52 weeks |

**Response — 200 OK:**

```json
{
  "data": {
    "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "team_id": null,
    "window_weeks": 12,
    "forecastedPointsPerWeek": 18.5,
    "weeklyHistory": [
      { "weekStart": "2026-03-30", "points": 20 },
      { "weekStart": "2026-04-06", "points": 17 }
    ],
    "trend": "stable",
    "confidenceScore": 80
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Field Reference:**

| Field | Type | Description |
|---|---|---|
| `forecastedPointsPerWeek` | number | Weighted moving average — most recent week has weight `n`, oldest weight `1` |
| `weeklyHistory` | array | One entry per week in the window. Missing weeks filled with `0`. Trailing zeros removed |
| `trend` | `up` \| `down` \| `stable` | Compares first-half vs second-half mean. >10% delta = trend |
| `confidenceScore` | 0–100 | `100 - (stddev/mean × 100)`. Higher = more consistent history |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | `window_weeks` < 4 or > 52 |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |

---

### GET /intel/epics/:epic_id/forecast

Predict the completion date for a specific epic from remaining story points and current velocity.

**Permission:** `intel.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `epic_id` | UUID | Epic to forecast |

**Response — 200 OK:**

```json
{
  "data": {
    "epic_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    "epic_name": "Auth Revamp",
    "status": "active",
    "target_end_date": "2026-05-01",
    "remaining_points": 40,
    "velocity_forecast": {
      "forecasted_points_per_week": 18.5,
      "trend": "stable",
      "confidence_score": 80
    },
    "completion_forecast": {
      "remainingPoints": 40,
      "velocityPerWeek": 18.5,
      "weeksRemaining": 3,
      "estimatedEndDate": "2026-04-27"
    },
    "weeks_overdue": 0
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Field Reference:**

| Field | Type | Description |
|---|---|---|
| `completion_forecast` | object \| null | `null` when velocity is 0 (cannot estimate) |
| `weeks_overdue` | integer \| null | Positive = estimated end is past target; 0 = on track; `null` = no target date set |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Epic not found in this tenant |
| 401 | `UNAUTHORIZED` | — |

---

### GET /intel/sla/risk

Return in-progress tasks at risk of breaching their SLA window, ranked by urgency.

> SLA instances were removed from the state machine. Risk is approximated from task `startedAt` / `dueDate`. When `dueDate` is not set, a 7-day default window from `startedAt` is used.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | UUID | ❌ | — | Scope to a project |
| `team_id` | UUID | ❌ | — | Scope to a team |
| `limit` | integer | ❌ | 20 | Max 100. Items ordered by oldest `startedAt` first |

**Response — 200 OK:**

```json
{
  "data": [
    {
      "instanceId": "task-cc9012",
      "taskId": "task-cc9012",
      "task_title": "Add OTLP exporter to API service",
      "priority": "P1",
      "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "epic_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      "assignee_id": "user-88bc",
      "elapsedPercent": 131.2,
      "riskScore": 100,
      "riskLevel": "critical",
      "hoursUntilDeadline": 0,
      "deadlineAt": "2026-04-10T14:00:00Z",
      "minutes_remaining": -75
    }
  ],
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Field Reference — SlaRiskLevel:**

| Value | When |
|---|---|
| `low` | < 50% of SLA window elapsed |
| `medium` | 50–70% elapsed |
| `high` | 70–90% elapsed |
| `critical` | ≥ 90% elapsed (or past deadline) |

> `minutes_remaining` is negative when the deadline has already passed.

---

### GET /intel/anomalies

Detect statistical anomalies in DORA / health metric time-series using z-score analysis.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `metric_name` | string | ❌ | — | Filter to one metric (e.g. `deployment_frequency`) |
| `project_id` | UUID | ❌ | — | Scope to a project |
| `window_days` | integer | ❌ | 90 | Historical window: 7–365 days |
| `z_threshold` | number | ❌ | 2.0 | Z-score threshold: 1.0–5.0. Lower = more sensitive |

**Response — 200 OK:**

```json
{
  "data": [
    {
      "metric_name": "deployment_frequency",
      "project_id": null,
      "anomalies": [
        {
          "date": "2026-03-15",
          "value": 0.1,
          "zScore": -3.8,
          "direction": "drop"
        }
      ]
    }
  ],
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Field Reference:**

| Field | Type | Description |
|---|---|---|
| `direction` | `spike` \| `drop` | `spike` = z > 0, `drop` = z < 0 |
| `zScore` | number | Standard deviations from mean. Negative = drop |

> Only groups with at least one anomaly are returned. Series with fewer than 3 points or stddev = 0 are skipped.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | `z_threshold` < 1 or > 5 |
| 401 | `UNAUTHORIZED` | — |

---

### GET /intel/recommendations

Get prioritised, rule-based action recommendations derived from cross-module signal analysis (DORA + SLA + COGS + velocity + epics).

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `project_id` | UUID | ❌ | Scope signals to a project |
| `team_id` | UUID | ❌ | Scope signals to a team |

**Response — 200 OK:**

```json
{
  "data": [
    {
      "type": "address_sla_violations",
      "priority": "high",
      "message": "3 SLA breaches detected. Review and resolve overdue tasks immediately.",
      "context": { "breachedSlaCount": 3, "atRiskSlaCount": 1 }
    },
    {
      "type": "improve_deployment_frequency",
      "priority": "medium",
      "message": "DORA overall level is \"medium\". Focus on smaller, more frequent deployments.",
      "context": { "doraLevel": "medium" }
    }
  ],
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**RecommendationType Values:**

| Type | Trigger |
|---|---|
| `improve_deployment_frequency` | DORA overall level is `low` or `medium` |
| `address_sla_violations` | Any task past deadline (high) or ≥ 80% elapsed (medium) |
| `review_budget` | COGS spend > 100% of monthly budget (high) or ≥ 90% (medium) |
| `investigate_velocity_decline` | Velocity trend is `down` over last 12 weeks |
| `epic_at_risk` | Active epic past `targetEndDate`. Priority `high` if > 2 weeks overdue |
| `team_overloaded` | Any user with utilization > 110% in current period |

> Results are sorted: `high` → `medium` → `low`.

---

### GET /intel/capacity

Analyse team capacity vs. actual hours logged for a period.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `period` | string | ✅ | — | `YYYY-Qn` or `YYYY-MM` |
| `team_id` | UUID | ❌ | — | Scope to a team |
| `capacity_hours` | number | ❌ | 160 | Expected hours per user per period |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "team_id": null,
    "capacity_hours_per_person": 160,
    "total_users": 3,
    "total_capacity_hours": 480,
    "total_logged_hours": 412,
    "overloaded_count": 1,
    "utilization": [
      {
        "userId": "user-88bc",
        "hoursWorked": 138,
        "capacityHours": 160,
        "utilizationPercent": 86.25,
        "status": "normal"
      },
      {
        "userId": "user-f31a9b",
        "hoursWorked": 182,
        "capacityHours": 160,
        "utilizationPercent": 113.75,
        "status": "over"
      }
    ]
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Capacity Status:**

| Value | When |
|---|---|
| `under` | < 70% utilization |
| `normal` | 70–110% utilization |
| `over` | > 110% utilization |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing or invalid `period` format |
| 401 | `UNAUTHORIZED` | — |

---

### GET /intel/roadmap

Return a Gantt-structured roadmap of projects and their epics, enriched with velocity-based completion forecasts and delay indicators.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | UUID | ❌ | — | Scope to a single project |
| `team_id` | UUID | ❌ | — | Scope to projects owned by a team |
| `status` | enum | ❌ | non-cancelled | Epic status filter: `backlog` \| `active` \| `completed` \| `cancelled` |

**Response — 200 OK:**

```json
{
  "data": [
    {
      "project_id": "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
      "project_name": "Platform Auth",
      "project_key": "AUTH",
      "status": "active",
      "start_date": "2026-01-01",
      "target_end_date": "2026-06-30",
      "velocity_forecast": {
        "forecasted_points_per_week": 18.5,
        "trend": "stable",
        "confidence_score": 80
      },
      "epics": [
        {
          "epic_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          "epic_name": "Auth Revamp",
          "status": "active",
          "start_date": "2026-01-15",
          "target_end_date": "2026-04-30",
          "estimated_end_date": "2026-04-27",
          "completion_percent": 60,
          "total_story_points": 40,
          "remaining_story_points": 16,
          "is_delayed": false,
          "weeks_overdue": 0,
          "confidence_score": 80
        }
      ]
    }
  ],
  "meta": { "request_id": "req_007", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Gantt Epic Item Fields:**

| Field | Type | Description |
|---|---|---|
| `estimated_end_date` | date \| null | Derived from `ceil(remaining_points / velocity) * 7` days from today. `null` when velocity = 0 |
| `completion_percent` | 0–100 | `completedTasks / totalTasks × 100` |
| `is_delayed` | boolean | `true` when `estimated_end_date` > `target_end_date` |
| `weeks_overdue` | integer \| null | Positive = weeks past target. `null` when no `target_end_date` |

---

### GET /intel/dependencies

Return the task dependency graph (blocking relationships) as a nodes-and-edges structure. Use this to render a dependency map or detect bottlenecks.

**Permission:** `intel.read`

> Dependency **writes** are in the Core module: `POST /core/tasks/:task_id/dependencies` and `DELETE /core/tasks/:task_id/dependencies/:blocked_id`.

**Query Params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `project_id` | UUID | ❌ | Return dependencies involving tasks in this project |
| `epic_id` | UUID | ❌ | Return dependencies involving tasks in this epic |

**Response — 200 OK:**

```json
{
  "data": {
    "nodes": [
      {
        "task_id": "dddddddd-dddd-4ddd-dddd-dddddddddddd",
        "task_title": "Setup Database Schema",
        "status": "done",
        "dependency_status": "done",
        "epic_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "assignee_id": "user-88bc",
        "story_points": 3,
        "due_date": null
      },
      {
        "task_id": "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee",
        "task_title": "Auth API endpoints",
        "status": "in_progress",
        "dependency_status": "ready",
        "epic_id": "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "assignee_id": "user-f31a9b",
        "story_points": 5,
        "due_date": "2026-04-20"
      }
    ],
    "edges": [
      {
        "blocker_id": "dddddddd-dddd-4ddd-dddd-dddddddddddd",
        "blocked_id": "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee"
      }
    ]
  },
  "meta": { "request_id": "req_008", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**DependencyStatus Values:**

| Value | Meaning |
|---|---|
| `ready` | No open blockers — can be started |
| `blocked` | Has at least one blocker that is not `done` or `cancelled` |
| `done` | Task is completed |
| `cancelled` | Task was cancelled |

> Only tasks that appear in at least one dependency edge are returned as nodes.

---

### GET /intel/export

Export data as a CSV file. Returns `text/csv` with a `Content-Disposition: attachment` header.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | enum | ✅ | — | `tasks` \| `epics` \| `velocity` \| `capacity` \| `anomalies` |
| `project_id` | UUID | ❌ | — | Scope data to a project |
| `team_id` | UUID | ❌ | — | Scope data to a team |
| `period` | string | ❌ (required for `capacity`) | — | `YYYY-Qn` or `YYYY-MM` |

**Response — 200 OK:**

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="cto-ai-tasks-2026-04-12.csv"

id,title,task_type,priority,status,epic_id,project_id,assignee_id,story_points,...
```

**CSV Schemas by Type:**

| Type | Columns |
|---|---|
| `tasks` | `id, title, task_type, priority, status, epic_id, project_id, assignee_id, story_points, hours_estimated, hours_actual, started_at, completed_at, due_date, cycle_time_hours, created_at` |
| `epics` | `id, name, status, project_id, owner_id, start_date, target_end_date, actual_end_date, total_tasks, completed_tasks, total_story_points, actual_hours, health_score, created_at` |
| `velocity` | `week_start, points, forecasted_points_per_week, trend, confidence_score` |
| `capacity` | `user_id, hours_worked, capacity_hours, utilization_percent, status` |
| `anomalies` | `metric_name, project_id, date, value, z_score, direction` |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing or invalid `type`; missing `period` for capacity export |
| 401 | `UNAUTHORIZED` | — |

---

## Core Module: Task Dependency Writes

These endpoints live in the **Core** module and require `core.task.manage` permission.

### POST /core/tasks/:task_id/dependencies

Declare that `:task_id` blocks another task (creates a dependency edge).

**Request Body:**

```json
{ "blocked_id": "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee" }
```

**Responses:**

| Status | When |
|---|---|
| 201 | Dependency created (or already existed — idempotent) |
| 400 | Self-loop detected |
| 404 | Blocker or blocked task not found in this tenant |

**Response — 201:**

```json
{
  "data": {
    "blocker_id": "dddddddd-dddd-4ddd-dddd-dddddddddddd",
    "blocked_id": "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee"
  }
}
```

---

### DELETE /core/tasks/:task_id/dependencies/:blocked_id

Remove the blocking relationship between `:task_id` (blocker) and `:blocked_id`.

**Responses:**

| Status | When |
|---|---|
| 204 | Deleted |
| 404 | Dependency not found |

---

### GET /core/tasks/:task_id/dependencies

List all tasks that `:task_id` blocks (outgoing) and all tasks that block it (incoming).

**Permission:** `core.task.read`

**Response — 200:**

```json
{
  "data": {
    "task_id": "dddddddd-dddd-4ddd-dddd-dddddddddddd",
    "blocks": [
      { "task_id": "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee", "title": "Auth API", "status": "in_progress", "priority": "P1", "epic_id": "aaa..." }
    ],
    "blocked_by": []
  }
}
```

---

## Common Types

### Trend

| Value | Meaning |
|---|---|
| `up` | Second half of window has > 10% higher mean than first half |
| `down` | Second half has > 10% lower mean |
| `stable` | Within ±10% |

### SlaRiskLevel

| Value | Elapsed |
|---|---|
| `low` | < 50% |
| `medium` | 50–70% |
| `high` | 70–90% |
| `critical` | ≥ 90% (or past deadline) |

### CapacityStatus

| Value | Utilization |
|---|---|
| `under` | < 70% |
| `normal` | 70–110% |
| `over` | > 110% |

### DependencyStatus

| Value | Meaning |
|---|---|
| `ready` | No open blockers |
| `blocked` | Has at least one open blocker |
| `done` | Task status is `done` |
| `cancelled` | Task status is `cancelled` |

### AnomalyDirection

| Value | Meaning |
|---|---|
| `spike` | Abnormally high (z > 0) |
| `drop` | Abnormally low (z < 0) |

---

## Overview

The Intel module provides AI-assisted forecasting, anomaly detection, and tactical recommendations for engineering leaders. All endpoints are **read-only** — Intel derives insights from data in Core, DORA, SLA, and COGS modules.

**All routes require:** `intel.read` permission

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/intel/velocity/forecast` | GET | `intel.read` |
| `/intel/epics/:epic_id/forecast` | GET | `intel.read` |
| `/intel/sla/risk` | GET | `intel.read` |
| `/intel/anomalies` | GET | `intel.read` |
| `/intel/recommendations` | GET | `intel.read` |
| `/intel/capacity` | GET | `intel.read` |

---

## Endpoints

---

### GET /intel/velocity/forecast

Forecast team or project throughput for upcoming sprints based on historical velocity.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Scope to a project |
| `team_id` | string (UUID) | ❌ | — | Scope to a team |
| `window_weeks` | integer | ❌ | 12 | Historical window for baseline: 4–52 weeks |

**Response — 200 OK:**

```json
{
  "data": {
    "project_id": "proj-aa1234",
    "team_id": null,
    "window_weeks": 12,
    "avg_velocity": 34.5,
    "velocity_trend": "up",
    "velocity_stddev": 6.2,
    "forecast": [
      {
        "week_offset": 1,
        "week_start": "2026-04-13T00:00:00Z",
        "week_end":   "2026-04-19T23:59:59Z",
        "predicted_points": 36,
        "confidence_low": 28,
        "confidence_high": 44
      },
      {
        "week_offset": 2,
        "week_start": "2026-04-20T00:00:00Z",
        "week_end":   "2026-04-26T23:59:59Z",
        "predicted_points": 35,
        "confidence_low": 26,
        "confidence_high": 44
      }
    ]
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> `velocity_trend`: `up` | `down` | `stable` — based on comparing the last 4 weeks to the full window.  
> `confidence_low` / `confidence_high`: 80% confidence interval — useful for rendering forecast bands on charts.

---

### GET /intel/epics/:epic_id/forecast

Predict the completion date and remaining cost for a specific epic based on velocity and remaining work.

**Permission:** `intel.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `epic_id` | string (UUID) | Epic to forecast |

**Response — 200 OK:**

```json
{
  "data": {
    "epic_id": "epic-bb5678",
    "epic_name": "Observability Stack Migration",
    "total_tasks": 20,
    "completed_tasks": 17,
    "remaining_tasks": 3,
    "remaining_story_points": 8,
    "avg_velocity_per_week": 34.5,
    "completion_forecast": {
      "estimated_completion_date": "2026-04-24T00:00:00Z",
      "confidence": "high",
      "weeks_remaining": 1.0,
      "is_on_track": true,
      "target_end_date": "2026-05-31T23:59:59Z",
      "buffer_weeks": 5.3
    },
    "cost_forecast": {
      "spent_to_date": 28800,
      "projected_remaining_cost": 3840,
      "projected_total_cost": 32640,
      "currency": "USD",
      "confidence": "medium"
    }
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> `is_on_track`: `true` if estimated completion is before `target_end_date`.  
> `buffer_weeks`: How many weeks ahead of deadline. Negative = already late.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Epic not found in this tenant |

---

### GET /intel/sla/risk

Return tasks at risk of breaching their SLA, ranked by urgency. Use for compliance dashboards.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Scope to a project |
| `team_id` | string (UUID) | ❌ | — | Scope to a team |
| `limit` | integer | ❌ | 25 | Max 100 |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "task_id": "task-cc9012",
        "task_title": "Add OTLP exporter to API service",
        "sla_instance_id": "sla-inst-aaa111",
        "sla_template_name": "Critical Bug SLA",
        "priority": "P1",
        "risk_level": "critical",
        "deadline_at": "2026-04-10T14:00:00Z",
        "minutes_remaining": -75,
        "percent_elapsed": 131.2,
        "assignee_id": "user-88bc",
        "project_id": "proj-aa1234"
      },
      {
        "task_id": "task-dd3344",
        "task_title": "Fix login redirect loop",
        "sla_instance_id": "sla-inst-bbb222",
        "sla_template_name": "Critical Bug SLA",
        "priority": "P0",
        "risk_level": "high",
        "deadline_at": "2026-04-10T16:00:00Z",
        "minutes_remaining": 45,
        "percent_elapsed": 87.5,
        "assignee_id": "user-f31a9b",
        "project_id": "proj-aa1234"
      }
    ]
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> `minutes_remaining`: Negative means already breached.  
> Items are sorted by `risk_level` (critical → high → medium → low) then by `deadline_at` ascending.

---

### GET /intel/anomalies

Detect statistical anomalies in DORA or operational metrics using z-score analysis.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `metric_name` | string | ❌ | — | Filter to one metric (see metric names below) |
| `project_id` | string (UUID) | ❌ | — | Scope to a project |
| `window_days` | integer | ❌ | 90 | Historical window for anomaly detection: 7–365 days |
| `z_threshold` | number | ❌ | 2.0 | Z-score threshold: 1.0–5.0. Lower = more sensitive |

**Response — 200 OK:**

```json
{
  "data": {
    "window_days": 90,
    "z_threshold": 2.0,
    "anomaly_groups": [
      {
        "metric_name": "deployment_frequency",
        "anomaly_count": 2,
        "direction": "drop",
        "severity": "high",
        "anomalies": [
          {
            "id": "metric-uuid-201",
            "computed_at": "2026-03-15T00:00:00Z",
            "value": 0.1,
            "baseline_avg": 1.4,
            "z_score": -3.8,
            "direction": "drop",
            "notes": "2.7 standard deviations below mean"
          }
        ]
      }
    ]
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> `direction`: `spike` (abnormally high) or `drop` (abnormally low).  
> `severity`: Derived from z-score magnitude: `low` (<2.5), `medium` (2.5–3.5), `high` (>3.5).

**Detectable Metrics:**

| Metric Name |
|---|
| `deployment_frequency` |
| `lead_time_p50` |
| `lead_time_p95` |
| `mttr` |
| `change_failure_rate` |

---

### GET /intel/recommendations

Get actionable recommendations derived from cross-module signal analysis (DORA + SLA + COGS + velocity). Returns highest-priority items first.

**Permission:** `intel.read`

**Query Params:** (none required)

| Param | Type | Required | Notes |
|---|---|---|---|
| `project_id` | string (UUID) | ❌ | Scope to a project |
| `team_id` | string (UUID) | ❌ | Scope to a team |
| `limit` | integer | ❌ | Default 10, max 50 |

**Response — 200 OK:**

```json
{
  "data": {
    "generated_at": "2026-04-10T15:00:00Z",
    "items": [
      {
        "id": "rec-001",
        "type": "sla_breach_risk",
        "severity": "critical",
        "title": "3 P0 bugs at SLA breach risk",
        "description": "3 critical bugs have < 30 minutes before their SLA deadline. Assign engineers immediately.",
        "affected_entity": { "type": "task", "ids": ["task-cc9012", "task-dd3344", "task-ee5566"] },
        "suggested_action": "Escalate to on-call engineer and update assignee",
        "data_sources": ["sla", "core"],
        "created_at": "2026-04-10T14:58:00Z"
      },
      {
        "id": "rec-002",
        "type": "velocity_decline",
        "severity": "medium",
        "title": "Team velocity dropped 28% over 4 weeks",
        "description": "The Platform Engineering team's velocity has declined from 38 to 27 points/week. Consider a retrospective.",
        "affected_entity": { "type": "team", "ids": ["team-c1d2e3"] },
        "suggested_action": "Schedule retrospective and check for blockers or unplanned work",
        "data_sources": ["core", "dora"],
        "created_at": "2026-04-10T14:58:00Z"
      },
      {
        "id": "rec-003",
        "type": "budget_overrun_risk",
        "severity": "high",
        "title": "Epic projected to exceed budget by 18%",
        "description": "Epic 'Observability Stack Migration' is tracking to $33,882 against a $28,800 budget.",
        "affected_entity": { "type": "epic", "ids": ["epic-bb5678"] },
        "suggested_action": "Review scope and defer low-priority tasks, or request budget increase",
        "data_sources": ["cogs", "core"],
        "created_at": "2026-04-10T14:58:00Z"
      }
    ]
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

---

### GET /intel/capacity

Analyze team capacity vs. actual workload for a period.

**Permission:** `intel.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `period` | string | ✅ | — | `YYYY-Qn` or `YYYY-MM` |
| `team_id` | string (UUID) | ❌ | — | Scope to a team; omit for all teams |
| `capacity_hours` | number | ❌ | 160 | Expected hours per user per period |

**Response — 200 OK:**

```json
{
  "data": {
    "period": "2026-Q2",
    "capacity_hours_per_user": 160,
    "team_id": "team-c1d2e3",
    "team_name": "Platform Engineering",
    "total_users": 6,
    "total_capacity_hours": 960,
    "total_logged_hours": 720,
    "utilization_percent": 75.0,
    "status": "healthy",
    "users": [
      {
        "user_id": "user-88bc",
        "full_name": "Alice Chen",
        "capacity_hours": 160,
        "logged_hours": 138,
        "utilization_percent": 86.25,
        "status": "healthy"
      },
      {
        "user_id": "user-f31a9b",
        "full_name": "Bob Ferreira",
        "capacity_hours": 160,
        "logged_hours": 182,
        "utilization_percent": 113.75,
        "status": "overloaded"
      }
    ]
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `period` or invalid format |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

## Common Types

### SlaRiskLevel

| Value | Meaning |
|---|---|
| `critical` | Already breached or < 15 min remaining |
| `high` | 15–30 min remaining or 85–100% elapsed |
| `medium` | 50–85% of SLA time elapsed |
| `low` | < 50% of SLA time elapsed |

### Trend

| Value | Meaning |
|---|---|
| `up` | Improving (higher is better for this metric) |
| `down` | Declining |
| `stable` | Within normal variance |

### RecommendationType

| Value | Trigger signal |
|---|---|
| `sla_breach_risk` | Tasks near SLA deadline |
| `velocity_decline` | Velocity drop > 20% over 4 weeks |
| `budget_overrun_risk` | Epic/project projected to exceed budget |
| `deployment_frequency_drop` | DORA deployment frequency anomaly |
| `high_change_failure_rate` | CFR > 15% |
| `team_overload` | Utilization > 100% for any user |
| `lead_time_regression` | Lead time increase anomaly |

### Capacity Status

| Value | Meaning |
|---|---|
| `healthy` | Utilization 60–100% |
| `underloaded` | Utilization < 60% |
| `overloaded` | Utilization > 100% |

### AnomalyDirection

| Value | Meaning |
|---|---|
| `spike` | Abnormally high value |
| `drop` | Abnormally low value |
