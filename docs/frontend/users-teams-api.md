# Users & Teams API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** Todos os endpoints requerem `Authorization: Bearer <JWT>`.

---

## Visão Geral do Domínio

```
Tenant
 └── User (N)            — pessoa unificada (JIRA + GitHub)
 └── Team (N)            — agrupador de pessoas
      └── TeamMember     — relação N:N entre Team e User
```

- Um `User` pode pertencer a **vários times**.
- Um `Team` pode ter **vários usuários**.
- Toda entidade é isolada por `tenant_id` — você nunca vê dados de outro tenant.
- Um `User` é identificado unicamente pela combinação `email + tenant_id`. Fazer upsert com o mesmo email atualiza o registro existente.

---

## Envelope de Resposta

```json
// Sucesso
{
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "version": "v1",
    "timestamp": "2026-04-10T12:00:00.000Z"
  },
  "error": null
}

// Erro
{
  "data": null,
  "meta": { "request_id": "req_abc123", "version": "v1", "timestamp": "..." },
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found"
  }
}
```

---

## Permissões

| Endpoint | Método | Permissão necessária |
|---|---|---|
| `/core/users` | POST | `core.user.manage` |
| `/core/users` | GET | `core.user.read` |
| `/core/teams` | POST | `core.team.manage` |
| `/core/teams` | GET | `core.team.read` |
| `/core/teams/:team_id/members` | GET | `core.team.read` |
| `/core/teams/:team_id/members` | POST | `core.team.manage` |
| `/core/teams/:team_id/members/:user_id` | DELETE | `core.team.manage` |

Permissões são entregues no JWT:

```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "roles": ["admin"],
  "permissions": ["core.user.read", "core.user.manage", "core.team.read", "core.team.manage"]
}
```

---

## Paginação

Endpoints de listagem usam cursor-based pagination:

```json
{
  "data": {
    "items": [...],
    "next_cursor": "uuid-do-ultimo-item"
  }
}
```

- Passe `cursor=<next_cursor>` para buscar a próxima página.
- `next_cursor: null` indica última página.
- Tamanho padrão: **25**. Máximo: **100** (use o param `limit`).

---

## Schemas

### User

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string (UUID) | Identificador interno |
| `tenant_id` | string (UUID) | Tenant ao qual pertence |
| `email` | string | Email único dentro do tenant |
| `full_name` | string | Nome de exibição |
| `role` | string | Ex: `ic`, `lead`, `manager`, `contractor` |
| `is_active` | boolean | Se o usuário está ativo |
| `created_at` | ISO datetime | Data de criação do registro |

### Team

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string (UUID) | Identificador interno |
| `tenant_id` | string (UUID) | Tenant ao qual pertence |
| `name` | string | Nome de exibição do time |
| `description` | string \| null | Descrição opcional |
| `lead_id` | string (UUID) \| null | Usuário líder do time |
| `budget_quarterly` | number \| null | Budget trimestral (usado em alertas de COGS) |
| `tags` | string[] | Labels: `backend`, `infra`, `mobile`, etc. |

### TeamMember

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | string (UUID) | ID da relação de membro |
| `team_id` | string (UUID) | Time |
| `user_id` | string (UUID) | Usuário |
| `tenant_id` | string (UUID) | Tenant |
| `joined_at` | ISO datetime | Data em que o usuário entrou no time |
| `user` | User | Objeto do usuário embutido |

---

## Endpoints

---

### POST /core/users

Cria ou atualiza um usuário. O upsert é feito pela chave `email + tenant_id` — se o usuário já existir, `full_name` e `role` são atualizados.

**Permissão:** `core.user.manage`

**Request Body:**

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `tenant_id` | string | ✅ | Deve bater com o `tenant_id` do JWT |
| `email` | string | ✅ | Chave de unificação cross-system |
| `full_name` | string | ✅ | Nome de exibição |
| `role` | string | ✅ | Ex: `ic`, `lead`, `manager`, `contractor` |
| `external_id` | string | ❌ | ID externo opcional (ex: JIRA ID) |

**Exemplo de Request:**

```json
{
  "tenant_id": "tenant-7a4b",
  "email": "alice@acme.io",
  "full_name": "Alice Chen",
  "role": "lead"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "user-f31a9b",
    "tenant_id": "tenant-7a4b",
    "email": "alice@acme.io",
    "full_name": "Alice Chen",
    "role": "lead",
    "is_active": true,
    "created_at": "2026-04-10T12:00:00.000Z"
  },
  "meta": { "request_id": "req_001", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> **Nota:** O status retornado é sempre `201`, mesmo quando é uma atualização (upsert).

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 400 | `BAD_REQUEST` | Campo obrigatório ausente, email inválido |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão ou `tenant_id` não bate com o JWT |

---

### GET /core/users

Lista todos os usuários do tenant com paginação por cursor.

**Permissão:** `core.user.read`

**Query Params:**

| Param | Tipo | Obrigatório | Padrão | Notas |
|---|---|---|---|---|
| `limit` | integer | ❌ | 25 | Máximo 100 |
| `cursor` | string (UUID) | ❌ | — | Cursor de paginação |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "user-f31a9b",
        "tenant_id": "tenant-7a4b",
        "email": "alice@acme.io",
        "full_name": "Alice Chen",
        "role": "lead",
        "is_active": true,
        "created_at": "2026-01-15T09:00:00.000Z"
      },
      {
        "id": "user-88bc",
        "tenant_id": "tenant-7a4b",
        "email": "bob@acme.io",
        "full_name": "Bob Lima",
        "role": "ic",
        "is_active": true,
        "created_at": "2026-02-01T10:00:00.000Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_002", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 400 | `BAD_REQUEST` | Parâmetros de query inválidos |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão |

---

### POST /core/teams

Cria um novo time.

**Permissão:** `core.team.manage`

**Request Body:**

| Campo | Tipo | Obrigatório | Padrão | Notas |
|---|---|---|---|---|
| `tenant_id` | string | ✅ | — | Deve bater com o `tenant_id` do JWT |
| `name` | string | ✅ | — | Nome de exibição do time |
| `description` | string | ❌ | null | Descrição livre |
| `lead_id` | string (UUID) | ❌ | null | UUID de um User existente no tenant |
| `budget_quarterly` | number | ❌ | null | Budget trimestral em moeda base |
| `tags` | string[] | ❌ | `[]` | Labels arbitrários |

**Exemplo de Request:**

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
  "meta": { "request_id": "req_003", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 400 | `BAD_REQUEST` | Campo obrigatório ausente ou formato inválido |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão ou `tenant_id` não bate com o JWT |

---

### GET /core/teams

Lista todos os times do tenant com paginação por cursor.

**Permissão:** `core.team.read`

**Query Params:**

| Param | Tipo | Obrigatório | Padrão | Notas |
|---|---|---|---|---|
| `limit` | integer | ❌ | 25 | Máximo 100 |
| `cursor` | string (UUID) | ❌ | — | Cursor de paginação |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "team-c1d2e3",
        "tenant_id": "tenant-7a4b",
        "name": "Platform Engineering",
        "description": "Owns infra, pipelines, and DX",
        "lead_id": "user-f31a9b",
        "budget_quarterly": 250000,
        "tags": ["backend", "infra"]
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_006", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 400 | `BAD_REQUEST` | Parâmetros de query inválidos |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão |

---

### GET /core/teams/:team_id/members

Lista todos os membros de um time com dados do usuário embutidos.

**Permissão:** `core.team.read`

**Path Params:**

| Param | Tipo | Notas |
|---|---|---|
| `team_id` | string (UUID) | UUID do time |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "member-aa1",
        "team_id": "team-c1d2e3",
        "user_id": "user-f31a9b",
        "tenant_id": "tenant-7a4b",
        "joined_at": "2026-01-15T09:00:00.000Z",
        "user": {
          "id": "user-f31a9b",
          "tenant_id": "tenant-7a4b",
          "email": "alice@acme.io",
          "full_name": "Alice Chen",
          "role": "lead",
          "is_active": true,
          "created_at": "2025-11-01T00:00:00.000Z"
        }
      },
      {
        "id": "member-bb2",
        "team_id": "team-c1d2e3",
        "user_id": "user-88bc",
        "tenant_id": "tenant-7a4b",
        "joined_at": "2026-02-10T08:30:00.000Z",
        "user": {
          "id": "user-88bc",
          "tenant_id": "tenant-7a4b",
          "email": "bob@acme.io",
          "full_name": "Bob Lima",
          "role": "ic",
          "is_active": true,
          "created_at": "2026-02-01T10:00:00.000Z"
        }
      }
    ]
  },
  "meta": { "request_id": "req_004", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

> A lista não é paginada — retorna todos os membros do time de uma vez.  
> Os itens são ordenados por `joined_at` crescente.

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão |
| 404 | `NOT_FOUND` | Time não encontrado no tenant |

---

### POST /core/teams/:team_id/members

Adiciona um usuário a um time. Idempotente — adicionar o mesmo usuário duas vezes não gera duplicata.

**Permissão:** `core.team.manage`

**Path Params:**

| Param | Tipo | Notas |
|---|---|---|
| `team_id` | string (UUID) | UUID do time |

**Request Body:**

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `user_id` | string (UUID) | ✅ | Deve ser um usuário válido do mesmo tenant |

**Exemplo de Request:**

```json
{
  "user_id": "user-88bc"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "team_id": "team-c1d2e3",
    "user_id": "user-88bc"
  },
  "meta": { "request_id": "req_005", "version": "v1", "timestamp": "2026-04-10T12:00:00Z" },
  "error": null
}
```

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 400 | `BAD_REQUEST` | `user_id` ausente ou UUID inválido |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão |
| 404 | `NOT_FOUND` | Time ou usuário não encontrado no tenant |

---

### DELETE /core/teams/:team_id/members/:user_id

Remove um usuário de um time. Não exclui o usuário do sistema.

**Permissão:** `core.team.manage`

**Path Params:**

| Param | Tipo | Notas |
|---|---|---|
| `team_id` | string (UUID) | UUID do time |
| `user_id` | string (UUID) | UUID do usuário a ser removido |

**Response — 204 No Content** (corpo vazio)

**Cenários de Erro:**

| Status | Code | Situação |
|---|---|---|
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão |
| 404 | `NOT_FOUND` | Relação de membro não encontrada |

---

## Casos de Uso

### Cadastrar um usuário ao onboarding

```
1. POST /core/users  →  cria o User (ou atualiza se email já existir)
2. Guardar o `id` retornado para uso nos próximos passos
```

### Criar um time e nomear um líder

```
1. POST /core/users   →  garante que o líder existe, guarda o `id`
2. POST /core/teams   →  passa o `lead_id` com o id do passo anterior
```

### Montar a composição de um time

```
1. POST /core/teams                        →  cria o time
2. POST /core/teams/:team_id/members       →  adiciona usuário A
3. POST /core/teams/:team_id/members       →  adiciona usuário B
   (repetir para cada membro)
4. GET  /core/teams/:team_id/members       →  valida a composição final
```

### Exibir membros de um time com detalhes

```
GET /core/teams/:team_id/members
→  retorna lista com objeto `user` embutido em cada item
   (não precisa fazer chamadas separadas por usuário)
```

### Remover um membro de um time

```
DELETE /core/teams/:team_id/members/:user_id
→  remove apenas a relação; o usuário continua existindo no sistema
```

### Listar todos os usuários para um seletor

```
GET /core/users?limit=100
→  usar next_cursor para paginar caso haja mais de 100 usuários
```

---

## Limites e Comportamentos Notáveis

| Comportamento | Detalhe |
|---|---|
| Upsert de usuário | `POST /core/users` com email duplicado **atualiza** em vez de retornar erro |
| Membro duplicado | `POST /core/teams/:id/members` com user já membro é **idempotente** (sem erro, sem duplicata) |
| Isolamento por tenant | Todas as buscas são filtradas automaticamente pelo `tenant_id` do JWT |
| `lead_id` do time | **Não** adiciona automaticamente o líder como membro; chamar `POST members` separadamente se necessário |
| Deletar membro | Não exclui o usuário — apenas desfaz a relação com o time |
| Listagem de membros | Não paginada; retorna todos os membros de uma vez |
| Listagem de usuários | Paginada por cursor; padrão 25, máximo 100 por página |
