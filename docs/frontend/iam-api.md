# IAM API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

The IAM (Identity and Access Management) module manages **permission profiles** — named sets of permission keys that can be assigned to users. This is the RBAC layer for the entire CTO.ai platform.

**Key concepts:**
- A **Permission Profile** is a named group of permission keys (e.g. `["core.task.read", "dora.read"]`)
- Users are granted access by assigning them one or more profiles
- `is_system: true` profiles are built-in and cannot be modified
- Assignments can be time-bound via `expires_at`

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/iam/permission-profiles` | GET | `iam.permission_profile.read` |
| `/iam/permission-profiles` | POST | `iam.permission_profile.manage` |
| `/iam/permission-profiles/:profile_id` | PATCH | `iam.permission_profile.manage` |
| `/iam/users/:user_id/permission-profiles` | POST | `iam.permission_profile.assign` |
| `/iam/users/:user_id/permission-profiles/:profile_id` | DELETE | `iam.permission_profile.assign` |

---

## Endpoints

---

### GET /iam/permission-profiles

List permission profiles for the tenant.

**Permission:** `iam.permission_profile.read`

**Query Params:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `is_active` | boolean | ❌ | Filter by active status |
| `is_system` | boolean | ❌ | `true` to include only built-in profiles; `false` for tenant-defined only |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "profile-admin",
        "tenant_id": "tenant-7a4b",
        "name": "Admin",
        "description": "Full access to all modules",
        "permission_keys": ["*"],
        "is_system": true,
        "is_active": true,
        "created_at": "2026-04-01T00:00:00Z",
        "updated_at": "2026-04-01T00:00:00Z"
      },
      {
        "id": "profile-engineer",
        "tenant_id": "tenant-7a4b",
        "name": "Engineer",
        "description": "Standard engineer access — tasks, epics, DORA read",
        "permission_keys": [
          "core.task.read",
          "core.task.write",
          "core.epic.read",
          "core.project.read",
          "dora.read"
        ],
        "is_system": false,
        "is_active": true,
        "created_at": "2026-04-10T12:00:00Z",
        "updated_at": "2026-04-10T12:00:00Z"
      }
    ]
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> `permission_keys: ["*"]` means the profile grants all permissions (wildcard — typically reserved for admin).

---

### POST /iam/permission-profiles

Create a new permission profile.

**Permission:** `iam.permission_profile.manage`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Must match JWT `tenant_id` |
| `name` | string | ✅ | — | Profile display name |
| `description` | string | ❌ | null | — |
| `permission_keys` | string[] | ✅ | — | Min 1. List of permission keys to include |
| `is_active` | boolean | ❌ | `true` | Inactive profiles cannot be assigned |

**Permission Key Format:** `<module>.<resource>.<action>` (e.g. `core.task.write`, `dora.read`, `cogs.budget.manage`)

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "name": "Finance Viewer",
  "description": "Read-only access to COGS and Intel modules for finance partners",
  "permission_keys": [
    "cogs.read",
    "intel.read",
    "core.project.read",
    "core.epic.read"
  ],
  "is_active": true
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "profile-finance-viewer",
    "tenant_id": "tenant-7a4b",
    "name": "Finance Viewer",
    "description": "Read-only access to COGS and Intel modules for finance partners",
    "permission_keys": [
      "cogs.read",
      "intel.read",
      "core.project.read",
      "core.epic.read"
    ],
    "is_system": false,
    "is_active": true
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `name` or `permission_keys`, empty array |
| 401 | `UNAUTHORIZED` | Invalid token |
| 403 | `FORBIDDEN` | Permission denied |

---

### PATCH /iam/permission-profiles/:profile_id

Update a permission profile. All fields optional.

**Permission:** `iam.permission_profile.manage`

> System profiles (`is_system: true`) cannot be patched — returns `403`.

**Request Body (all optional):**

| Field | Type | Notes |
|---|---|---|
| `name` | string | New display name |
| `description` | string | New description |
| `permission_keys` | string[] | **Replaces** the entire key list |
| `is_active` | boolean | Deactivate to prevent new assignments |

**Request Example:**

```json
{
  "permission_keys": [
    "cogs.read",
    "intel.read",
    "core.project.read",
    "core.epic.read",
    "core.task.read"
  ]
}
```

**Response — 200 OK:** Updated PermissionProfile object.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Empty `permission_keys` array |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied or attempting to modify a system profile |
| 404 | `NOT_FOUND` | Profile not found |

---

### POST /iam/users/:user_id/permission-profiles

Assign a permission profile to a user.

**Permission:** `iam.permission_profile.assign`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `user_id` | string | The user to assign the profile to |

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | Must match JWT `tenant_id` |
| `permission_profile_id` | string | ✅ | Profile to assign |
| `expires_at` | ISO datetime | ❌ | Optional expiry — auto-revoked after this date |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "permission_profile_id": "profile-finance-viewer",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "assignment-001",
    "tenant_id": "tenant-7a4b",
    "user_id": "user-dd3456",
    "permission_profile_id": "profile-finance-viewer",
    "granted_by": "user-f31a9b",
    "granted_at": "2026-04-10T12:00:00Z",
    "expires_at": "2026-12-31T23:59:59Z",
    "revoked_at": null
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> `granted_by`: Automatically set from the JWT of the caller (the admin who made the request).

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `permission_profile_id` |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | User or profile not found |

---

### DELETE /iam/users/:user_id/permission-profiles/:profile_id

Revoke a permission profile from a user.

**Permission:** `iam.permission_profile.assign`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `user_id` | string | The user |
| `profile_id` | string | The profile assignment to revoke |

**Response — 204 No Content** (empty body)

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Assignment not found |

---

## Permission Keys Reference

### Core Module

| Key | Grants |
|---|---|
| `core.team.read` | View teams and members |
| `core.team.manage` | Create/modify teams and manage members |
| `core.project.read` | View projects |
| `core.project.manage` | Create/modify projects |
| `core.epic.read` | View epics |
| `core.epic.manage` | Create/modify epics |
| `core.task.read` | View tasks |
| `core.task.write` | Create and update tasks |
| `core.user.read` | View users |
| `core.user.manage` | Create/upsert users |

### DORA Module

| Key | Grants |
|---|---|
| `dora.read` | View scorecard, deploys, and history |
| `dora.deploy.ingest` | Ingest deploy events and lead-time records |

### SLA Module

| Key | Grants |
|---|---|
| `sla.template.read` | View templates and instances |
| `sla.template.manage` | Create/modify/delete templates |
| `sla.evaluate` | Trigger SLA evaluation for tasks |

### COGS Module

| Key | Grants |
|---|---|
| `cogs.read` | View entries, rollup, burn-rate, budgets |
| `cogs.write` | Create cost entries and estimates |
| `cogs.budget.manage` | Create/update budgets |

### Intel Module

| Key | Grants |
|---|---|
| `intel.read` | All Intel endpoints (forecast, risk, anomalies, recommendations, capacity) |

### Integrations Module

| Key | Grants |
|---|---|
| `integrations.read` | View sync jobs and webhook events |
| `integrations.manage` | Create connections and rotate secrets |
| `integrations.sync` | Trigger sync jobs |

### IAM Module

| Key | Grants |
|---|---|
| `iam.permission_profile.read` | List profiles |
| `iam.permission_profile.manage` | Create and update profiles |
| `iam.permission_profile.assign` | Assign/revoke profiles to users |

### Wildcard

| Key | Grants |
|---|---|
| `*` | All permissions (admin) |

---

## Common Types

### PermissionProfile

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique identifier |
| `tenant_id` | string | Owner tenant |
| `name` | string | Display name |
| `description` | string \| null | — |
| `permission_keys` | string[] | List of granted permissions |
| `is_system` | boolean | `true` = built-in, not editable |
| `is_active` | boolean | Only active profiles can be assigned |

### UserPermissionProfile (Assignment)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Assignment ID |
| `user_id` | string | Assigned user |
| `permission_profile_id` | string | Profile granted |
| `granted_by` | string | User ID of the admin who granted access |
| `granted_at` | ISO datetime | When access was granted |
| `expires_at` | ISO datetime \| null | Null = no expiry |
| `revoked_at` | ISO datetime \| null | Set when revoked |
