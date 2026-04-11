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

> **Impacto nos dados:** ao criar uma fonte, o worker de sync passa a considerar esse vínculo na próxima coleta — epics e tasks importados do JIRA/GitHub serão associados a esse projeto. Métricas DORA (deployment frequency, lead time) são calculadas por repositório GitHub vinculado.

---

## Permissões

| Rota | Método | Permissão necessária |
|---|---|---|
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

O objeto `Project` retornado por `GET /core/projects/:project_id` agora inclui o campo `sources`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string (UUID) | — |
| `tenant_id` | string (UUID) | — |
| `key` | string | Chave curta única (ex: `PLAT`) |
| `name` | string | — |
| `team_id` | string (UUID) \| null | Time responsável |
| `status` | enum | `planning` \| `active` \| `on_hold` \| `done` |
| `start_date` | ISO datetime \| null | — |
| `target_end_date` | ISO datetime \| null | — |
| `sync_config` | object \| null | Opções de sync (free-form) |
| `custom_fields` | object \| null | Campos extras |
| `tags` | string[] | — |
| `team` | Team \| null | Embedded — presente se `team_id` definido |
| `sources` | ProjectSource[] | **Novo** — lista de fontes externas vinculadas |
| `epic_count` | integer | Computed — total de epics |
| `task_count` | integer | Computed — total de tasks |

> `sources` só é incluído em `GET /core/projects/:project_id` (detalhe). Nos resultados de listagem (`GET /core/projects`), o campo `sources` não está presente — use o detalhe do projeto ou o endpoint dedicado.

---

## Endpoints

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
1. Criar projeto
   POST /core/projects → recebe proj-id

2. Vincular fontes
   POST /core/projects/{proj-id}/sources  (JIRA)
   POST /core/projects/{proj-id}/sources  (GitHub repo 1)
   POST /core/projects/{proj-id}/sources  (GitHub repo 2)

3. Exibir projeto com fontes
   GET /core/projects/{proj-id} → campo sources[] já incluso

4. Gerenciar fontes na tela de configuração
   GET  /core/projects/{proj-id}/sources     → lista atual
   POST /core/projects/{proj-id}/sources     → adicionar
   DELETE /core/projects/{proj-id}/sources/{src-id} → remover
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
