# Comms API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>` unless stated otherwise.

---

## Overview

The Comms module is the platform's **outbound notification system**. It dispatches transactional messages across channels — starting with email, extensible to Slack and WhatsApp.

**Key concepts:**
- Notifications are **enqueued asynchronously** by business modules (auth, SLA, DORA) — the frontend never sends notifications directly.
- A **background worker** picks up queued notifications every 5 seconds (batch of 20), renders the template, and dispatches via the configured provider.
- Failed deliveries are **retried up to 3 times** with exponential backoff before the notification is marked `failed`.
- The routes below give operators **visibility and manual retry** over the queue.

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/comms/notifications` | GET | `comms.notifications.read` |
| `/comms/notifications/:id/retry` | POST | `comms.notifications.retry` |

> Only `org_admin` has these permissions by default. `manager` and `viewer` do not.

---

## Data Types

### Notification Object

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | string (UUID) | ❌ | |
| `channel` | `"email" \| "slack" \| "whatsapp"` | ❌ | Slack and WhatsApp are stubs — not yet active |
| `recipient` | string | ❌ | Email address, Slack user ID, or phone number |
| `template_key` | string | ❌ | One of: `invite`, `email-verification`, `password-reset`, `sla-breach`, `dora-digest` |
| `status` | `"queued" \| "processing" \| "sent" \| "failed"` | ❌ | See lifecycle below |
| `attempts` | integer | ❌ | Delivery attempts so far (resets to `0` on manual retry) |
| `last_error` | string | ✅ | Last error message from the provider |
| `next_retry_at` | ISO 8601 string | ✅ | When the next automatic retry will occur; `null` when `sent` or max attempts reached |
| `sent_at` | ISO 8601 string | ✅ | Timestamp of successful delivery; `null` otherwise |
| `created_at` | ISO 8601 string | ❌ | When the notification was enqueued |

### Notification Lifecycle

```
enqueueNotification()
  └─ status: queued

Worker picks up (every 5s, batch 20)
  └─ status: processing  [optimistic lock — concurrent workers safe]

  ┌── success → status: sent, sent_at: <now>
  └── error
        attempts < 3 → status: queued, next_retry_at: now + backoff
        attempts = 3 → status: failed, next_retry_at: null

POST /comms/notifications/:id/retry
  └─ status: failed → queued, attempts: 0, last_error: null, next_retry_at: null
```

**Backoff schedule:**

| Attempt | Delay before retry |
|---|---|
| 1st failure | 2 min |
| 2nd failure | 4 min |
| 3rd failure | → `failed` (no further auto-retry) |

---

## Endpoints

---

### GET /comms/notifications

List all notifications for the authenticated tenant.

**Permission:** `comms.notifications.read`  
**Scope:** Results are automatically scoped to the JWT's `tenant_id`. Cross-tenant access is not possible.  
**Ordering:** Newest first (`created_at` descending).

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `status` | `"queued" \| "processing" \| "sent" \| "failed"` | ❌ | — | Filter by delivery status |
| `channel` | `"email" \| "slack" \| "whatsapp"` | ❌ | — | Filter by channel |
| `page` | integer (≥ 1) | ❌ | `1` | Page number |
| `per_page` | integer (1–100) | ❌ | `20` | Items per page |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "channel": "email",
        "recipient": "alice@acme.io",
        "template_key": "invite",
        "status": "sent",
        "attempts": 1,
        "last_error": null,
        "next_retry_at": null,
        "sent_at": "2026-04-16T10:05:00.000Z",
        "created_at": "2026-04-16T10:04:55.000Z"
      },
      {
        "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "channel": "email",
        "recipient": "bob@acme.io",
        "template_key": "email-verification",
        "status": "failed",
        "attempts": 3,
        "last_error": "Connection timeout",
        "next_retry_at": null,
        "sent_at": null,
        "created_at": "2026-04-16T09:00:00.000Z"
      }
    ],
    "total": 2,
    "page": 1,
    "per_page": 20
  },
  "meta": {
    "request_id": "req_abc123",
    "version": "v1",
    "timestamp": "2026-04-16T10:10:00.000Z"
  },
  "error": null
}
```

**Error Responses:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid query param (e.g. unknown `status` value) |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Missing `comms.notifications.read` permission |

---

### POST /comms/notifications/:id/retry

Re-enqueue a **`failed`** notification for delivery. Resets `attempts` to `0`.

**Permission:** `comms.notifications.retry`

**Path Parameters:**

| Param | Type | Notes |
|---|---|---|
| `id` | string (UUID) | Notification ID |

**Request Body:** none

**Response — 200 OK:**

```json
{
  "data": {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "status": "queued"
  },
  "meta": {
    "request_id": "req_def456",
    "version": "v1",
    "timestamp": "2026-04-16T10:15:00.000Z"
  },
  "error": null
}
```

> After retry `attempts` is reset to `0` — the notification gets a fresh 3-attempt budget. The worker will deliver within 5 seconds.

**Error Responses:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Missing `comms.notifications.retry` permission |
| 404 | `NOT_FOUND` | Notification not found in this tenant, **or** status is not `failed` |

---

## Available Templates

| `template_key` | Triggered by | Channel | Status |
|---|---|---|---|
| `invite` | `POST /auth/invites` | `email` | ✅ Active |
| `email-verification` | `POST /auth/register` and `POST /auth/verify-email/resend` | `email` | ✅ Active |
| `password-reset` | `POST /auth/password-reset/request` | `email` | ✅ Active |
| `sla-breach` | SLA worker (breach detection) | `email` | ⏸ Template ready — trigger not yet wired |
| `dora-digest` | Scheduled job (weekly) | `email` | ⏸ Template ready — trigger not yet wired |

> Slack and WhatsApp providers exist in the codebase but are stubs — they log a warning and do not deliver. Full implementation is planned for a future phase.

---

## Delivery Behavior

| Aspect | Detail |
|---|---|
| Dispatch | Async — enqueued immediately, delivered by background worker |
| Worker interval | Every 5 seconds, batch of 20 |
| Concurrency safety | Optimistic lock (`queued → processing` via `updateMany`) |
| Max attempts | 3 |
| Backoff | 2 min → 4 min → `failed` |
| Manual retry | `POST /comms/notifications/:id/retry` — resets attempt counter |
| Provider | Resend SMTP (nodemailer) on port 465 (SSL) |

---

## Changelog

| Version | Date | Change |
|---|---|---|
| v1 | 2026-04-13 | Initial release — Resend SMTP, `invite` / `sla-breach` / `dora-digest` templates, admin list + retry routes |
| v1 | 2026-04-16 | `email-verification` template added; `listNotifications` response fields corrected to snake_case; lifecycle diagram added |
| v1 | 2026-04-16 | `password-reset` template added |
