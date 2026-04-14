# Comms API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

The Comms module is the platform's **outbound notification system**. It dispatches transactional messages (invites, SLA breach alerts, DORA digests) across channels — starting with email, extensible to Slack and WhatsApp.

**Key concepts:**
- Notifications are **enqueued asynchronously** by business modules (auth, SLA, DORA) — the frontend never sends notifications directly
- A background worker processes the queue every 5 seconds, retrying failed deliveries up to 3 times with exponential backoff
- The admin routes below expose **observability and manual retry** for operators

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/comms/notifications` | GET | `comms.notifications.read` |
| `/comms/notifications/:id/retry` | POST | `comms.notifications.retry` |

> These permissions are only granted to roles with operational/admin access. Viewer roles do not have them.

---

## Data Types

### Notification Object

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | ❌ | |
| `channel` | `"email" \| "slack" \| "whatsapp"` | ❌ | Slack and WhatsApp are stubs — not yet active |
| `recipient` | string | ❌ | Email address, Slack user ID, or phone number |
| `template_key` | string | ❌ | One of: `invite`, `sla-breach`, `dora-digest` |
| `status` | `"queued" \| "processing" \| "sent" \| "failed"` | ❌ | |
| `attempts` | integer | ❌ | Number of send attempts so far |
| `last_error` | string | ✅ | Last error message if delivery failed |
| `next_retry_at` | ISO 8601 | ✅ | When the next retry will be attempted (`null` if `sent` or max attempts reached) |
| `sent_at` | ISO 8601 | ✅ | Timestamp of successful delivery |
| `created_at` | ISO 8601 | ❌ | |

---

## Endpoints

---

### GET /comms/notifications

List notifications for the authenticated tenant.

**Permission:** `comms.notifications.read`  
**Scope:** Results are automatically scoped to the JWT's `tenant_id` — no cross-tenant access is possible.

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `status` | `"queued" \| "processing" \| "sent" \| "failed"` | ❌ | — | Filter by status |
| `channel` | `"email" \| "slack" \| "whatsapp"` | ❌ | — | Filter by channel |
| `page` | integer (≥ 1) | ❌ | `1` | Pagination page |
| `per_page` | integer (1–100) | ❌ | `20` | Items per page |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "notif-550e8400-e29b-41d4-a716-446655440000",
        "channel": "email",
        "recipient": "alice@example.com",
        "template_key": "invite",
        "status": "sent",
        "attempts": 1,
        "last_error": null,
        "next_retry_at": null,
        "sent_at": "2026-04-13T14:05:00Z",
        "created_at": "2026-04-13T14:04:55Z"
      },
      {
        "id": "notif-7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "channel": "email",
        "recipient": "bob@example.com",
        "template_key": "sla-breach",
        "status": "failed",
        "attempts": 3,
        "last_error": "SMTP_HOST environment variable is required",
        "next_retry_at": null,
        "sent_at": null,
        "created_at": "2026-04-13T10:00:00Z"
      }
    ],
    "total": 2,
    "page": 1,
    "per_page": 20
  },
  "meta": {
    "request_id": "req_abc123",
    "version": "v1",
    "timestamp": "2026-04-13T14:10:00Z"
  },
  "error": null
}
```

**Error Responses:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid query param value (e.g. unknown status enum) |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Insufficient permissions (`comms.notifications.read` required) |

---

### POST /comms/notifications/:id/retry

Re-enqueue a **failed** notification for delivery.

**Permission:** `comms.notifications.retry`  
**Idempotency:** Safe to call multiple times if status is already `queued` — it will return `404` (i.e., the endpoint is idempotent by design: only `failed` notifications can be retried).

**Path Parameters:**

| Param | Type | Notes |
|---|---|---|
| `id` | string (UUID) | Notification ID |

**Request Body:** none

**Response — 200 OK:**

```json
{
  "data": {
    "id": "notif-7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "status": "queued"
  },
  "meta": {
    "request_id": "req_def456",
    "version": "v1",
    "timestamp": "2026-04-13T14:15:00Z"
  },
  "error": null
}
```

> After a successful retry, `attempts` is reset to `0` and the worker will attempt delivery within 5 seconds.

**Error Responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Insufficient permissions (`comms.notifications.retry` required) |
| 404 | `NOT_FOUND` | Notification does not exist in this tenant, or its status is not `failed` |

---

## Available Templates

| `template_key` | Trigger | Channel |
|---|---|---|
| `invite` | User invited to the platform | `email` |
| `sla-breach` | Task breaches an SLA rule | `email` |
| `dora-digest` | Weekly DORA metrics digest | `email` |

> Slack and WhatsApp providers are provisioned as stubs — they exist in the codebase but log a warning and do not deliver. Full implementation is planned for a future phase.

---

## Delivery Behavior

- **Dispatch:** Async — notifications are enqueued immediately and delivered by the background worker
- **Worker interval:** every 5 seconds, batch of 20
- **Retry policy:** max 3 attempts with exponential backoff (2 min → 4 min → 8 min)
- **Final state:** after 3 failed attempts, status is set to `failed` and no further automatic retries occur; manual retry is available via the endpoint above

---

## Changelog

| Version | Date | Change |
|---|---|---|
| v1 | 2026-04-13 | Initial release — email via SMTP (Nodemailer), invite / sla-breach / dora-digest templates, admin list + retry routes |
