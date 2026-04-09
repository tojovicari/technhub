# Intel API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

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
