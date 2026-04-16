# Auth API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** Endpoints marked 🔒 require `Authorization: Bearer <JWT>`

---

## Overview

The Auth module handles **platform user authentication** — the people who log in to use moasy.tech (CTOs, Tech Managers, viewers).

> **Important distinction:** `core/users` represents integration-sourced collaborators (devs pulled from GitHub/Jira). Platform accounts (`auth/*`) are the humans operating the moasy.tech dashboard. These are two separate entities.

**Key concepts:**
- Registration creates a `PlatformAccount` with hashed password (no plaintext ever stored)
- Login returns a short-lived **access token** (JWT, 1h) and a long-lived **refresh token** (opaque, 7 days)
- Refresh tokens **rotate on every use** — using a token issues a new one and revokes the old
- JWTs carry `sub`, `tenant_id`, `roles`, and `permissions` — received by all other modules for authorization

**Roles and permissions:**

| Role | Permission keys in JWT |
|---|---|
| `org_admin` | `["*"]` — full access |
| `manager` | `core.read`, `core.write`, `dora.read`, `sla.read`, `cogs.read`, `intel.read`, `integrations.read`, `iam.permission_profile.read` |
| `viewer` | `core.read`, `dora.read`, `sla.read`, `intel.read` |

---

## Endpoints Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | public | Create a new tenant + first account (`org_admin`) — sends verification email |
| `POST` | `/auth/verify-email` | public | Activate account consuming verification token |
| `POST` | `/auth/verify-email/resend` | public | Resend verification email |
| `POST` | `/auth/password-reset/request` | public | Request a password reset link via email |
| `POST` | `/auth/password-reset/confirm` | public | Set a new password using a reset token |
| `POST` | `/auth/login` | public | Authenticate, receive tokens |
| `POST` | `/auth/refresh` | public | Rotate refresh token |
| `POST` | `/auth/logout` | 🔒 | Revoke refresh token |
| `GET` | `/auth/me` | 🔒 | Get current account info (inclui `preferences`) |
| `PATCH` | `/auth/me/preferences` | 🔒 | Update account preferences (locale, theme) |
| `POST` | `/auth/invites` | 🔒 `iam.invite.manage` | Invite a user to the tenant |
| `POST` | `/auth/register/invite` | public | Accept an invite and create account |

---

## Endpoints

---

### POST /auth/register

Cria um novo tenant e o primeiro account, que recebe automaticamente o papel `org_admin`.

> **Fluxo de onboarding:** use este endpoint apenas para criar um tenant novo. Para adicionar membros a um tenant existente, use `POST /auth/invites` + `POST /auth/register/invite`.

> **Verificação de email:** a conta é criada com `is_active: false`. Um email de confirmação é enviado automaticamente. O usuário não consegue fazer login antes de verificar o email via `POST /auth/verify-email`.

**Auth:** Public (no token required)

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tenant_id` | string | ✅ | ID do novo tenant (deve ser único) |
| `email` | string | ✅ | Must be unique globally |
| `password` | string | ✅ | Min 8 chars, ≥1 uppercase, ≥1 digit |
| `full_name` | string | ✅ | Display name |

> `role` não é informado — o primeiro usuário é sempre `org_admin`.

**Request Example:**

```json
{
  "tenant_id": "acme-corp",
  "email": "glauber@example.com",
  "password": "Abcd1234",
  "full_name": "Glauber Vicari"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
    "tenant_id": "acme-corp",
    "email": "glauber@example.com",
    "full_name": "Glauber Vicari",
    "role": "org_admin",
    "is_active": false,
    "core_user_id": null,
    "created_at": "2026-04-09T19:09:42.528Z",
    "message": "Account created. Please check your email to activate your account."
  },
  "meta": { "request_id": "req-1", "version": "v1", "timestamp": "2026-04-09T19:09:42.530Z" },
  "error": null
}
```

> `is_active: false` — a conta fica inativa até o email ser confirmado via `POST /auth/verify-email`. `core_user_id` é preenchido automaticamente se já existir um `User` (colaborador sincronizado) com o mesmo email no tenant — caso contrário, `null`.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Invalid email, weak password, missing fields |
| `409` | `TENANT_ALREADY_EXISTS` | Tenant ID já em uso — use convite para adicionar membros |
| `409` | `EMAIL_TAKEN` | Email already registered |

---

### POST /auth/verify-email

Ativa a conta consumindo o token de verificação enviado por email após o `POST /auth/register`.

**Auth:** Public (no token required)

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `token` | string | ✅ | Token recebido no email de verificação |

**Request Example:**

```json
{
  "token": "a3f8e2c1d4b5..."
}
```

**Response — 200 OK:**

```json
{
  "data": {
    "id": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
    "email": "glauber@example.com",
    "is_active": true
  },
  "meta": { "request_id": "req-v1", "version": "v1", "timestamp": "2026-04-16T10:00:00Z" },
  "error": null
}
```

> Após a verificação, o usuário pode fazer login normalmente via `POST /auth/login`.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Token ausente |
| `400` | `INVALID_VERIFICATION_TOKEN` | Token inválido, expirado (24h) ou já utilizado |

---

### POST /auth/verify-email/resend

Reenvia o email de verificação para uma conta ainda não ativada.

**Auth:** Public (no token required)

> **Anti-enumeration:** a resposta é sempre 200, independentemente de o email existir ou já estar verificado.

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `email` | string | ✅ |

**Request Example:**

```json
{
  "email": "glauber@example.com"
}
```

**Response — 200 OK:**

```json
{
  "data": {
    "message": "If the email exists and is not yet verified, a new confirmation email has been sent."
  },
  "meta": { "request_id": "req-v2", "version": "v1", "timestamp": "2026-04-16T10:05:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Email inválido |

---

### POST /auth/password-reset/request

Request a password reset link. Always returns 200 to prevent email enumeration — even if the email is not registered, the response is identical.

**Auth:** Public

**Request Body:**

```json
{ "email": "alice@acme.io" }
```

**Response — 200 OK:**

```json
{
  "data": { "message": "If the email is registered, a password reset link has been sent." },
  "meta": { "request_id": "req_abc123", "version": "v1", "timestamp": "2026-04-16T12:00:00.000Z" },
  "error": null
}
```

> The reset link is valid for **1 hour**. Multiple requests each generate a new token; previous tokens remain valid until they expire or are consumed.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Email inválido |

---

### POST /auth/password-reset/confirm

Set a new password using the token received by email. Consuming the token also **revokes all active refresh tokens** for the account, forcing all sessions to log in again.

**Auth:** Public

**Request Body:**

```json
{
  "token": "<raw_token_from_email>",
  "password": "NewP@ssw0rd"
}
```

Password rules: min 8 chars, max 128, at least one uppercase letter and one digit.

**Response — 200 OK:**

```json
{
  "data": { "message": "Password updated successfully. Please log in with your new password." },
  "meta": { "request_id": "req_abc124", "version": "v1", "timestamp": "2026-04-16T12:05:00.000Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing or invalid fields |
| `400` | `INVALID_RESET_TOKEN` | Token not found, already used, or expired |

---

### POST /auth/login

Authenticate with email and password.

**Auth:** Public

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `email` | string | ✅ |
| `password` | string | ✅ |

**Request Example:**

```json
{
  "email": "glauber@example.com",
  "password": "Abcd1234"
}
```

**Response — 200 OK:**

```json
{
  "data": {
    "access_token": "eyJhbGci...",
    "refresh_token": "e83d79cb2e30...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "account": {
      "id": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
      "tenant_id": "ten_1",
      "email": "glauber@example.com",
      "full_name": "Glauber Vicari",
      "role": "org_admin"
    }
  },
  "meta": { "request_id": "req-2", "version": "v1", "timestamp": "2026-04-09T19:10:02.329Z" },
  "error": null
}
```

**Usage — store tokens:**
```js
const { access_token, refresh_token } = data;
// Store access_token in memory (not localStorage)
// Store refresh_token in HttpOnly cookie (preferred) or secure storage
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing fields |
| `401` | `INVALID_CREDENTIALS` | Wrong email or password (intentionally generic) |
| `403` | `ACCOUNT_NOT_VERIFIED` | Account exists but email not yet confirmed — redirect to verification flow |

---

### POST /auth/refresh

Exchange a refresh token for a new access token + rotated refresh token.

**Auth:** Public  
**Important:** The old refresh token is revoked. Always store only the newest one.

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `refresh_token` | string | ✅ |

**Request Example:**

```json
{
  "refresh_token": "e83d79cb2e30f7dd5d58..."
}
```

**Response — 200 OK:**

```json
{
  "data": {
    "access_token": "eyJhbGci...",
    "refresh_token": "a1b2c3d4e5...",
    "token_type": "Bearer",
    "expires_in": 3600
  },
  "meta": { "request_id": "req-3", "version": "v1", "timestamp": "2026-04-09T19:11:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing `refresh_token` |
| `401` | `INVALID_REFRESH_TOKEN` | Expired, revoked, or not found |
| `401` | `ACCOUNT_DISABLED` | Account has been deactivated |

---

### POST /auth/logout 🔒

Revoke the provided refresh token. The access token remains valid until it naturally expires (1h).

**Auth:** `Authorization: Bearer <access_token>`

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `refresh_token` | string | ✅ |

**Request Example:**

```json
{
  "refresh_token": "e83d79cb2e30f7dd5d58..."
}
```

**Response — 200 OK:**

```json
{
  "data": { "message": "Logged out successfully" },
  "meta": { "request_id": "req-4", "version": "v1", "timestamp": "2026-04-09T19:12:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Missing `refresh_token` |
| `401` | `UNAUTHORIZED` | Missing or invalid access token |

---

### GET /auth/me 🔒

Returns the full profile of the currently authenticated platform account.

**Auth:** `Authorization: Bearer <access_token>`

**Response — 200 OK:**

```json
{
  "data": {
    "id": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
    "tenant_id": "ten_1",
    "email": "glauber@example.com",
    "full_name": "Glauber Vicari",
    "role": "org_admin",
    "is_active": true,
    "core_user_id": "usr-abc123",
    "last_login_at": "2026-04-09T19:10:02Z",
    "created_at": "2026-04-09T19:09:42Z",
    "preferences": {
      "locale": "pt-BR",
      "theme": "system"
    }
  },
  "meta": { "request_id": "req-5", "version": "v1", "timestamp": "2026-04-09T19:15:00Z" },
  "error": null
}
```

> `preferences` is `null` for accounts that have never set preferences (defaults applied client-side: `locale: pt-BR`, `theme: system`). `core_user_id`: ID do `User` core vinculado (colaborador sincronizado via JIRA/GitHub com o mesmo email). `null` se nenhum vínculo foi encontrado.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing or invalid access token |
| `404` | `NOT_FOUND` | Account deleted or disabled after token was issued |

---

### PATCH /auth/me/preferences 🔒

Update locale and/or theme preferences for the authenticated account. At least one field must be provided. Values are merged with existing preferences — fields not provided are preserved.

**Auth:** `Authorization: Bearer <access_token>`

**Request Body:**

| Field | Type | Required | Values |
|---|---|---|---|
| `locale` | string | ❌ | `"pt-BR"` \| `"en-US"` \| `"es-ES"` |
| `theme` | string | ❌ | `"light"` \| `"dark"` \| `"system"` |

> At least one field must be present. An empty body returns `400 BAD_REQUEST`.

**Request Example:**

```json
{ "theme": "dark" }
```

**Response — 200 OK:**

```json
{
  "data": {
    "preferences": {
      "locale": "pt-BR",
      "theme": "dark"
    }
  },
  "meta": { "request_id": "req-p1", "version": "v1", "timestamp": "2026-04-16T12:00:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `BAD_REQUEST` | Empty body, unknown field, or invalid enum value |
| `401` | `UNAUTHORIZED` | Missing or invalid access token |
| `404` | `NOT_FOUND` | Account not found or inactive |

---

### POST /auth/invites 🔒

Gera um convite para um novo membro ingressar no tenant do chamador. O `invite_token` retornado deve ser enviado ao convidado (por e-mail ou outro canal) — ele não é armazenado em texto puro no servidor.

**Auth:** `Authorization: Bearer <access_token>` + permissão `iam.invite.manage` (role `org_admin`)

**Request Body:**

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `email` | string | ✅ | — | E-mail do convidado |
| `role` | string | ❌ | `viewer` | `org_admin` \| `manager` \| `viewer` |

**Request Example:**

```json
{
  "email": "carlos@acme.io",
  "role": "manager"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "inv-uuid",
    "tenant_id": "acme-corp",
    "email": "carlos@acme.io",
    "role": "manager",
    "invite_token": "a3f8e2c...",
    "expires_at": "2026-04-14T19:00:00.000Z"
  },
  "meta": { "request_id": "req-6", "version": "v1", "timestamp": "2026-04-12T19:00:00Z" },
  "error": null
}
```

> O `invite_token` é retornado **apenas nesta resposta**. Armazene-o ou envie-o imediatamente — não há como recuperá-lo depois.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Email inválido ou role inválido |
| `401` | `UNAUTHORIZED` | Token ausente ou inválido |
| `403` | `FORBIDDEN` | Sem permissão `iam.invite.manage` |

---

### POST /auth/register/invite

Cria uma nova `PlatformAccount` consumindo um token de convite. O convite é invalidado na mesma transação.

**Auth:** Public (no token required)

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `invite_token` | string | ✅ | Token recebido via convite |
| `password` | string | ✅ | Min 8 chars, ≥1 uppercase, ≥1 digit |
| `full_name` | string | ✅ | Display name |

> `email`, `role` e `tenant_id` são lidos do convite — não precisam ser informados.

**Request Example:**

```json
{
  "invite_token": "a3f8e2c...",
  "password": "Abcd1234",
  "full_name": "Carlos Mendes"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "usr-uuid",
    "tenant_id": "acme-corp",
    "email": "carlos@acme.io",
    "full_name": "Carlos Mendes",
    "role": "manager",
    "is_active": true,
    "core_user_id": "usr-abc123",
    "created_at": "2026-04-12T19:05:00.000Z"
  },
  "meta": { "request_id": "req-7", "version": "v1", "timestamp": "2026-04-12T19:05:00Z" },
  "error": null
}
```

> `core_user_id`: preenchido automaticamente se o email do convite já tiver um `User` core no tenant.

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Senha fraca ou campos ausentes |
| `400` | `INVALID_INVITE_TOKEN` | Token inválido, expirado (48h) ou já utilizado |
| `409` | `EMAIL_TAKEN` | E-mail do convite já possui conta |

---

## Token Lifecycle

```
POST /auth/login
  └─ returns access_token (JWT, 1h) + refresh_token (opaque, 7d)

Every API call:
  └─ Authorization: Bearer <access_token>

When access_token expires:
  └─ POST /auth/refresh → new access_token + new refresh_token
     (old refresh_token is revoked immediately)

On user logout:
  └─ POST /auth/logout → refresh_token revoked
     (access_token expires naturally after its TTL)
```

---

## JWT Payload

```json
{
  "sub": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
  "tenant_id": "ten_1",
  "roles": ["org_admin"],
  "permissions": ["*"],
  "iat": 1775761802,
  "exp": 1775765402
}
```

All modules using `app.authenticate` + `app.requirePermission(...)` will validate against this payload automatically.
