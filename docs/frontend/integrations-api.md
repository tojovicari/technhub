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
| `/integrations/sync-jobs` | POST | `integrations.sync` |
| `/integrations/sync-jobs/:job_id` | GET | `integrations.read` |
| `/integrations/webhooks/:provider/:tenant_id` | POST | Public (token-gated — see below) |
| `/integrations/webhooks/events/:event_id` | GET | `integrations.read` |

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

### Connection Status

| Value | Meaning |
|---|---|
| `active` | Connection is valid and operational |
| `error` | Last sync or auth check failed |
| `revoked` | Credentials were invalidated |
