# Integrations API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** Most endpoints require `Authorization: Bearer <JWT>`. Webhook ingestion endpoints use a separate token mechanism.

---

## Overview

The Integrations module manages connections to external providers (Jira, GitHub), triggers data sync jobs, and receives provider webhooks.

**Important security note:** Credentials (API tokens, OAuth secrets) are **write-only** — they are never returned in any API response. The API returns `secret_strategy` to indicate how secrets are stored, but never exposes the actual values.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/integrations/connections` | POST | `integrations.manage` |
| `/integrations/connections/:id/secrets` | PUT | `integrations.manage` |
| `/integrations/connections/:id/original-types` | GET | `integrations.connection.read` |
| `/integrations/original-types` | GET | `integrations.connection.read` |
| `/integrations/connections/:id/type-mapping` | GET | `integrations.connection.read` |
| `/integrations/connections/:id/type-mapping` | PATCH | `integrations.connection.manage` |
| `/integrations/sync-jobs` | POST | `integrations.sync` |
| `/integrations/sync-jobs/:job_id` | GET | `integrations.read` |
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

**Permission:** `integrations.manage`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | Must match JWT `tenant_id` |
| `provider` | enum | ✅ | `jira` \| `github` |
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

**Full Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "github",
  "scope": { "org": "acme-corp", "repos": ["platform", "api-service"] },
  "credentials": {
    "auth_type": "token",
    "access_token": "ghp_xxxxxxxxx"
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

**Permission:** `integrations.manage`

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

### POST /integrations/sync-jobs

Trigger a data sync for a connection. The job runs asynchronously.

**Permission:** `integrations.sync`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `connection_id` | string | ✅ | Connection to sync |
| `entity_types` | string[] | ❌ | `["issues", "pull_requests", "releases"]` — omit to sync all |
| `full_sync` | boolean | ❌ | `false` = incremental (default); `true` = full re-sync |
| `since` | ISO datetime | ❌ | Only sync entities updated after this date (incremental) |

**Request Example:**

```json
{
  "connection_id": "conn-001",
  "entity_types": ["pull_requests", "releases"],
  "full_sync": false,
  "since": "2026-04-01T00:00:00Z"
}
```

**Response — 202 Accepted:**

```json
{
  "data": {
    "job_id": "sync-job-xyz",
    "connection_id": "conn-001",
    "status": "queued",
    "entity_types": ["pull_requests", "releases"],
    "full_sync": false,
    "created_at": "2026-04-10T14:00:00Z"
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T14:00:00Z" },
  "error": null
}
```

> `202 Accepted` means the job was queued, not completed. Poll `GET /integrations/sync-jobs/:job_id` to track progress.

---

### GET /integrations/sync-jobs/:job_id

Check the status of a sync job.

**Permission:** `integrations.read`

**Response — 200 OK:**

```json
{
  "data": {
    "job_id": "sync-job-xyz",
    "connection_id": "conn-001",
    "status": "completed",
    "entity_types": ["pull_requests", "releases"],
    "full_sync": false,
    "started_at": "2026-04-10T14:00:05Z",
    "completed_at": "2026-04-10T14:02:30Z",
    "records_synced": 87,
    "errors": [],
    "created_at": "2026-04-10T14:00:00Z"
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T14:05:00Z" },
  "error": null
}
```

**Sync Job Status Values:**

| Value | Meaning |
|---|---|
| `queued` | Waiting in queue |
| `running` | Currently syncing |
| `completed` | Finished successfully |
| `failed` | Finished with errors |
| `partial` | Completed with some errors |

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

## Common Types

### Provider

| Value | Notes |
|---|---|
| `jira` | Atlassian Jira Cloud or Server |
| `github` | GitHub Cloud |

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
