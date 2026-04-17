# Core API — Changelog para o Frontend
**Data:** 2026-04-17  
**Versão:** v1 (sem breaking change — somente adições)

---

## Resumo executivo

| # | Item | Status | Breaking? |
|---|---|---|---|
| 1 | `status` multi-valor em `GET /core/tasks` | ✅ Implementado | Não |
| 2 | `sla_status` filtrável em `GET /core/tasks` | ❌ Não implementado | — |
| 3 | Embed de `project` no response de tasks | ✅ Implementado | Não |
| 4 | `GET /core/summary` (endpoint agregado) | ✅ Implementado | — |

---

## Item 1 — `status` multi-valor em `GET /core/tasks` ✅

### O que foi feito
O parâmetro `status` agora aceita um único valor **ou** uma lista separada por vírgula.

```
# antes — único valor
GET /api/v1/core/tasks?status=in_progress

# agora — múltiplos valores funcionam
GET /api/v1/core/tasks?status=in_progress,review&limit=10
```

### Como funciona
O backend faz split por vírgula, remove espaços extras, e usa `WHERE status IN (...)` no banco. Valor único continua funcionando exatamente igual a antes — nenhuma mudança para quem já usa o endpoint.

### Valores válidos
`backlog` | `todo` | `in_progress` | `review` | `done` | `cancelled`

---

## Item 2 — `sla_status` filtrável ❌ (não implementado)

### O que não foi feito
Filtragem por `sla_status` (ex: `?sla_status=breached,at_risk`) **não foi adicionada** ao `GET /core/tasks`.

### Por que não
`sla_status` é um valor **calculado em runtime** pelo módulo SLA — ele não existe como coluna na tabela `Task`. O módulo Core não tem acesso a essa informação sem cruzar fronteiras de módulo, o que viola o design arquitetural do sistema.

Materializar `sla_status` na tabela `Task` criaria acoplamento direto entre os módulos Core e SLA — qualquer mudança de regra de SLA exigiria migração de schema no Core.

### Alternativa existente
Use `GET /api/v1/sla/compliance` para obter tarefas com `sla_status: breached | at_risk | running | met`. Esse endpoint é o lugar correto para queries baseadas em SLA.

### Sobre o campo no response
O campo `sla_status` foi **removido do response de tasks** na documentação — ele estava listado mas **nunca foi emitido** pelo backend (ausente em `mapTask`). O response de tasks não inclui e nunca incluiu `sla_status`. Esta era uma inconsistência de documentação.

---

## Item 3 — Embed de `project` no response de tasks ✅

### O que foi feito
Todos os endpoints que retornam tasks agora incluem um objeto `project` embutido:

```json
{
  "id": "task-cc9012",
  "project_id": "proj-aa1234",
  "project": {
    "id": "proj-aa1234",
    "name": "Plataforma v2",
    "key": "PLT"
  },
  ...
}
```

Isso se aplica a:
- `GET /core/tasks` (lista)
- `GET /core/tasks/:task_id` (detalhe)

> **Atenção:** `POST /core/tasks` e `PATCH /core/tasks/:task_id` retornam `"project": null` — `createTask` e `updateTask` não fazem `include` do projeto, apenas as queries de leitura. Se o frontend precisar do nome do projeto após criar/atualizar uma task, deve usar o `project_id` retornado para buscar via `GET /core/projects/:id`.

### Por que
Elimina N+1 requests no dashboard de leitura. O frontend consegue exibir nome e key do projeto de cada task sem fazer chamadas adicionais a `/core/projects/:id`.

### Notas de campo
- `project_id` continua presente — campo existente não removido.
- O campo `project` é `{ id, name, key }` nos endpoints GET e `null` nos endpoints POST/PATCH.

---

## Item 4 — `GET /core/summary` ✅

### O que foi feito
Novo endpoint que retorna contadores agregados do tenant em uma única chamada.

```
GET /api/v1/core/summary
Authorization: Bearer <jwt>
```

**Permissão necessária:** `core.task.read`

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

### Campos
| Campo | Tipo | Notas |
|---|---|---|
| `tasks.by_status` | object | Contagem por cada valor de `TaskStatus` presente no tenant. Estados sem tasks são omitidos. |
| `tasks.total_open` | integer | Soma de todos os status exceto `done` e `cancelled`. |
| `projects_active` | integer | Projetos com `status = "active"`. |
| `epics_active` | integer | Epics com `status = "active"`. |

### Por que
Substitui 3 chamadas com `limit=100` que o frontend precisaria fazer para calcular os stat cards do dashboard. O endpoint roda 3 queries agregadas em paralelo via `Promise.all` — eficiente e sem overfetch de payload.
