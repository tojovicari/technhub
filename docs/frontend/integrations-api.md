# Integrations API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** Most endpoints require `Authorization: Bearer <JWT>`. Webhook ingestion endpoints use a separate token mechanism.

---

## Overview

The Integrations module manages connections to external providers (Jira, GitHub, OpsGenie, incident.io), triggers data sync jobs, and receives provider webhooks.

**Important security note:** Credentials (API tokens, OAuth secrets) are **write-only** — they are never returned in any API response. The API returns `secret_strategy` to indicate how secrets are stored, but never exposes the actual values.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/integrations/connections` | POST | `integrations.connection.manage` |
| `/integrations/connections/:id` | PATCH | `integrations.connection.manage` |
| `/integrations/connections/:id/secrets` | PUT | `integrations.secret.rotate` |
| `/integrations/connections/:id/original-types` | GET | `integrations.connection.read` |
| `/integrations/original-types` | GET | `integrations.connection.read` |
| `/integrations/connections/:id/type-mapping` | GET | `integrations.connection.read` |
| `/integrations/connections/:id/type-mapping` | PATCH | `integrations.connection.manage` |
| `/integrations/connections/:id/incident-io/severities` | GET | `integrations.connection.read` |
| `/integrations/connections/:id/opsgenie/priorities` | GET | `integrations.connection.read` |
| `/integrations/sync-jobs` | POST | `integrations.sync.trigger` |
| `/integrations/sync-jobs/:id` | GET | `integrations.sync.read` |
| `/integrations/webhooks/:provider/:tenant_id` | POST | Public (token-gated — see below) |
| `/integrations/webhooks/events/:event_id` | GET | `integrations.read` |

---

## Type Mapping

When provider data is synced, each task stores two type fields:

| Field | Description |
|---|---|
| `task_type` | Canonical type after normalization: `bug` \| `feature` \| `chore` \| `spike` \| `tech_debt`. Can be `null` if no mapping is configured for the provider's raw type. |
| `original_type` | Raw type string from the provider — e.g. `"Incident"`, `"Security Finding"`, `"Customer Request"`. Always stored; never overwritten by normalization. |

**Why this matters:** Providers like Jira have types (`Incident`, `Security Finding`, etc.) that don’t map 1:1 to canonical types. Instead of silently falling back to a wrong type (which corrupts DORA/COGS data), the system stores the original type and lets the tenant configure the mapping explicitly.

### Type resolution order during sync

```
Provider raw type: "Incident"
       │
       ├── typeMapping["Incident"] configured → taskType = mapped value
       │
       ├── Internal heuristics match (e.g. "defect" → bug, "task" → chore)
       │
       └── No match → taskType = null  (logged as warning, no silent fallback)

originalType = "Incident"  ←  always stored regardless of mapping
```

Use the type mapping endpoints below to discover which types a connection has ingested and configure the de-para mapping in settings.

---

## Endpoints

---

### POST /integrations/connections

Register a new integration connection for the tenant.

**Permission:** `integrations.connection.manage`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | Must match JWT `tenant_id` |
| `provider` | enum | ✅ | `jira` \| `github` \| `opsgenie` \| `incident_io` |
| `scope` | object | ❌ | Provider-specific scope configuration (e.g. `{ "org": "acme-corp" }`) |
| `credentials` | object | ❌ | See Credential types below |

**Credential options:**

You can provide credentials either as a vault reference (preferred) or inline (encrypted at rest):

**Option A — Vault reference (preferred):**
```json
{
  "auth_type": "oauth2",
  "secret_ref": "vault://integrations/github/tenant_7a4b"
}
```

**Option B — Inline secret:**
```json
{
  "auth_type": "token",
  "access_token": "<your-github-pat>"
}
```

> Inline secrets are encrypted at rest by the server. Use vault references when your infrastructure supports it.

---

**Scope and credentials by provider:**

#### GitHub

| Field | Type | Required | Notes |
|---|---|---|---|
| `scope.org` | string | ✅ | GitHub organization or user login |
| `scope.repos` | string[] | ❌ | Allowlist of repo names. Omit to sync all repos in the org |
| `credentials.auth_type` | `"app"` | ✅ | GitHub App authentication |
| `credentials.app_id` | number | ✅ | GitHub App ID |
| `credentials.private_key_pem` | string | ✅ | PEM-encoded private key |
| `credentials.installation_id` | number | ✅ | GitHub App installation ID |

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "github",
  "scope": { "org": "acme-corp", "repos": ["platform", "api-service"] },
  "credentials": {
    "auth_type": "app",
    "app_id": 123456,
    "private_key_pem": "-----BEGIN RSA PRIVATE KEY-----\n...",
    "installation_id": 78901234
  }
}
```

#### Jira

| Field | Type | Required | Notes |
|---|---|---|---|
| `scope.project_keys` | string[] | ❌ | Allowlist of Jira project keys (e.g. `["AUTH", "PLAT"]`). Omit to sync all |
| `credentials.auth_type` | `"token"` | ✅ | Jira API token |
| `credentials.base_url` | string | ✅ | Jira instance URL (e.g. `https://myorg.atlassian.net`) |
| `credentials.email` | string | ✅ | Jira account email |
| `credentials.access_token` | string | ✅ | Jira API token |

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "jira",
  "scope": { "project_keys": ["AUTH", "PLAT"] },
  "credentials": {
    "auth_type": "token",
    "base_url": "https://myorg.atlassian.net",
    "email": "ci-bot@myorg.com",
    "access_token": "ATATT3xFfGF0..."
  }
}
```

#### incident.io

> **`scope.field_mapping` is required.** incident.io uses custom severity names — you must map them to the canonical P1–P5 scale so MTTR/MTTA calculations work correctly. Fetch the tenant's severities from `GET /incident-io/v1/severities` (on the incident.io API) to populate the mapping UI.

| Field | Type | Required | Notes |
|---|---|---|---|
| `scope.field_mapping.severity_to_priority` | object | ✅ | Maps provider severity names → `P1`–`P5` |
| `scope.field_mapping.include_priorities` | string[] | ❌ | Which priorities count for MTTR/MTTA. Default: `["P1","P2"]` |
| `scope.field_mapping.production_indicator` | object | ❌ | How to detect production incidents. Default: `{ "type": "none" }` (all incidents included) |
| `scope.field_mapping.affected_service_field` | object | ❌ | Where to read affected services. Default: `{ "type": "none" }` |
| `credentials.auth_type` | `"bearer"` | ✅ | |
| `credentials.api_key` | string | ✅ | incident.io API key |

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "incident_io",
  "scope": {
    "field_mapping": {
      "severity_to_priority": {
        "critical": "P1",
        "major": "P2",
        "minor": "P3",
        "informational": "P4"
      },
      "include_priorities": ["P1", "P2"],
      "production_indicator": { "type": "none" }
    }
  },
  "credentials": {
    "auth_type": "bearer",
    "api_key": "your-incident-io-api-key"
  }
}
```

**`production_indicator` options:**
```json
{ "type": "none" }                                          // all incidents
{ "type": "tag", "values": ["production", "prod"] }        // tag-based
{ "type": "custom_field", "field_id": "01CF...", "values": ["production"] }  // custom field
```

#### OpsGenie

> **`scope.field_mapping` is required.** OpsGenie already uses P1–P5 natively, so the mapping is 1:1. You must still provide it explicitly.

| Field | Type | Required | Notes |
|---|---|---|---|
| `scope.use_incident_api` | boolean | ✅ | `true` = Incident API (Standard/Enterprise plans); `false` = Alert API (all plans) |
| `scope.field_mapping.severity_to_priority` | object | ✅ | Maps OpsGenie priority names → `P1`–`P5` |
| `scope.field_mapping.include_priorities` | string[] | ❌ | Default: `["P1","P2"]` |
| `scope.field_mapping.production_indicator` | object | ❌ | Default: `{ "type": "none" }` |
| `credentials.auth_type` | `"api_key"` | ✅ | |
| `credentials.api_key` | string | ✅ | OpsGenie API key |
| `credentials.region` | `"us"` \| `"eu"` | ❌ | Default: `"us"` |

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "opsgenie",
  "scope": {
    "use_incident_api": false,
    "field_mapping": {
      "severity_to_priority": {
        "P1": "P1",
        "P2": "P2",
        "P3": "P3",
        "P4": "P4",
        "P5": "P5"
      },
      "include_priorities": ["P1", "P2"],
      "production_indicator": { "type": "none" }
    }
  },
  "credentials": {
    "auth_type": "api_key",
    "api_key": "your-opsgenie-api-key",
    "region": "us"
  }
}
```

---

**Full Request Example (POST /integrations/connections — GitHub):**

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "github",
  "scope": { "org": "acme-corp", "repos": ["platform", "api-service"] },
  "credentials": {
    "auth_type": "app",
    "app_id": 123456,
    "private_key_pem": "-----BEGIN RSA PRIVATE KEY-----\n...",
    "installation_id": 78901234
  }
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "conn-001",
    "tenant_id": "tenant-7a4b",
    "provider": "github",
    "status": "active",
    "secret_strategy": "inline_encrypted",
    "scope": { "org": "acme-corp", "repos": ["platform", "api-service"] },
    "created_at": "2026-04-10T12:00:00Z",
    "last_synced_at": null
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> **`secret_strategy`**: `inline_encrypted` | `vault_ref` — indicates how credentials are stored. The actual secret is **never returned**.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid `provider`, missing `tenant_id` |
| 401 | `UNAUTHORIZED` | Invalid token |
| 403 | `FORBIDDEN` | Permission denied |

---

### PUT /integrations/connections/:connection_id/secrets

Rotate or set provider credentials for an existing connection. Write-only — no response body.

**Permission:** `integrations.secret.rotate`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string | Connection ID to update |

**Request Body:** Credential object (same as in POST above — vault reference or inline secret).

**Request Example:**

```json
{
  "auth_type": "token",
  "access_token": "ghp_new_token_yyy"
}
```

**Response — 204 No Content** (empty body — credentials are write-only)

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |

---

### PATCH /integrations/connections/:connection_id

Update the scope configuration of an existing connection — for example, to save the `field_mapping` after the setup wizard.

**Permission:** `integrations.connection.manage`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string | Connection ID to update |

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | Must match JWT `tenant_id` |
| `scope` | object | ✅ | Partial or full scope override (merged server-side with existing scope) |

**Request Example (saving field_mapping after wizard):**

```json
{
  "tenant_id": "ten_1",
  "scope": {
    "field_mapping": {
      "severity_to_priority": {
        "critical": "P1",
        "major": "P2",
        "minor": "P3",
        "informational": "P4"
      },
      "include_priorities": ["P1", "P2"]
    }
  }
}
```

**Response — 200 OK:**

```json
{
  "data": {
    "id": "07fafe6a-55be-4c7e-a0ae-3d0a5350357d",
    "tenant_id": "ten_1",
    "provider": "incident_io",
    "status": "active",
    "secret_strategy": "inline_encrypted",
    "secret_last_rotated_at": "2026-04-10T12:00:00Z",
    "last_sync": null
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-15T10:00:00Z" },
  "error": null
}
```

> `scope` is **not** returned in the response. Store the scope locally after PATCH if you need to display it. The response confirms identity and active status.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `tenant_id` or invalid scope shape |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |

---

### POST /integrations/sync-jobs

Trigger a data sync for a connection. The job runs synchronously — the response includes the final status.

**Permission:** `integrations.sync.trigger`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | Must match JWT `tenant_id` |
| `connection_id` | string | ✅ | Connection to sync |
| `mode` | `"full"` \| `"incremental"` | ❌ | Default: `"incremental"`. Use `"full"` to re-sync all data |

**Request Example:**

```json
{
  "tenant_id": "ten_1",
  "connection_id": "conn-001",
  "mode": "full"
}
```

**Response — 202 Accepted:**

---

### GET /integrations/sync-jobs/:id

Retrieve a past sync job by ID.

**Permission:** `integrations.sync.read`

**Response — 200 OK:**

```json
{
  "data": {
    "id": "sync-job-xyz",
    "tenant_id": "ten_1",
    "connection_id": "conn-001",
    "status": "success",
    "created_at": "2026-04-10T14:00:00Z",
    "started_at": "2026-04-10T14:00:00Z",
    "finished_at": "2026-04-10T14:00:01Z",
    "error_summary": null
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T14:05:00Z" },
  "error": null
}
```

**Sync Job Status Values:**

| Value | Meaning |
|---|---|
| `success` | Finished successfully |
| `failed` | Finished with errors — see `error_summary` |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Job not found |

---

### GET /integrations/original-types

List all distinct `original_type` values ingested across **all connections** for the tenant. This is the correct endpoint to populate the value picker when building an SLA condition on `original_type`.

**Why this endpoint instead of the per-connection one:**  
SLA templates are tenant-scoped and evaluated against tasks from all connections. The condition `original_type in ["Incident"]` fires on any task from any connection with that raw type — not just tasks from a specific connection. So the dropdown should show the full tenant-wide union, not a per-connection slice. The server does the `DISTINCT` + merge in a single query.

**Permission:** `integrations.connection.read`

**Response — 200 OK:**

```json
{
  "data": {
    "original_types": [
      "Bug",
      "Customer Request",
      "Epic",
      "Incident",
      "Major Incident",
      "Security Finding",
      "Task"
    ]
  },
  "meta": { "request_id": "req_009", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> Returns only types seen in at least one synced task. Empty array means no tasks have been synced yet. Sorted alphabetically.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /integrations/connections/:connection_id/original-types

Retrieve the distinct raw types that have been ingested for a connection. Use this to populate value dropdowns in the SLA condition builder when the user selects `original_type` as the condition field.

**Permission:** `integrations.connection.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string | Connection to query |

**Response — 200 OK:**

```json
{
  "data": {
    "connection_id": "conn-jira-abc",
    "original_types": [
      "Bug",
      "Incident",
      "Major Incident",
      "Security Finding",
      "Task",
      "Epic",
      "Customer Request"
    ]
  },
  "meta": { "request_id": "req_010", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> Returns only types seen in at least one synced task. An empty array means no tasks have been synced yet for this connection.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |

---

### GET /integrations/connections/:connection_id/type-mapping

Read the current type mapping configuration for a connection.

**Permission:** `integrations.connection.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string | Connection to query |

**Response — 200 OK:**

```json
{
  "data": {
    "connection_id": "conn-jira-abc",
    "mapping": {
      "Incident":          "bug",
      "Major Incident":    "bug",
      "Security Finding":  "bug",
      "Customer Request":  "feature",
      "Task":              "chore"
    }
  },
  "meta": { "request_id": "req_011", "version": "v1", "timestamp": "2026-04-10T15:00:00Z" },
  "error": null
}
```

> Types not present in `mapping` have `task_type: null` after sync. There is no silent fallback.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |

---

### PATCH /integrations/connections/:connection_id/type-mapping

Update the type mapping for a connection. The new mapping replaces the previous one in full. Applied on the next sync run.

**Permission:** `integrations.connection.manage`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string | Connection to update |

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `mapping` | object | ✅ | Keys: raw provider type strings. Values: canonical type — `"bug"` \| `"feature"` \| `"chore"` \| `"spike"` \| `"tech_debt"` |

**Request Example:**

```json
{
  "mapping": {
    "Incident":          "bug",
    "Major Incident":    "bug",
    "Security Finding":  "bug",
    "Customer Request":  "feature",
    "Task":              "chore"
  }
}
```

> To clear a type's mapping, omit its key. Types absent from the mapping will have `task_type: null` after the next sync.

**Response — 200 OK:**

```json
{
  "data": {
    "connection_id": "conn-jira-abc",
    "mapping": {
      "Incident":          "bug",
      "Major Incident":    "bug",
      "Security Finding":  "bug",
      "Customer Request":  "feature",
      "Task":              "chore"
    }
  },
  "meta": { "request_id": "req_012", "version": "v1", "timestamp": "2026-04-10T15:05:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid canonical type value in mapping |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |

---

### POST /integrations/webhooks/:provider/:tenant_id

Receive a provider webhook and enqueue it for async processing.

**Auth:** This endpoint does NOT use Bearer auth. It is authenticated via the `x-webhook-token` header — a shared secret configured per connection.

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `provider` | enum | `jira` \| `github` |
| `tenant_id` | string | The target tenant |

**Headers:**

| Header | Required | Notes |
|---|---|---|
| `x-webhook-token` | ✅ | Shared secret configured in the integration connection |
| `Content-Type` | ✅ | `application/json` |

**Request Body:** Free-form JSON — the raw provider webhook payload.

**Response — 202 Accepted:**

```json
{
  "data": {
    "id": "sync-job-xyz",
    "tenant_id": "ten_1",
    "connection_id": "conn-001",
    "status": "success",
    "created_at": "2026-04-10T14:00:00Z",
    "started_at": "2026-04-10T14:00:00Z",
    "finished_at": "2026-04-10T14:00:01Z",
    "error_summary": null
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T14:00:01Z" },
  "error": null
}
```

> The sync completes synchronously — the job `status` is `"success"` or `"failed"` in the response (not `"queued"`). When failed, `error_summary` contains the reason. Use `GET /integrations/sync-jobs/:id` to retrieve a past job by its `id`.

```json
{
  "data": {
    "event_id": "wh-event-123",
    "provider": "github",
    "tenant_id": "tenant-7a4b",
    "status": "queued"
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T14:10:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Meaning |
|---|---|
| 400 | Unsupported provider or malformed payload |
| 401 | Invalid or missing `x-webhook-token` |

> **Note:** This endpoint is called by the external provider (GitHub/Jira), not by your frontend. Document it for backend/DevOps setup reference.

---

### GET /integrations/webhooks/events/:event_id

Check the processing status of a received webhook event.

**Permission:** `integrations.read`

**Response — 200 OK:**

```json
{
  "data": {
    "event_id": "wh-event-123",
    "provider": "github",
    "tenant_id": "tenant-7a4b",
    "status": "processed",
    "event_type": "pull_request.closed",
    "received_at": "2026-04-10T14:10:00Z",
    "processed_at": "2026-04-10T14:10:04Z",
    "error_message": null
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T14:15:00Z" },
  "error": null
}
```

**Webhook Event Status Values:**

| Value | Meaning |
|---|---|
| `queued` | Waiting to be processed |
| `processing` | Being handled |
| `processed` | Handled successfully |
| `failed` | Processing failed |
| `skipped` | Event type not handled |

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Event not found |

---

## Incident Management Providers

OpsGenie and incident.io connections feed the **DORA MTTR and MTTA** metrics. Unlike task/deploy providers, these connectors sync `IncidentEvent` records — not tasks or projects.

> **`mttr_source` in DORA Scorecard:** If the tenant has no active `opsgenie` or `incident_io` connection, the scorecard returns `mttr_source: "not_configured"` and `mttr`, `mtta`, `incident_frequency` are all `null`. The overall DORA level is still computed from the other three metrics — the tenant is not penalised.

---

### Connecting OpsGenie

**Credential shape:**

```json
{
  "auth_type": "api_key",
  "api_key": "<opsgenie-api-key>"
}
```

**Scope shape:**

```json
{
  "use_incident_api": true,
  "field_mapping": {
    "severity_to_priority": {
      "P1": "P1",
      "P2": "P2",
      "P3": "P3",
      "P4": "P4",
      "P5": "P5"
    },
    "include_priorities": ["P1", "P2"]
  }
}
```

| Scope field | Required | Notes |
|---|---|---|
| `use_incident_api` | ✅ | `true` = Incident API (Standard/Enterprise plans); `false` = Alert API (Essentials) |
| `field_mapping.severity_to_priority` | ✅ | Maps OpsGenie priority labels to canonical P1–P5 |
| `field_mapping.include_priorities` | ❌ | Which priorities to sync (default: `["P1","P2"]`) |
| `field_mapping.production_indicator` | ❌ | How to detect production incidents (`{ type: "tag", value: "production" }`) |
| `field_mapping.affected_service_field` | ❌ | Where to read `affectedServices` from the payload |

**Full POST example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "opsgenie",
  "credentials": {
    "auth_type": "api_key",
    "api_key": "og_api_xxxxxxxx"
  },
  "scope": {
    "use_incident_api": true,
    "field_mapping": {
      "severity_to_priority": {
        "P1": "P1",
        "P2": "P2",
        "P3": "P3",
        "P4": "P4",
        "P5": "P5"
      },
      "include_priorities": ["P1", "P2"],
      "production_indicator": { "type": "tag", "value": "production" }
    }
  }
}
```

**OpsGenie webhook setup:**
Set `x-webhook-token` header to the value of the `OPSGENIE_WEBHOOK_TOKEN` env var and point the OpsGenie outbound integration to `POST /api/v1/integrations/webhooks/opsgenie/:tenant_id`.

---

### Connecting incident.io

**Credential shape:**

```json
{
  "auth_type": "bearer",
  "api_key": "<incident-io-api-key>"
}
```

**Scope shape:**

```json
{
  "field_mapping": {
    "severity_to_priority": {
      "Critical": "P1",
      "Major": "P2",
      "Minor": "P3"
    },
    "include_priorities": ["P1", "P2"]
  }
}
```

| Scope field | Required | Notes |
|---|---|---|
| `field_mapping.severity_to_priority` | ✅ | Maps incident.io severity names to canonical P1–P5. Use the `/severities` wizard endpoint to get available names. |
| `field_mapping.include_priorities` | ❌ | Which priorities to sync after mapping (default: `["P1","P2"]`) |
| `field_mapping.production_indicator` | ❌ | Filter for production incidents |
| `field_mapping.affected_service_field` | ❌ | Custom field key for affected services |
| `field_mapping.opened_at_field` | ❌ | Field to use as `openedAt` (default `created_at`) |

**Full POST example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "incident_io",
  "credentials": {
    "auth_type": "bearer",
    "api_key": "inc_io_xxxxxxxx"
  },
  "scope": {
    "field_mapping": {
      "severity_to_priority": {
        "Critical": "P1",
        "Major": "P2",
        "Minor": "P3"
      },
      "include_priorities": ["P1", "P2"],
      "production_indicator": { "type": "field", "field": "environment", "value": "production" }
    }
  }
}
```

**incident.io webhook setup:**
Set `x-webhook-token` header to `INCIDENT_IO_WEBHOOK_TOKEN` and configure the incident.io outbound webhook to `POST /api/v1/integrations/webhooks/incident_io/:tenant_id`.

---

### Field Mapping Wizard Endpoints

Use these before or after saving the connection to populate the `severity_to_priority` mapping UI.

#### GET /integrations/connections/:connection_id/incident-io/severities

Fetch the live severity list from the tenant's incident.io account.

**Permission:** `integrations.connection.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string (UUID) | Active `incident_io` connection ID |

**Response — 200 OK:**

```json
{
  "data": {
    "connection_id": "conn-uuid-001",
    "severities": [
      { "id": "sev-1", "name": "Critical", "rank": 1, "description": "Total service outage" },
      { "id": "sev-2", "name": "Major",    "rank": 2, "description": "Significant impact" },
      { "id": "sev-3", "name": "Minor",    "rank": 3, "description": "Partial degradation" }
    ]
  },
  "meta": { "request_id": "req_w01", "version": "v1", "timestamp": "2026-04-14T10:00:00Z" },
  "error": null
}
```

Use `name` as the left-hand key in `severity_to_priority`. Render rows sorted by ascending `rank`.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Connection is not `incident_io` or has no credentials |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |
| 502 | `BAD_GATEWAY` | incident.io API returned an error |

---

#### GET /integrations/connections/:connection_id/opsgenie/priorities

Return the static OpsGenie priority list (no API call required — priorities are system-defined).

**Permission:** `integrations.connection.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `connection_id` | string (UUID) | Active `opsgenie` connection ID |

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
  "meta": { "request_id": "req_w02", "version": "v1", "timestamp": "2026-04-14T10:00:00Z" },
  "error": null
}
```

Use `name` as the left-hand key in `severity_to_priority`. Since OpsGenie priorities are static, there is no live API call — the response is always the same five values.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Connection is not `opsgenie` |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Connection not found |

---

### Field Mapping Wizard UI Flow

```
1. User selects provider: "OpsGenie" or "incident.io"

2. User enters credentials and saves connection:
   POST /integrations/connections  →  201 { data: { id: "conn-uuid", ... } }

3. Show "Configure Field Mapping" step (non-blocking — MTTR unavailable until done):

   For incident.io:
     GET /integrations/connections/:conn_id/incident-io/severities
     → [{ name: "Critical", rank: 1 }, { name: "Major", rank: 2 }, ...]
     Render dropdown mapping:
       Critical → [P1 ▼]
       Major    → [P2 ▼]
       Minor    → [P3 ▼]

   For OpsGenie:
     GET /integrations/connections/:conn_id/opsgenie/priorities
     → [{ name: "P1" }, { name: "P2" }, ...]
     Render dropdown mapping:
       P1 → [P1 ▼]  (pre-filled: OpsGenie P1–P5 maps 1:1 by default)
       P2 → [P2 ▼]
       ...

4. User saves mapping:
   PATCH /integrations/connections/:conn_id
   body: { "tenant_id": "ten_1", "scope": { "field_mapping": { ... } } }
   →  200

5. Trigger first sync:
   POST /integrations/sync-jobs  body: { connection_id, mode: "full" }
   →  202
```

> MTTR/MTTA will appear in the DORA scorecard after the first successful sync with a configured `field_mapping`.

---

## Common Types

### Provider

| Value | Notes |
|---|---|
| `jira` | Atlassian Jira Cloud or Server — syncs tasks, epics, projects, users |
| `github` | GitHub Cloud — syncs PRs, issues, releases, users |
| `opsgenie` | Atlassian OpsGenie — syncs incidents/alerts as `IncidentEvent` (MTTR/MTTA) |
| `incident_io` | incident.io — syncs incidents as `IncidentEvent` (MTTR/MTTA) |

### Auth Type

| Value | Use Case |
|---|---|
| `oauth2` | OAuth2 flow (client_id + client_secret or tokens) |
| `token` | Personal access token or API key |
| `app` | GitHub App (private key PEM) |

### Secret Strategy

| Value | Meaning |
|---|---|
| `inline_encrypted` | Secret was submitted inline and is encrypted at rest |
| `vault_ref` | Secret is referenced from an external vault |

### Canonical Task Types

| Value | Notes |
|---|---|
| `bug` | Defects and incidents — counted in DORA MTTR; tracked in breach cost |
| `feature` | New functionality — tracked in lead time; COGS rolled up by epic |
| `chore` | Maintenance and operational work |
| `spike` | Research and investigation; excluded from velocity |
| `tech_debt` | Accumulated technical debt; monitored for accumulation |
| `null` | Unknown type — no canonical classification. SLA can still apply via `original_type`. |

---

## Type Mapping Settings UI

This flow covers two distinct surfaces: the **connection settings screen** (type mapping config) and the **SLA template builder** (condition value picker).

### Connection settings — type mapping configuration

```
1. GET /integrations/connections/:id/original-types
   → ["Bug", "Incident", "Security Finding", "Task", "Epic", "Customer Request"]
   (per-connection: shows types from this specific provider only)

2. GET /integrations/connections/:id/type-mapping
   → current mapping for pre-population

3. Render a mapping table (one row per discovered type):
   ┌────────────────────┬────────────────────┐
   │ Type in Jira       │ Canonical type     │
   ├────────────────────┼────────────────────┤
   │ Bug                │ [bug       ▼]      │
   │ Incident           │ [bug       ▼]      │
   │ Security Finding   │ [bug       ▼]      │
   │ Customer Request   │ [feature   ▼]      │
   │ Task               │ [chore     ▼]      │
   │ Epic               │ (no mapping)       │
   └────────────────────┴────────────────────┘
   Dropdown values: bug | feature | chore | spike | tech_debt | (no mapping)

4. PATCH /integrations/connections/:id/type-mapping
   → send only the rows the user mapped; omit "(no mapping)" rows
```

Use the per-connection endpoint here because the user is configuring a specific provider: they need to see exactly the types Jira (or GitHub) sends, not a mix from other connections.

### SLA condition builder — `original_type` value picker

```
1. GET /integrations/original-types   (← tenant-scoped, no connection_id needed)
   → ["Bug", "Customer Request", "Incident", "Major Incident", "Security Finding", "Task"]
   (union of ALL connections — matches the scope of the SLA template)

2. Populate the value picker/datalist:
   Campo:    [original_type  ▼]
   Operador: [in             ▼]
   Valor:    [Incident       ▼]  ← from GET /integrations/original-types
             [Major Incident ▼]  ← multi-select
```

Use the tenant-scoped endpoint here because SLA templates apply across all connections. Showing a per-connection slice would hide valid types and mislead the user into thinking the condition is connection-scoped (it isn't).

### Connection Status

| Value | Meaning |
|---|---|
| `active` | Connection is valid and operational |
| `error` | Last sync or auth check failed |
| `revoked` | Credentials were invalidated |
