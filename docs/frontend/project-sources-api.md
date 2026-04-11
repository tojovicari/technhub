# Project Sources API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

A **ProjectSource** é o vínculo explícito entre um projeto CTO.ai e uma fonte externa de dados — um board do JIRA ou um repositório do GitHub.

Sem esse vínculo, o sistema não sabe de onde deve buscar epics, tasks, PRs e deploys para um projeto. Com ele, um único projeto pode agregar **múltiplos boards JIRA e múltiplos repos GitHub** ao mesmo tempo.

```
Project "Platform"
  ├── [jira]   PLAT          ← JIRA board "Platform"
  ├── [github] acme/platform-api
  └── [github] acme/platform-infra
```

---

## Use Cases

| Cenário | Como usar |
|---|---|
| Conectar um board JIRA a um projeto | `POST /sources` com `provider: "jira"` e `external_id: "PLAT"` |
| Conectar um repo GitHub a um projeto | `POST /sources` com `provider: "github"` e `external_id: "acme/platform-api"` |
| Um projeto com N repos | Criar um `ProjectSource` por repo |
| Listar as fontes de um projeto | `GET /core/projects/:project_id/sources` |
| Remover uma integração | `DELETE /core/projects/:project_id/sources/:source_id` |
| Ver fontes ao carregar um projeto | Includas em `GET /core/projects/:project_id` → campo `sources[]` |
| Listar apenas iniciativas (criadas manualmente) | `GET /core/projects?is_initiative=true` |
| Listar apenas projetos auto-importados | `GET /core/projects?is_initiative=false` |
| Promover um repo auto-importado a iniciativa | `PATCH /core/projects/:project_id` com `{ "is_initiative": true }` |

> **Impacto nos dados:** ao criar uma fonte, o worker de sync passa a considerar esse vínculo na próxima coleta — epics e tasks importados do JIRA/GitHub serão associados a esse projeto. Métricas DORA (deployment frequency, lead time) são calculadas por repositório GitHub vinculado.

---

## Permissões

| Rota | Método | Permissão necessária |
|---|---|---|
| `/core/projects` | GET | `core.project.read` |
| `/core/projects/:project_id` | GET | `core.project.read` |
| `/core/projects/:project_id` | PATCH | `core.project.manage` |
| `/core/projects/:project_id/sources` | GET | `core.project.read` |
| `/core/projects/:project_id/sources` | POST | `core.project.manage` |
| `/core/projects/:project_id/sources/:source_id` | DELETE | `core.project.manage` |

> Todas as rotas são automaticamente escopadas ao `tenant_id` do JWT. Não é possível acessar dados de outro tenant.

---

## Schema: ProjectSource

| Campo | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | string (UUID) | não | Identificador da relação |
| `tenant_id` | string (UUID) | não | Tenant ao qual pertence |
| `project_id` | string (UUID) | não | FK → Project |
| `provider` | enum | não | `"jira"` ou `"github"` |
| `external_id` | string | não | JIRA: project key (ex: `"AUTH"`). GitHub: full name (ex: `"acme/platform-api"`) |
| `display_name` | string | **sim** | Label opcional para exibição |
| `created_at` | ISO 8601 datetime | não | Data de criação |

**Unicidade:** a combinação `(project_id, provider, external_id)` é única — não é possível adicionar a mesma fonte duas vezes ao mesmo projeto.

### O que é `external_id`?

| Provider | Valor de `external_id` | Exemplo |
|---|---|---|
| `jira` | Chave do projeto JIRA (project key) | `"AUTH"`, `"PLAT"`, `"BACKEND"` |
| `github` | Full name do repositório (`org/repo`) | `"acme/platform-api"`, `"my-org/monorepo"` |

---

## Schema: Project (atualizado)

O objeto `Project` retornado por `GET /core/projects/:project_id` agora inclui os campos `sources` e `is_initiative`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string (UUID) | — |
| `tenant_id` | string (UUID) | — |
| `key` | string | Chave curta única (ex: `PLAT`) |
| `name` | string | — |
| `is_initiative` | boolean | `true` = iniciativa visível para o time; `false` = projeto técnico/auto-importado |
| `team_id` | string (UUID) \| null | Time responsável |
| `status` | enum | `planning` \| `active` \| `on_hold` \| `done` |
| `start_date` | ISO datetime \| null | — |
| `target_end_date` | ISO datetime \| null | — |
| `sync_config` | object \| null | Opções de sync (free-form) |
| `custom_fields` | object \| null | Campos extras |
| `tags` | string[] | — |
| `team` | Team \| null | Embedded — presente se `team_id` definido |
| `sources` | ProjectSource[] | Lista de fontes externas vinculadas — incluso apenas no detalhe |
| `epic_count` | integer | Computed — total de epics |
| `task_count` | integer | Computed — total de tasks |

**Semântica de `is_initiative`:**

| Valor | Quando ocorre |
|---|---|
| `true` | Projeto criado manualmente via `POST /core/projects` (default) |
| `false` | Projeto criado automaticamente pelo worker de sync (ex: repos GitHub importados) |
| `true` (promovido) | Projeto auto-importado que o usuário marcou explicitamente como iniciativa via `PATCH` |

> Um projeto `is_initiative: false` pode ter todas as características técnicas de uma iniciativa — sources, epics, métricas. A flag é apenas sobre **intenção de visibilidade**, não sobre estrutura.

> `sources` só é incluído em `GET /core/projects/:project_id` (detalhe). Nos resultados de listagem (`GET /core/projects`), o campo `sources` não está presente — use o detalhe do projeto ou o endpoint dedicado.

---

## Endpoints

---

### GET /core/projects

Lista projetos do tenant. Suporta filtro por `is_initiative`.

**Permissão:** `core.project.read`

**Query Params:**

| Param | Tipo | Default | Notas |
|---|---|---|---|
| `is_initiative` | boolean | — | Omitir = retorna todos; `true` = só iniciativas; `false` = só auto-importados |
| `limit` | integer | 25 | Máx 100 |
| `cursor` | string | — | Cursor de paginação (campo `next_cursor` da resposta anterior) |

**Exemplos:**

```
GET /core/projects                    → todos os projetos
GET /core/projects?is_initiative=true → apenas iniciativas
GET /core/projects?is_initiative=false → apenas auto-importados
```

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "proj-aa1234",
        "tenant_id": "tenant-7a4b",
        "key": "PLAT",
        "name": "Platform Overhaul Q2",
        "is_initiative": true,
        "status": "active",
        "team_id": "team-c1d2e3",
        "tags": ["q2"],
        "epic_count": 12,
        "task_count": 87
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "req_p_list", "version": "v1", "timestamp": "2026-04-11T10:00:00Z" },
  "error": null
}
```

---

### PATCH /core/projects/:project_id

Atualiza campos de um projeto — incluindo a promoção de um auto-importado para iniciativa.

**Permissão:** `core.project.manage`

**Request Body** (todos os campos opcionais):

| Campo | Tipo | Notas |
|---|---|---|
| `name` | string | — |
| `is_initiative` | boolean | `true` promove; `false` rebaixa |
| `status` | enum | `planning` \| `active` \| `on_hold` \| `done` |
| `team_id` | string (UUID) \| null | — |
| `start_date` | ISO datetime \| null | — |
| `target_end_date` | ISO datetime \| null | — |
| `tags` | string[] | — |

**Exemplo — promover repo auto-importado a iniciativa:**

```json
{ "is_initiative": true, "name": "Platform Core" }
```

**Response — 200 OK:** objeto `Project` atualizado.

**Erros:**

| Status | Code | Quando |
|---|---|---|
| 400 | `BAD_REQUEST` | Campo com tipo inválido |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão `core.project.manage` |
| 404 | `NOT_FOUND` | Projeto não encontrado neste tenant |

---

### GET /core/projects/:project_id/sources

Lista todas as fontes externas de um projeto.

**Permissão:** `core.project.read`

**Path Params:**

| Param | Tipo | Notas |
|---|---|---|
| `project_id` | string (UUID) | ID do projeto |

**Response — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "src-a1b2c3",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "jira",
        "external_id": "PLAT",
        "display_name": "Platform Board",
        "created_at": "2026-04-10T20:00:00Z"
      },
      {
        "id": "src-d4e5f6",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "github",
        "external_id": "acme/platform-api",
        "display_name": null,
        "created_at": "2026-04-10T20:01:00Z"
      },
      {
        "id": "src-g7h8i9",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "github",
        "external_id": "acme/platform-infra",
        "display_name": "Infra repo",
        "created_at": "2026-04-11T09:00:00Z"
      }
    ]
  },
  "meta": {
    "request_id": "req_ps_001",
    "version": "v1",
    "timestamp": "2026-04-11T10:00:00Z"
  },
  "error": null
}
```

> A lista retorna **todos** os registros (sem paginação) — um projeto normalmente tem poucos vínculos.

**Erros:**

| Status | Code | Quando |
|---|---|---|
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão `core.project.read` |
| 404 | `NOT_FOUND` | Projeto não encontrado neste tenant |

---

### POST /core/projects/:project_id/sources

Vincula uma fonte externa (JIRA board ou repo GitHub) ao projeto.

**Permissão:** `core.project.manage`

**Idempotência:** re-enviar a mesma combinação `(provider, external_id)` para o mesmo projeto **não cria duplicata** — atualiza apenas o `display_name`. Seguro para chamar múltiplas vezes.

**Path Params:**

| Param | Tipo | Notas |
|---|---|---|
| `project_id` | string (UUID) | ID do projeto |

**Request Body:**

| Campo | Tipo | Obrigatório | Notas |
|---|---|---|---|
| `provider` | enum | ✅ | `"jira"` ou `"github"` |
| `external_id` | string | ✅ | JIRA project key ou GitHub `org/repo` |
| `display_name` | string | ❌ | Label de exibição opcional |

**Exemplo — vincular JIRA:**

```json
{
  "provider": "jira",
  "external_id": "PLAT",
  "display_name": "Platform Board"
}
```

**Exemplo — vincular GitHub:**

```json
{
  "provider": "github",
  "external_id": "acme/platform-api"
}
```

**Response — 201 Created:**

```json
{
  "data": {
    "id": "src-d4e5f6",
    "tenant_id": "tenant-7a4b",
    "project_id": "proj-aa1234",
    "provider": "github",
    "external_id": "acme/platform-api",
    "display_name": null,
    "created_at": "2026-04-11T10:05:00Z"
  },
  "meta": {
    "request_id": "req_ps_002",
    "version": "v1",
    "timestamp": "2026-04-11T10:05:00Z"
  },
  "error": null
}
```

> Se a fonte já existia, a resposta ainda é `201` com o registro atualizado.

**Erros:**

| Status | Code | Quando |
|---|---|---|
| 400 | `BAD_REQUEST` | `provider` ou `external_id` ausente; `provider` com valor inválido |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão `core.project.manage`; ou `tenant_id` do projeto não coincide com o do JWT |
| 404 | `NOT_FOUND` | Projeto não encontrado neste tenant |

**Validações de `external_id`:**

| Provider | Formato esperado | Exemplos válidos | Exemplos inválidos |
|---|---|---|---|
| `jira` | String alfanumérica (project key) | `AUTH`, `PLAT`, `BACKEND01` | String vazia |
| `github` | `org/repo` (full name) | `acme/api`, `my-org/mono-repo` | `api` (sem org), String vazia |

> O backend aceita qualquer string não-vazia. A validação de existência no provider externo ocorre no worker de sync, não nesta chamada.

---

### DELETE /core/projects/:project_id/sources/:source_id

Remove um vínculo de fonte externa do projeto.

**Permissão:** `core.project.manage`

> **Atenção:** remover uma fonte não apaga os epics/tasks já importados. O efeito é que novos syncs deixarão de importar dados dessa fonte para esse projeto.

**Path Params:**

| Param | Tipo | Notas |
|---|---|---|
| `project_id` | string (UUID) | ID do projeto |
| `source_id` | string (UUID) | ID do `ProjectSource` (campo `id` retornado pelo GET/POST) |

**Response — 204 No Content**

Sem corpo na resposta.

**Erros:**

| Status | Code | Quando |
|---|---|---|
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |
| 403 | `FORBIDDEN` | Sem permissão `core.project.manage` |
| 404 | `NOT_FOUND` | `source_id` não encontrado, ou não pertence a este `project_id` e tenant |

---

### GET /core/projects/:project_id — campo `sources` (atualizado)

O endpoint de detalhe de projeto foi atualizado e agora retorna `sources[]` embedded.

**Response — 200 OK (exemplo completo):**

```json
{
  "data": {
    "id": "proj-aa1234",
    "tenant_id": "tenant-7a4b",
    "key": "PLAT",
    "name": "Platform Overhaul Q2",
    "is_initiative": true,
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
    "sources": [
      {
        "id": "src-a1b2c3",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "jira",
        "external_id": "PLAT",
        "display_name": "Platform Board",
        "created_at": "2026-04-10T20:00:00Z"
      },
      {
        "id": "src-d4e5f6",
        "tenant_id": "tenant-7a4b",
        "project_id": "proj-aa1234",
        "provider": "github",
        "external_id": "acme/platform-api",
        "display_name": null,
        "created_at": "2026-04-10T20:01:00Z"
      }
    ],
    "epic_count": 12,
    "task_count": 87
  },
  "meta": {
    "request_id": "req_ps_003",
    "version": "v1",
    "timestamp": "2026-04-11T10:00:00Z"
  },
  "error": null
}
```

> Quando nenhuma fonte foi cadastrada, `sources` retorna `[]` (array vazio).

---

## Fluxo recomendado (frontend)

```
1. Listar iniciativas (tela principal)
   GET /core/projects?is_initiative=true

2. Criar nova iniciativa
   POST /core/projects → is_initiative: true por default

3. Vincular fontes
   POST /core/projects/{proj-id}/sources  (JIRA)
   POST /core/projects/{proj-id}/sources  (GitHub repo 1)
   POST /core/projects/{proj-id}/sources  (GitHub repo 2)

4. Exibir iniciativa com fontes
   GET /core/projects/{proj-id} → campo sources[] já incluso

5. Gerenciar fontes na tela de configuração
   GET  /core/projects/{proj-id}/sources     → lista atual
   POST /core/projects/{proj-id}/sources     → adicionar
   DELETE /core/projects/{proj-id}/sources/{src-id} → remover

6. Promover repo auto-importado a iniciativa
   GET  /core/projects?is_initiative=false   → listar candidatos
   PATCH /core/projects/{proj-id}  { "is_initiative": true }
```

---

## Compatibilidade

| Aspecto | Classificação |
|---|---|
| Mudança no `GET /core/projects/:project_id` | **Non-breaking** — `sources` é campo novo/adicional |
| Novos endpoints (`/sources`) | **Non-breaking** — endpoints novos |
| Remoção de `repository_ids` (doc only) | **Non-breaking** — nunca foi exposto na API |

Nenhuma migração é necessária por parte do frontend para código existente. O campo `sources` pode ser consumido opcionalmente.

---

## Changelog

| Data | Mudança |
|---|---|
| 2026-04-11 | Introdução de `ProjectSource`: novo modelo, 3 endpoints, `sources[]` no detalhe de projeto |
| 2026-04-11 | Introdução de `is_initiative`: flag de intenção no `Project`; filtro `?is_initiative` no `GET /core/projects`; campo editável via `PATCH /core/projects/:id` |
