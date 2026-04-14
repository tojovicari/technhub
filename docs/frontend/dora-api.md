# DORA Metrics API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

The DORA module implements the four key DevOps Research and Assessment metrics:

| Metric | What it measures |
|---|---|
| **Deployment Frequency** | How often code reaches production |
| **Lead Time for Changes** | PR first commit → merged |
| **MTTR** | How fast P1/P2 incidents are resolved (via OpsGenie or incident.io integration) |
| **Change Failure Rate** | Percentage of deploys that cause rollback/hotfix |

The scorecard endpoint computes all four metrics and returns a performance level per metric and an overall level.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/dora/deploys` | POST | `dora.deploy.ingest` |
| `/dora/deploys` | GET | `dora.read` |
| `/dora/scorecard` | GET | `dora.read` |
| `/dora/lead-time` | POST | `dora.deploy.ingest` |
| `/dora/history/:metric_name` | GET | `dora.read` |

---

## Performance Level Thresholds

| Metric | elite | high | medium | low |
|---|---|---|---|---|
| Deployment Frequency | ≥ 1/day | ≥ 1/week | ≥ 1/month | < 1/month |
| Lead Time for Changes | < 1h | < 7d | < 30d | ≥ 30d |
| MTTR | < 1h | < 24h | < 7d | ≥ 7d |
| MTTA | < 15min | < 30min | < 2h | ≥ 2h |
| Change Failure Rate | ≤ 5% | ≤ 10% | ≤ 15% | > 15% |

---

## Endpoints

---

### POST /dora/deploys

Ingest a deployment event. Idempotent when `external_id` is provided.

**Permission:** `dora.deploy.ingest`

**When to call:** From your CI/CD pipeline after a production deploy, or from a GitHub webhook integration.

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `ref` | string | ✅ | — | Git tag, branch, or release label (e.g. `v1.4.2`) |
| `deployed_at` | ISO datetime | ✅ | — | Actual deploy timestamp |
| `project_id` | string (UUID) | ❌ | null | Associate deploy with a project |
| `source` | enum | ❌ | `manual` | `github_release` \| `github_tag` \| `manual` |
| `external_id` | string | ❌ | null | Provider-assigned ID — used as idempotency key |
| `commit_sha` | string | ❌ | null | Git commit SHA |
| `environment` | string | ❌ | `production` | Deployment target environment |
| `is_hotfix` | boolean | ❌ | `false` | Mark as hotfix — contributes to MTTR |
| `is_rollback` | boolean | ❌ | `false` | Mark as rollback — contributes to Change Failure Rate |
| `pr_ids` | string[] | ❌ | `[]` | PR identifiers included in this deploy |
| `raw_payload` | object | ❌ | null | Original webhook payload for audit |

**Request Example:**

```json
{
  "project_id": "proj-aa1234",
  "source": "github_release",
  "external_id": "gh-release-98765",
  "ref": "v1.4.2",
  "commit_sha": "abc123def456",
  "deployed_at": "2026-04-10T14:30:00Z",
  "environment": "production",
  "is_hotfix": false,
  "is_rollback": false,
  "pr_ids": ["PR-1042", "PR-1045"]
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "deploy-uuid-001",
    "tenantId": "tenant-7a4b",
    "projectId": "proj-aa1234",
    "source": "github_release",
    "externalId": "gh-release-98765",
    "ref": "v1.4.2",
    "commitSha": "abc123def456",
    "environment": "production",
    "deployedAt": "2026-04-10T14:30:00Z",
    "isHotfix": false,
    "isRollback": false,
    "prIds": ["PR-1042", "PR-1045"],
    "createdAt": "2026-04-10T14:30:05Z"
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T14:30:05Z" },
  "error": null
}
```

> **Idempotency:** Submitting the same `external_id` twice returns the original record without error.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `ref` or `deployed_at`, invalid format |
| 401 | `UNAUTHORIZED` | Invalid token |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /dora/deploys

List deployment events for the tenant, most recent first.

**Permission:** `dora.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Filter to a project |
| `environment` | string | ❌ | `production` | Filter by environment |
| `limit` | integer | ❌ | 20 | Max 100 |
| `cursor` | string | ❌ | — | Pagination cursor |

**Response — 200 OK:**

```json
{
  "data": {
    "data": [ /* DeployEvent objects */ ],
    "next_cursor": "deploy-uuid-050"
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

---

### GET /dora/scorecard

Compute all 4 DORA metrics over a rolling time window. Also persists a `HealthMetric` snapshot per metric for trend analysis.

**Permission:** `dora.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Scope to a single project; omit for tenant-wide |
| `window_days` | integer | ❌ | 30 | Rolling window size: 1–365 days |
| `environment` | string | ❌ | `production` | Which environment to analyze |

**Response — 200 OK:**

```json
{
  "data": {
    "window_days": 30,
    "window_start": "2026-03-11T00:00:00Z",
    "window_end": "2026-04-10T00:00:00Z",
    "project_id": null,
    "overall_level": "high",
    "deployment_frequency": {
      "value": 1.4,
      "unit": "per_day",
      "level": "elite",
      "deploy_count": 42
    },
    "lead_time": {
      "p50": 6.2,
      "p95": 18.5,
      "unit": "hours",
      "level": "high",
      "sample_size": 38
    },
    "mttr": {
      "value": 3.1,
      "unit": "hours",
      "level": "high",
      "sample_size": 5
    },
    "mttr_source": "incidents",
    "mtta": {
      "p50": 0.18,
      "unit": "hours",
      "level": "elite",
      "sample_size": 10
    },
    "incident_frequency": {
      "value": 0.3,
      "unit": "per_day"
    },
    "change_failure_rate": {
      "value": 4.76,
      "unit": "percent",
      "level": "elite",
      "total_deploys": 42,
      "failed_deploys": 2
    }
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> **Nullable metrics:** `lead_time`, `mttr`, `mtta`, `incident_frequency`, and `change_failure_rate` are `null` if no qualifying data exists in the window. Always check for null before accessing sub-fields.

> **Incident integration not configured:** When no active OpsGenie or incident.io connection exists for the tenant, `mttr_source` is `"not_configured"` and `mttr`, `mtta`, and `incident_frequency` are all `null`. The overall scorecard level is computed from the remaining available metrics only — the tenant is not penalised. To enable incident metrics, add an OpsGenie or incident.io connection via the Integrations module.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | `window_days` out of range (1–365) |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### POST /dora/lead-time

Record the lead time for a merged pull request. Used to compute the Lead Time for Changes metric.

**Permission:** `dora.deploy.ingest`

**When to call:** From your GitHub webhook integration on PR merge events.

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `pr_id` | string | ✅ | — | Provider PR identifier (e.g. `"PR-1042"`) |
| `first_commit_at` | ISO datetime | ✅ | — | Timestamp of the first commit in the PR |
| `merged_at` | ISO datetime | ✅ | — | Timestamp when the PR was merged |
| `project_id` | string (UUID) | ❌ | null | Associate with a project |
| `environment` | string | ❌ | `production` | — |

**Request Example:**

```json
{
  "project_id": "proj-aa1234",
  "pr_id": "PR-1042",
  "first_commit_at": "2026-04-08T10:00:00Z",
  "merged_at": "2026-04-10T14:00:00Z",
  "environment": "production"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "skipped": false,
    "lead_time_hours": 52.0,
    "pr_id": "PR-1042"
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T14:05:00Z" },
  "error": null
}
```

> **Outlier filtering:** Events with `lead_time > 90 days` are silently dropped. `skipped: true` is returned in that case.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `pr_id`, `first_commit_at`, or `merged_at`; or `merged_at` before `first_commit_at` |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /dora/history/:metric_name

Retrieve historical health metric snapshots for trend charts.

**Permission:** `dora.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `metric_name` | string | One of: `deployment_frequency`, `lead_time_p50`, `lead_time_p95`, `mttr`, `mtta`, `incident_frequency`, `change_failure_rate` |

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Scope to a project |
| `limit` | integer | ❌ | 30 | Max 365 |
| `cursor` | string | ❌ | — | Pagination cursor |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "metric-uuid-001",
        "tenantId": "tenant-7a4b",
        "projectId": null,
        "teamId": null,
        "metricName": "deployment_frequency",
        "windowDays": 30,
        "value": 1.4,
        "unit": "per_day",
        "level": "elite",
        "computedAt": "2026-04-10T15:00:00Z",
        "windowStart": "2026-03-11T00:00:00Z",
        "windowEnd": "2026-04-10T00:00:00Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

---

### GET /integrations/connections/:connection_id/incident-io/severities

Fetch the severity list configured in the tenant's incident.io account. Use in the field mapping wizard to populate the `severity_to_priority` mapping UI.

**Permission:** `integrations.connection.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string (UUID) | `IntegrationConnection` ID for an active `incident_io` connection |

**Response — 200 OK:**

```json
{
  "data": {
    "connection_id": "conn-uuid-001",
    "severities": [
      { "id": "sev-1", "name": "Critical", "rank": 1, "description": "Service outage" },
      { "id": "sev-2", "name": "Major",    "rank": 2, "description": "Significant impact" },
      { "id": "sev-3", "name": "Minor",    "rank": 3, "description": "Partial degradation" }
    ]
  },
  "meta": { "request_id": "req_010", "version": "v1", "timestamp": "2026-04-14T10:00:00Z" },
  "error": null
}
```

---

### GET /integrations/connections/:connection_id/opsgenie/priorities

Return the standard OpsGenie priority list (static — no API call). Use in the field mapping wizard.

**Permission:** `integrations.connection.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string (UUID) | `IntegrationConnection` ID for an active `opsgenie` connection |

**Response — 200 OK:**

```json
{
  "data": {
    "connection_id": "conn-uuid-002",
    "priorities": [
      { "name": "P1", "label": "P1 — Critical" },
      { "name": "P2", "label": "P2 — High" },
      { "name": "P3", "label": "P3 — Moderate" },
      { "name": "P4", "label": "P4 — Low" },
      { "name": "P5", "label": "P5 — Informational" }
    ]
  },
  "meta": { "request_id": "req_011", "version": "v1", "timestamp": "2026-04-14T10:00:00Z" },
  "error": null
}
```

---

## Common Types

### DoraLevel

| Value | Meaning |
|---|---|
| `elite` | Best-in-class delivery performance |
| `high` | Strong engineering outcomes |
| `medium` | Meets baseline expectations |
| `low` | Improvement required |

### Deploy Source

| Value | Meaning |
|---|---|
| `github_release` | GitHub release event |
| `github_tag` | GitHub tag push |
| `manual` | Manually recorded |

### Metric Names (for history endpoint)

| Value | Metric |
|---|---|
| `deployment_frequency` | Deploys per day |
| `lead_time_p50` | Median lead time (hours) |
| `lead_time_p95` | P95 lead time (hours) |
| `mttr` | Mean time to restore (hours) |
| `mtta` | Mean time to acknowledge P1/P2 incidents (hours, P50) |
| `incident_frequency` | P1/P2 incidents per day |
| `change_failure_rate` | Failed deploy percentage |
