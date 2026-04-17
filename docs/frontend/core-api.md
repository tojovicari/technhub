# Core API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>` unless noted otherwise.

---

## Authentication

```
Authorization: Bearer <jwt_token>
```

The JWT payload contains:
```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "roles": ["admin"],
  "permissions": ["core.task.read", "core.task.write"]
}
```

Every request is automatically scoped to the `tenant_id` in the JWT — you cannot query other tenants' data.

---

## Response Envelope

All responses follow this wrapper:

```json
// Success
{
  "data": <resource or list>,
  "meta": {
    "request_id": "req_abc123",
    "version": "v1",
    "timestamp": "2026-04-10T12:00:00.000Z"
  },
  "error": null
}

// Failure
{
  "data": null,
  "meta": { "request_id": "req_abc123", "version": "v1", "timestamp": "..." },
  "error": {
    "code": "NOT_FOUND",
    "message": "Task not found"
  }
}
```

---

## Permissions Summary

| Route | Method | Required Permission |
|---|---|---|
| `/core/teams` | POST | `core.team.manage` |
| `/core/teams/:team_id/members` | GET | `core.team.read` |
| `/core/teams/:team_id/members` | POST | `core.team.manage` |
| `/core/teams/:team_id/members/:user_id` | DELETE | `core.team.manage` |
| `/core/projects` | POST | `core.project.manage` |
| `/core/projects` | GET | `core.project.read` |
| `/core/projects/:project_id` | GET | `core.project.read` |
| `/core/projects/:project_id/sources` | GET | `core.project.read` |
| `/core/projects/:project_id/sources` | POST | `core.project.manage` |
| `/core/projects/:project_id/sources/:source_id` | DELETE | `core.project.manage` |
| `/core/epics` | POST | `core.epic.manage` |
| `/core/epics` | GET | `core.epic.read` |
| `/core/epics/:epic_id` | GET | `core.epic.read` |
| `/core/tasks` | POST | `core.task.write` |
| `/core/tasks` | GET | `core.task.read` |
| `/core/tasks/:task_id` | GET | `core.task.read` |
| `/core/tasks/:task_id` | PATCH | `core.task.write` |
| `/core/tasks/:task_id/dependencies` | GET | `core.task.read` |
| `/core/tasks/:task_id/dependencies` | POST | `core.task.manage` |
| `/core/tasks/:task_id/dependencies/:blocked_id` | DELETE | `core.task.manage` |
| `/core/summary` | GET | `core.task.read` |
| `/core/users` | POST | `core.user.manage` |
| `/core/users` | GET | `core.user.read` |

---

## Pagination

List endpoints return cursor-based pagination:

```json
{
  "data": {
    "items": [...],
    "next_cursor": "uuid-of-last-item"
  }
}
```

- Pass `cursor=<next_cursor>` to fetch the next page.
- `next_cursor: null` means this is the last page.
- Default page size: **25**. Max: **100** (use `limit` param).

---

## Endpoints

---

### POST /core/teams

Create a new team.

**Permission:** `core.team.manage`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Must match JWT `tenant_id` |
| `name` | string | ✅ | — | Team display name |
| `description` | string | ❌ | null | Optional free text |
| `lead_id` | string (UUID) | ❌ | null | User UUID — team lead |
| `budget_quarterly` | number | ❌ | null | Quarterly budget in base currency |
| `tags` | string[] | ❌ | `[]` | Arbitrary labels |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "name": "Platform Engineering",
  "description": "Owns infra, pipelines, and DX",
  "lead_id": "user-f31a9b",
  "budget_quarterly": 250000,
  "tags": ["backend", "infra"]
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "team-c1d2e3",
    "tenant_id": "tenant-7a4b",
    "name": "Platform Engineering",
    "description": "Owns infra, pipelines, and DX",
    "lead_id": "user-f31a9b",
    "budget_quarterly": 250000,
    "tags": ["backend", "infra"]
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing required fields or invalid format |
| 401 | `UNAUTHORIZED` | Invalid or missing token |
| 403 | `FORBIDDEN` | Permission denied or tenant mismatch |

---

### GET /core/teams/:team_id/members

List all members of a team, with embedded user details.

**Permission:** `core.team.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `team_id` | string (UUID) | The team to fetch members for |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "membership-id",
        "team_id": "team-c1d2e3",
        "user_id": "user-f31a9b",
        "tenant_id": "tenant-7a4b",
        "joined_at": "2026-01-15T09:00:00Z",
        "user": {
          "id": "user-f31a9b",
          "tenant_id": "tenant-7a4b",
          "email": "alice@acme.io",
          "full_name": "Alice Chen",
          "role": "engineer",
          "is_active": true,
          "created_at": "2025-11-01T00:00:00Z"
        }
      }
    ]
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Invalid or missing token |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Team not found |

---

### POST /core/teams/:team_id/members

Add a user to a team.

**Permission:** `core.team.manage`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `user_id` | string (UUID) | ✅ | Must be a valid user in the same tenant |

**Request Example:**

```json
{ "user_id": "user-88bc" }
```

**Response — 201 Created:**

```json
{
  "data": {
    "team_id": "team-c1d2e3",
    "user_id": "user-88bc"
  },
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid UUID |
| 401 | `UNAUTHORIZED` | Invalid or missing token |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Team or user not found |

---

### DELETE /core/teams/:team_id/members/:user_id

Remove a user from a team.

**Permission:** `core.team.manage`

**Response — 204 No Content** (empty body)

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | Invalid or missing token |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Membership not found |

---

### POST /core/projects

Create a new project.

**Permission:** `core.project.manage`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Must match JWT `tenant_id` |
| `key` | string | ✅ | — | Unique project key, max 24 chars (e.g. `PLAT`) |
| `name` | string | ✅ | — | Project display name |
| `team_id` | string (UUID) | ❌ | null | Owning team |
| `status` | enum | ❌ | `planning` | `planning` \| `active` \| `on_hold` \| `done` |
| `start_date` | ISO datetime | ❌ | null | e.g. `2026-01-01T00:00:00Z` |
| `target_end_date` | ISO datetime | ❌ | null | Planned completion date |
| `sync_config` | object | ❌ | null | Integration sync settings (free-form) |
| `custom_fields` | object | ❌ | null | Arbitrary key-value pairs |
| `tags` | string[] | ❌ | `[]` | Labels |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "key": "PLAT",
  "name": "Platform Overhaul Q2",
  "team_id": "team-c1d2e3",
  "status": "active",
  "start_date": "2026-04-01T00:00:00Z",
  "target_end_date": "2026-06-30T23:59:59Z",
  "tags": ["q2", "infrastructure"]
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "proj-aa1234",
    "tenant_id": "tenant-7a4b",
    "key": "PLAT",
    "name": "Platform Overhaul Q2",
    "team_id": "team-c1d2e3",
    "status": "active",
    "start_date": "2026-04-01T00:00:00Z",
    "target_end_date": "2026-06-30T23:59:59Z",
    "sync_config": null,
    "custom_fields": null,
    "tags": ["q2", "infrastructure"],
    "team": {
      "id": "team-c1d2e3",
      "name": "Platform Engineering",
      "lead_id": "user-f31a9b",
      "budget_quarterly": 250000,
      "tags": ["backend", "infra"]
    },
    "epic_count": 0,
    "task_count": 0
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `key`/`name`, key too long, invalid date |
| 401 | `UNAUTHORIZED` | Invalid token |
| 403 | `FORBIDDEN` | Permission denied |

---

### GET /core/projects

List all projects for the tenant.

**Permission:** `core.project.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `status` | string | ❌ | — | Filter by status: `planning`, `active`, `on_hold`, `done` |
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string (UUID) | ❌ | — | Pagination cursor |

**Response — 200 OK:** See pagination format above. Each item matches the Project schema.

---

### GET /core/projects/:project_id

Get a single project by ID. The response includes the `sources` array with all associated external sources.

**Permission:** `core.project.read`

**Response:** Single project object (same shape as create response `data`) with `sources: ProjectSource[]`.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Project not found in this tenant |

---

### GET /core/projects/:project_id/sources

List all external sources associated with a project.

**Permission:** `core.project.read`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `project_id` | string (UUID) | Target project |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "src-001",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "jira",
        "external_id": "PLAT",
        "display_name": "Platform Board",
        "created_at": "2026-04-10T20:00:00Z"
      },
      {
        "id": "src-002",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "github",
        "external_id": "acme/platform-api",
        "display_name": null,
        "created_at": "2026-04-10T20:01:00Z"
      }
    ]
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T20:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Project not found |

---

### POST /core/projects/:project_id/sources

Associate an external source (JIRA board or GitHub repo) with a project. Idempotent — re-posting the same `(provider, external_id)` updates `display_name`.

**Permission:** `core.project.manage`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `project_id` | string (UUID) | Target project |

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `provider` | enum | ✅ | `jira` \| `github` |
| `external_id` | string | ✅ | JIRA project key (e.g. `AUTH`) or GitHub `org/repo` (e.g. `acme/platform-api`) |
| `display_name` | string | ❌ | Human-readable label |

**Request Example:**

```json
{
  "provider": "github",
  "external_id": "acme/platform-api",
  "display_name": "Platform API repo"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "src-002",
    "tenant_id": "tenant-7a4b",
    "project_id": "proj-aa1234",
    "provider": "github",
    "external_id": "acme/platform-api",
    "display_name": "Platform API repo",
    "created_at": "2026-04-10T20:01:00Z"
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-10T20:01:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Missing `provider` or `external_id` |
| 404 | `NOT_FOUND` | Project not found |

---

### DELETE /core/projects/:project_id/sources/:source_id

Remove an external source from a project.

**Permission:** `core.project.manage`

**Path Params:**

| Param | Type | Notes |
|---|---|---|
| `project_id` | string (UUID) | Target project |
| `source_id` | string (UUID) | ID of the `ProjectSource` record |

**Response — 204 No Content**

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 404 | `NOT_FOUND` | Source or project not found |

---

### POST /core/epics

Create an epic under a project.

**Permission:** `core.epic.manage`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Must match JWT `tenant_id` |
| `project_id` | string (UUID) | ✅ | — | Parent project |
| `source` | enum | ❌ | `manual` | `jira` \| `github` \| `manual` |
| `source_id` | string | ❌ | null | External ID from provider |
| `name` | string | ✅ | — | Epic title |
| `description` | string | ❌ | null | — |
| `goal` | string | ❌ | null | Business goal description |
| `status` | enum | ❌ | `backlog` | `backlog` \| `active` \| `completed` \| `cancelled` |
| `owner_id` | string (UUID) | ❌ | null | User responsible for the epic |
| `start_date` | ISO datetime | ❌ | null | — |
| `target_end_date` | ISO datetime | ❌ | null | — |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "project_id": "proj-aa1234",
  "name": "Observability Stack Migration",
  "goal": "Replace legacy logging with OpenTelemetry by Q2",
  "status": "active",
  "owner_id": "user-f31a9b",
  "start_date": "2026-04-01T00:00:00Z",
  "target_end_date": "2026-05-31T23:59:59Z"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "epic-bb5678",
    "tenant_id": "tenant-7a4b",
    "project_id": "proj-aa1234",
    "source": "manual",
    "source_id": null,
    "name": "Observability Stack Migration",
    "description": null,
    "goal": "Replace legacy logging with OpenTelemetry by Q2",
    "status": "active",
    "owner_id": "user-f31a9b",
    "total_tasks": 0,
    "completed_tasks": 0,
    "total_story_points": 0,
    "actual_hours": 0,
    "health_score": null,
    "start_date": "2026-04-01T00:00:00Z",
    "target_end_date": "2026-05-31T23:59:59Z",
    "actual_end_date": null
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> **Computed fields (read-only):** `total_tasks`, `completed_tasks`, `total_story_points`, `actual_hours`, `health_score` are derived from tasks and not directly settable.

---

### GET /core/epics

List epics. Scoped to tenant.

**Permission:** `core.epic.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Filter to a specific project |
| `status` | string | ❌ | — | `backlog` \| `active` \| `completed` \| `cancelled` |
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string (UUID) | ❌ | — | Pagination cursor |

---

### GET /core/epics/:epic_id

Get a single epic by ID.

**Permission:** `core.epic.read`

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Epic not found in this tenant |

---

### POST /core/tasks

Create a task.

**Permission:** `core.task.write`

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Must match JWT `tenant_id` |
| `project_id` | string (UUID) | ✅ | — | Parent project |
| `epic_id` | string (UUID) | ❌ | null | Parent epic |
| `source` | enum | ❌ | `manual` | `jira` \| `github` \| `manual` |
| `source_id` | string | ❌ | null | External provider ID |
| `title` | string | ✅ | — | Task title |
| `description` | string | ❌ | null | — |
| `task_type` | enum | ✅ | — | `feature` \| `bug` \| `chore` \| `spike` \| `tech_debt` |
| `priority` | enum | ❌ | `P2` | `P0` \| `P1` \| `P2` \| `P3` \| `P4` |
| `status` | enum | ❌ | `backlog` | `backlog` \| `todo` \| `in_progress` \| `review` \| `done` \| `cancelled` |
| `assignee_id` | string (UUID) | ❌ | null | Assigned user |
| `reporter_id` | string (UUID) | ❌ | null | Reporter user |
| `story_points` | integer | ❌ | null | Fibonacci-scale estimate |
| `hours_estimated` | number | ❌ | null | Estimated hours |
| `due_date` | ISO datetime | ❌ | null | — |
| `related_pr_ids` | string[] | ❌ | `[]` | PR identifiers (e.g. `"PR-1042"`) |
| `tags` | string[] | ❌ | `[]` | — |
| `custom_fields` | object | ❌ | null | Free-form key-value metadata |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "project_id": "proj-aa1234",
  "epic_id": "epic-bb5678",
  "title": "Add OTLP exporter to API service",
  "task_type": "feature",
  "priority": "P1",
  "status": "in_progress",
  "assignee_id": "user-88bc",
  "story_points": 5,
  "hours_estimated": 8,
  "due_date": "2026-04-25T23:59:59Z",
  "tags": ["observability"]
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "task-cc9012",
    "tenant_id": "tenant-7a4b",
    "source": "manual",
    "source_id": null,
    "project_id": "proj-aa1234",
    "epic_id": "epic-bb5678",
    "title": "Add OTLP exporter to API service",
    "description": null,
    "task_type": "feature",
    "priority": "P1",
    "status": "in_progress",
    "assignee_id": "user-88bc",
    "reporter_id": null,
    "story_points": 5,
    "hours_estimated": 8,
    "hours_actual": null,
    "started_at": null,
    "completed_at": null,
    "due_date": "2026-04-25T23:59:59Z",
    "cycle_time_hours": null,
    "project": { "id": "proj-aa1234", "name": "Plataforma v2", "key": "PLT" },
    "related_pr_ids": [],
    "tags": ["observability"],
    "custom_fields": null
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> **Computed fields (read-only):** `started_at`, `completed_at`, `cycle_time_hours`, `hours_actual` — managed automatically by the platform.
>
> **Note on `sla_status`:** this field was previously referenced in the response but was never emitted. SLA status is owned by the SLA module — see `GET /sla/compliance` for per-task SLA data.

---

### GET /core/tasks

List tasks. Scoped to tenant.

**Permission:** `core.task.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `project_id` | string (UUID) | ❌ | — | Filter to a project |
| `epic_id` | string (UUID) | ❌ | — | Filter to an epic |
| `assignee_id` | string (UUID) | ❌ | — | Filter by assignee |
| `status` | string | ❌ | — | One value **or** comma-separated list: `in_progress,review` |
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string (UUID) | ❌ | — | Pagination cursor |

**Multi-value status example:**

```
GET /api/v1/core/tasks?status=in_progress,review&limit=10
```

Each task in the response now includes an embedded `project` object:

```json
"project": { "id": "proj-aa1234", "name": "Plataforma v2", "key": "PLT" }
```

---

### GET /core/tasks/:task_id

Get a single task by ID.

**Permission:** `core.task.read`

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Task not found in this tenant |

---

### PATCH /core/tasks/:task_id

Update a task (partial update — only send what changed).

**Permission:** `core.task.write`

**Request Body (all fields optional):**

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `title` | string | ❌ | Min length 1 |
| `description` | string | ❌ | — |
| `priority` | enum | ❌ | `P0`–`P4` |
| `status` | enum | ❌ | `backlog` \| `todo` \| `in_progress` \| `review` \| `done` \| `cancelled` |
| `assignee_id` | string (UUID) | ✅ | Send `null` to unassign |
| `story_points` | integer | ✅ | Send `null` to clear |
| `hours_estimated` | number | ✅ | Send `null` to clear |
| `hours_actual` | number | ✅ | Log actual time worked |
| `due_date` | ISO datetime | ✅ | Send `null` to remove due date |
| `tags` | string[] | ❌ | Replaces existing tag list |
| `custom_fields` | object | ❌ | Merges with existing fields |

**Request Example:**

```json
{
  "status": "done",
  "hours_actual": 9.5,
  "story_points": 5
}
```

**Response — 200 OK:** Updated task object (same shape as create response).

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Invalid field values |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Task not found in this tenant |

---

### GET /core/tasks/:task_id/dependencies

List all tasks that block the given task (i.e., tasks that must complete before this one can start).

**Permission:** `core.task.read`

**Response — 200 OK:**

```json
{
  "data": {
    "blockers": [
      { "id": "task-aaa", "title": "Setup auth", "status": "in_progress" }
    ],
    "blocked_by_count": 1
  },
  "meta": { "request_id": "req_dep1", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 404 | `NOT_FOUND` | Task not found in this tenant |

---

### POST /core/tasks/:task_id/dependencies

Declare that `:task_id` blocks another task (`:task_id` must finish before `blocked_id` can start).

**Permission:** `core.task.manage`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `blocked_id` | string (UUID) | ✅ | The task that depends on this one |

**Request Example:**

```json
{ "blocked_id": "task-bbb" }
```

**Response — 201 Created:**

```json
{
  "data": { "blocker_id": "task-aaa", "blocked_id": "task-bbb" },
  "meta": { "request_id": "req_dep2", "version": "v1", "timestamp": "2026-04-12T10:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | `blocked_id` equals `:task_id` (self-loop) |
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Blocker or blocked task not found |

---

### GET /core/summary

Aggregate counts for dashboard stat cards. Single call replaces multiple list queries.

**Permission:** `core.task.read`

**Response — 200 OK:**

```json
{
  "data": {
    "tasks": {
      "by_status": {
        "backlog": 12,
        "todo": 5,
        "in_progress": 8,
        "review": 3,
        "done": 47,
        "cancelled": 2
      },
      "total_open": 28
    },
    "projects_active": 4,
    "epics_active": 9
  },
  "meta": { "request_id": "req_sum1", "version": "v1", "timestamp": "2026-04-17T10:00:00Z" },
  "error": null
}
```

> `total_open` = all tasks excluding `done` and `cancelled`.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |

---

### DELETE /core/tasks/:task_id/dependencies/:blocked_id

Remove a blocking dependency between two tasks.

**Permission:** `core.task.manage`

**Response — 204 No Content**

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHORIZED` | — |
| 403 | `FORBIDDEN` | Permission denied |
| 404 | `NOT_FOUND` | Dependency not found |

---

### POST /core/users

Create or update a user (upsert by email).

**Permission:** `core.user.manage`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | Must match JWT `tenant_id` |
| `email` | string (email) | ✅ | Unique per tenant |
| `full_name` | string | ✅ | Display name |
| `role` | string | ✅ | Free-form role label (e.g. `"engineer"`, `"manager"`) |
| `external_id` | string | ❌ | Provider ID from Jira/GitHub for sync matching |

**Request Example:**

```json
{
  "tenant_id": "tenant-7a4b",
  "email": "carlos@acme.io",
  "full_name": "Carlos Mendes",
  "role": "staff-engineer",
  "external_id": "jira-user-4892"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "user-dd3456",
    "tenant_id": "tenant-7a4b",
    "email": "carlos@acme.io",
    "full_name": "Carlos Mendes",
    "role": "staff-engineer",
    "is_active": true,
    "created_at": "2026-04-10T12:00:00Z"
  },
  "meta": { "request_id": "req_007", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

---

### GET /core/users

List all users in the tenant.

**Permission:** `core.user.read`

**Query Params:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| `limit` | integer | ❌ | 25 | Max 100 |
| `cursor` | string (UUID) | ❌ | — | Pagination cursor |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "usr-abc123",
        "tenant_id": "tenant-7a4b",
        "email": "alice@acme.com",
        "full_name": "Alice Smith",
        "role": "lead",
        "source": "jira",
        "has_account": true,
        "account_id": "acc-yyy",
        "created_at": "2026-04-01T00:00:00Z",
        "updated_at": "2026-04-01T00:00:00Z"
      },
      {
        "id": "usr-def456",
        "tenant_id": "tenant-7a4b",
        "email": "bob@acme.com",
        "full_name": "Bob Santos",
        "role": "engineer",
        "source": "github",
        "has_account": false,
        "account_id": null,
        "created_at": "2026-04-05T00:00:00Z",
        "updated_at": "2026-04-05T00:00:00Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_usr1", "version": "v1", "timestamp": "2026-04-13T12:00:00Z" },
  "error": null
}
```

| Field | Type | Notes |
|---|---|---|
| `has_account` | boolean | `true` se existe uma `PlatformAccount` com este email no tenant |
| `account_id` | string \| null | ID da `PlatformAccount` — use como `user_id` nos endpoints do IAM |

> **Frontend flow:** use `has_account: false` para exibir botão "Convidar" (`POST /auth/invites`). Use `account_id` diretamente como `user_id` nos endpoints do IAM para gerenciar permissões.

---

## Common Types

### Project Status
| Value | Meaning |
|---|---|
| `planning` | Not yet started |
| `active` | In progress |
| `on_hold` | Paused |
| `done` | Completed |

### Epic Status
| Value | Meaning |
|---|---|
| `backlog` | Not started |
| `active` | In progress |
| `completed` | Done |
| `cancelled` | Abandoned |

### Task Status
| Value | Meaning |
|---|---|
| `backlog` | Not ready |
| `todo` | Ready to pick |
| `in_progress` | Being worked on |
| `review` | In code review / QA |
| `done` | Completed |
| `cancelled` | Abandoned |

### Task Priority
| Value | Meaning |
|---|---|
| `P0` | Critical / incident |
| `P1` | High |
| `P2` | Normal (default) |
| `P3` | Low |
| `P4` | Lowest |

### Task Type
| Value | Meaning |
|---|---|
| `feature` | New functionality |
| `bug` | Defect fix |
| `chore` | Maintenance work |
| `spike` | Research / discovery |
| `tech_debt` | Technical debt |

### Source
| Value | Meaning |
|---|---|
| `jira` | Synced from Jira |
| `github` | Synced from GitHub |
| `manual` | Created directly in moasy.tech |
