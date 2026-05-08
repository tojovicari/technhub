# Gestão de Usuários — Fluxo de Convite

**Base URL:** `/api/v1`  
**Versão:** v1  
**Última atualização:** 2026-05-08

---

## Visão Geral

O sistema separa dois conceitos distintos que precisam ser entendidos antes de qualquer implementação:

| Entidade          | O que representa                                                                                                     | Onde vive                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `User` (core)     | Colaborador da equipe — dev, manager, etc. Alimentado por integrações (Jira, GitHub). Usado em métricas, DORA, COGS. | `POST /core/users`                                    |
| `PlatformAccount` | Conta de acesso à plataforma — quem faz login no moasy.tech. Possui senha, JWT, roles e permissões.                  | `POST /auth/register` ou `POST /auth/register/invite` |

> Um `PlatformAccount` pode estar vinculado a um `User` via `core_user_id`. Esse vínculo é feito **automaticamente** quando o email do convite já existe como `User` no tenant.

---

## Dois Caminhos de Criação de Conta

### 1. Primeiro usuário do tenant — `POST /auth/register`

Cria um novo tenant + primeira conta, que recebe automaticamente o role `org_admin`.

- **Não** usa convite.
- A conta é criada com `is_active: false`.
- Um email de verificação é enviado automaticamente.
- O login é **bloqueado** até a confirmação via `POST /auth/verify-email`.
- Retorna `409 TENANT_ALREADY_EXISTS` se o `tenant_id` já estiver em uso — nesse caso, usar o fluxo de convite.

### 2. Membros adicionais — fluxo de convite

Todo usuário adicional ao tenant precisa ser **convidado**. Não há como criar uma conta diretamente sem um token de convite.

---

## Fluxo de Convite Completo

```
[org_admin]
    │
    ▼
POST /auth/invites
 ├── Cria registro Invite no DB (token hasheado, TTL 48h)
 ├── Enfileira email para o convidado (worker assíncrono)
 └── Retorna invite_token em texto puro (ÚNICO MOMENTO — não há como recuperá-lo depois)
    │
    ▼
[Worker de email]
 └── Envia email com link: APP_BASE_URL/register?token=<invite_token>
    │
    ▼
[Convidado clica no link]
    │
    ▼
POST /auth/register/invite
 ├── Valida token (hash SHA256 + expiresAt + usedAt)
 ├── Cria PlatformAccount com is_active: true (sem verificação extra)
 ├── Vincula ao core User se email já existir no tenant → core_user_id
 └── Marca invite como usedAt (não pode ser reutilizado)
```

> **Por que não há verificação de email para convites?**  
> A posse do email já é provada implicitamente: apenas quem recebeu o email possui o token. Verificação extra seria redundante e criaria fricção desnecessária.

---

## API: Criar Convite

### `POST /auth/invites` 🔒

**Auth:** `Authorization: Bearer <access_token>` + permissão `iam.invite.manage`  
**Quem pode chamar:** apenas `org_admin`

**Request Body:**

| Field   | Type   | Required | Default  | Notes                                |
| ------- | ------ | -------- | -------- | ------------------------------------ |
| `email` | string | ✅       | —        | E-mail do convidado                  |
| `role`  | string | ❌       | `viewer` | `org_admin` \| `manager` \| `viewer` |

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
    "invite_token": "a3f8e2c1d4b5...",
    "expires_at": "2026-05-10T19:00:00.000Z"
  },
  "meta": {
    "request_id": "req-6",
    "version": "v1",
    "timestamp": "2026-05-08T19:00:00Z"
  },
  "error": null
}
```

> ⚠️ O `invite_token` é retornado **apenas nesta resposta**. O servidor armazena apenas o hash — não há como recuperá-lo. O email já é enviado automaticamente; não é necessário repassar o token manualmente.

**Erros:**

| Status | Code               | Quando                            |
| ------ | ------------------ | --------------------------------- |
| `400`  | `VALIDATION_ERROR` | Email inválido ou role inválido   |
| `401`  | `UNAUTHORIZED`     | Token ausente ou inválido         |
| `403`  | `FORBIDDEN`        | Sem permissão `iam.invite.manage` |

---

## API: Aceitar Convite

### `POST /auth/register/invite`

**Auth:** Public — nenhum token necessário

> `email`, `role` e `tenant_id` são lidos do convite — o convidado informa apenas senha e nome.

**Request Body:**

| Field          | Type   | Required | Notes                                 |
| -------------- | ------ | -------- | ------------------------------------- |
| `invite_token` | string | ✅       | Token recebido via email              |
| `password`     | string | ✅       | Mín. 8 chars, ≥1 maiúscula, ≥1 dígito |
| `full_name`    | string | ✅       | Nome de exibição                      |

**Request Example:**

```json
{
  "invite_token": "a3f8e2c1d4b5...",
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
    "created_at": "2026-05-08T19:05:00.000Z"
  },
  "meta": {
    "request_id": "req-7",
    "version": "v1",
    "timestamp": "2026-05-08T19:05:00Z"
  },
  "error": null
}
```

> `core_user_id`: preenchido automaticamente se o email já existir como `User` core no tenant. Pode ser `null` se não houver vínculo.  
> `is_active: true` — conta já ativa, pronta para login imediatamente.

**Erros:**

| Status | Code                   | Quando                                         |
| ------ | ---------------------- | ---------------------------------------------- |
| `400`  | `VALIDATION_ERROR`     | Senha fraca ou campos ausentes                 |
| `400`  | `INVALID_INVITE_TOKEN` | Token inválido, expirado (48h) ou já utilizado |
| `409`  | `EMAIL_TAKEN`          | E-mail do convite já possui conta cadastrada   |

---

## Perfis de Acesso (Roles)

Todo `PlatformAccount` possui um role, definido no momento do convite. As permissões correspondentes são incluídas automaticamente no JWT ao fazer login.

| Role        | Permissões                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_admin` | `["*"]` — acesso total, incluindo `iam.invite.manage` (único que pode convidar)                                                                   |
| `manager`   | `core.read`, `core.write`, `dora.read`, `sla.read`, `cogs.read`, `intel.read`, `integrations.read`, `iam.permission_profile.read`, `billing.read` |
| `viewer`    | `core.read`, `dora.read`, `sla.read`, `intel.read`, `billing.read`                                                                                |

> Além dos roles base, é possível atribuir **Permission Profiles** customizados via IAM para ampliar o acesso de um usuário específico (ex: um `viewer` que precisa de `cogs.read`). Veja seção [IAM — Permission Profiles](#iam--permission-profiles) abaixo.

---

## JWT — Estrutura

Após login, todas as chamadas autenticadas usam `Authorization: Bearer <access_token>`.

```json
{
  "sub": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
  "tenant_id": "acme-corp",
  "roles": ["manager"],
  "permissions": [
    "core.read",
    "core.write",
    "dora.read",
    "sla.read",
    "cogs.read",
    "intel.read",
    "integrations.read",
    "iam.permission_profile.read",
    "billing.read"
  ],
  "platform_role": null,
  "iat": 1775761802,
  "exp": 1775765402
}
```

> `platform_role`: `"super_admin"` | `"platform_admin"` | `null`. Usado exclusivamente para rotas do módulo `/platform/*` (admin da plataforma). Usuários comuns de tenant sempre recebem `null`.

**TTLs:**

| Token                    | TTL    | Renovação                                             |
| ------------------------ | ------ | ----------------------------------------------------- |
| `access_token` (JWT)     | 1 hora | Via `POST /auth/refresh`                              |
| `refresh_token` (opaque) | 7 dias | Rotativo — cada uso emite um novo e revoga o anterior |

---

## IAM — Permission Profiles

Além dos roles base, `org_admin` pode criar profiles customizados e atribuí-los a usuários específicos.

### Criar um profile customizado

**`POST /iam/permission-profiles`** — requer `iam.permission_profile.manage`

```json
{
  "tenant_id": "acme-corp",
  "name": "Finance Viewer",
  "description": "Acesso read-only a COGS e Intel para parceiros financeiros",
  "permission_keys": ["cogs.read", "intel.read", "core.project.read"],
  "is_active": true
}
```

> Profiles com `is_system: true` são built-in e **não podem ser modificados ou deletados**.

### Atribuir um profile a um usuário

**`POST /iam/users/:user_id/permission-profiles`** — requer `iam.permission_profile.assign`

> ⚠️ **`:user_id` aqui é o `PlatformAccount.id`** — o `id` retornado no login (`POST /auth/login`), no registro via convite (`POST /auth/register/invite`) ou em `GET /auth/me`. **Não** é o `id` do `User` core retornado por `GET /core/users`.

```json
{
  "tenant_id": "acme-corp",
  "permission_profile_id": "profile-finance-viewer",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

> `expires_at` é opcional — se informado, o acesso é revogado automaticamente na data indicada.  
> A operação é **idempotente (upsert)** — atribuir o mesmo profile duas vezes atualiza `granted_at` em vez de retornar erro.

### Revogar

**`DELETE /iam/users/:user_id/permission-profiles/:profile_id`** — requer `iam.permission_profile.assign`

> `:user_id` é o `PlatformAccount.id` (mesmo que na atribuição).

Retorna `204 No Content`.

---

## Permission Keys — Referência Completa

> **Importante — dois níveis de keys:**
>
> - **Role permissions** (`core.read`, `core.write`, etc.) são as keys incluídas automaticamente no JWT com base no role do usuário. Elas controlam acesso às rotas que checam exatamente essas strings.
> - **Granular keys** (`core.user.read`, `core.user.manage`, etc.) são usadas em **Permission Profiles** customizados para acesso específico. Elas são verificadas por exact match — `core.read` no JWT **não** satisfaz um guard que exige `core.user.read`.
> - `*` (wildcard) concede tudo — satisfaz qualquer guard.

### Keys usadas nas Roles padrão

| Role        | Keys no JWT                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_admin` | `*`                                                                                                                                               |
| `manager`   | `core.read`, `core.write`, `dora.read`, `sla.read`, `cogs.read`, `intel.read`, `integrations.read`, `iam.permission_profile.read`, `billing.read` |
| `viewer`    | `core.read`, `dora.read`, `sla.read`, `intel.read`, `billing.read`                                                                                |

### Granular Keys para Permission Profiles

| Módulo          | Key                             | O que concede                            |
| --------------- | ------------------------------- | ---------------------------------------- |
| **Core**        | `core.user.read`                | Ver usuários                             |
|                 | `core.user.manage`              | Criar/atualizar usuários                 |
|                 | `core.team.read`                | Ver times e membros                      |
|                 | `core.team.manage`              | Criar/editar times e membros             |
|                 | `core.project.read`             | Ver projetos                             |
|                 | `core.project.manage`           | Criar/editar projetos                    |
|                 | `core.epic.read`                | Ver epics                                |
|                 | `core.epic.manage`              | Criar/editar epics                       |
|                 | `core.task.read`                | Ver tasks                                |
|                 | `core.task.write`               | Criar/atualizar tasks                    |
| **DORA**        | `dora.read`                     | Ver scorecard, deploys e histórico       |
|                 | `dora.deploy.ingest`            | Ingestão de eventos de deploy            |
| **SLA**         | `sla.template.read`             | Ver templates e instâncias               |
|                 | `sla.template.manage`           | Criar/editar/deletar templates           |
|                 | `sla.evaluate`                  | Trigger de avaliação de SLA              |
| **COGS**        | `cogs.read`                     | Ver entradas, rollup, burn-rate, budgets |
|                 | `cogs.write`                    | Criar entradas de custo e estimativas    |
|                 | `cogs.budget.manage`            | Criar/atualizar budgets                  |
| **Intel**       | `intel.read`                    | Todos os endpoints de Intel              |
| **Integrações** | `integrations.read`             | Ver sync jobs e webhook events           |
|                 | `integrations.manage`           | Criar conexões e rotacionar secrets      |
|                 | `integrations.sync`             | Triggerar sync jobs                      |
| **IAM**         | `iam.permission_profile.read`   | Listar profiles                          |
|                 | `iam.permission_profile.manage` | Criar/editar profiles                    |
|                 | `iam.permission_profile.assign` | Atribuir/revogar profiles                |
| **Wildcard**    | `*`                             | Tudo (admin)                             |

---

## Usuários Core vs. PlatformAccounts — Relação e Vínculo

Um `User` (core) e um `PlatformAccount` são entidades independentes que podem ser vinculadas:

```
User (core)                    PlatformAccount
─────────────────              ──────────────────────────
id: "usr-abc"                  id: "acc-xyz"
email: "carlos@acme.io"  ◄──  email: "carlos@acme.io"
role: "engineer"               role: "manager"
tenant_id: "acme-corp"         core_user_id: "usr-abc"  ←── vínculo
```

- O vínculo é criado **automaticamente** no momento do `POST /auth/register/invite` se os emails coincidirem.
- Um `User` core pode existir sem `PlatformAccount` (colaborador não-ativo na plataforma).
- Um `PlatformAccount` pode ter `core_user_id: null` se não houver `User` core com aquele email.

### `GET /core/users` — campos de status de conta

A listagem de usuários core inclui campos que indicam o vínculo com uma conta na plataforma:

| Campo         | Tipo           | Descrição                                                        |
| ------------- | -------------- | ---------------------------------------------------------------- |
| `has_account` | boolean        | Se existe um `PlatformAccount` vinculado (pelo email + tenant)   |
| `account_id`  | string \| null | ID do `PlatformAccount` vinculado (`null` se não houver vínculo) |

> Os campos `is_active` e `role` presentes aqui pertencem ao `User` core (sincronizado via integrações), não à `PlatformAccount`. Para o status de acesso na plataforma, use `has_account` / `account_id`.

---

## Restrições e Comportamentos Importantes

| Comportamento                         | Detalhe                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Quem pode convidar**                | Apenas `org_admin` (permissão `iam.invite.manage`)                                        |
| **Token de convite**                  | Visível apenas na resposta do `POST /auth/invites`. Hash armazenado no DB — irrecuperável |
| **TTL do convite**                    | 48 horas a partir da criação                                                              |
| **Convite expirado**                  | Retorna `400 INVALID_INVITE_TOKEN` — o `org_admin` precisa gerar um novo                  |
| **Convite já usado**                  | Retorna `400 INVALID_INVITE_TOKEN` — cada token é de uso único                            |
| **Email já cadastrado**               | Retorna `409 EMAIL_TAKEN` — o email já possui uma `PlatformAccount`                       |
| **Role padrão**                       | Se `role` não for informado no convite, o padrão é `viewer`                               |
| **Verificação de email**              | Não obrigatória para convidados — `is_active: true` desde o cadastro                      |
| **Verificação de email (1º usuário)** | Obrigatória — `is_active: false` até confirmar via `POST /auth/verify-email`              |
| **Isolamento por tenant**             | Todas as operações são filtradas automaticamente pelo `tenant_id` do JWT                  |
| **`tenant_id` no body**               | Sempre deve bater com o `tenant_id` do JWT — retorna `403` se divergir                    |

---

## Casos de Uso Típicos para o Frontend

### Tela de convite (org_admin)

```
1. Exibir formulário: email + role (select: org_admin | manager | viewer)
2. POST /auth/invites  →  201 Created
3. Exibir confirmação: "Convite enviado para <email>"
   (o email é enviado automaticamente pelo sistema — não precisa exibir o token)
```

### Página de aceite do convite (link no email)

```
URL recebida: /register?token=<invite_token>

1. Extrair token da query string
2. Exibir formulário: full_name + password
3. POST /auth/register/invite { invite_token, password, full_name }
4. 201 → redirecionar para login
   400 INVALID_INVITE_TOKEN → exibir "Convite inválido ou expirado. Solicite um novo convite."
   409 EMAIL_TAKEN → exibir "Este email já possui uma conta. Faça login."
```

### Listar usuários com status de acesso

```
GET /core/users
→  usar campos has_account + account_id
   para indicar na UI quem já acessa a plataforma e quem ainda não tem conta
```

### Atribuir acesso extra a um usuário (ex: viewer que precisa ver COGS)

```
1. GET /iam/permission-profiles  →  listar profiles disponíveis
2. POST /iam/users/:account_id/permission-profiles
   (⚠️ :account_id = PlatformAccount.id — vem do login, register/invite ou GET /auth/me)
   {
     "tenant_id": "<tenant_id do JWT>",
     "permission_profile_id": "profile-finance-viewer",
     "expires_at": "2026-12-31T23:59:59Z"   ← opcional
   }
3. 201 Created → acesso concedido
```
