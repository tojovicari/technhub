# API Reference — Dashboards (DORA + Flow)

Os dois endpoints de leitura agregada disponíveis hoje. É a primeira camada de leitura do sistema — tudo mais na API é escrita (cadastro de integrações, disparo de sync, configuração de regras — ver `admin.md`).

## Autenticação

`Authorization: Bearer <accessToken>`. Sem token válido: `401`. Token de um tenant diferente do `:tenantId` da URL: `403`.

**RBAC**: os 3 papéis (`ADMIN`, `GESTOR`, `USUARIO`) podem acessar os dois endpoints — dashboard é visualização, não tem restrição de papel.

## O padrão `available: false`

Algumas métricas ainda não têm dado suficiente pra serem calculadas de verdade. Em vez de omitir o campo ou inventar um número, a API sempre devolve o campo com `available: false` e um `reason` explicando o motivo. Trate isso na UI como "não disponível ainda" (ex: um estado vazio com o texto do `reason`, ou simplesmente ocultar o card), **nunca como erro**.

---

## `GET /tenants/:tenantId/dashboard/dora`

Métricas DORA (Deployment Frequency, Lead Time for Changes, Mean Time to Restore, Change Failure Rate). Escopo: **tenant inteiro por padrão**, mas agora dá pra filtrar por time via `teamId` (ver "Filtro por time" abaixo) — não é mais uma limitação bloqueada, só depende de o admin ter vinculado os recursos daquele time primeiro.

### Query params

| Nome     | Formato       | Obrigatório | Default              |
| -------- | ------------- | ----------- | --------------------- |
| `from`   | ISO 8601 date | Não         | 30 dias atrás de hoje |
| `to`     | ISO 8601 date | Não         | agora                 |
| `teamId` | uuid          | Não         | tenant inteiro (sem filtro) |

Data inválida em `from`/`to` → `400`.

### Exemplo de request

```
GET /tenants/c94be6fb-9a26-488a-a624-fb2c891c1168/dashboard/dora?from=2026-06-23&to=2026-07-23
Authorization: Bearer <accessToken>
```

### Exemplo de resposta (real, capturado em teste)

```json
{
  "period": { "from": "2026-06-23T16:23:32.263Z", "to": "2026-07-23T16:23:32.263Z" },
  "deploymentFrequency": {
    "total": 0,
    "byDay": []
  },
  "leadTimeForChanges": {
    "available": true,
    "avgHours": null,
    "medianHours": null,
    "sampleSize": 0
  },
  "meanTimeToRestore": {
    "available": true,
    "avgHours": 200.81,
    "sampleSize": 65
  },
  "changeFailureRate": {
    "available": false,
    "reason": "Requer correlação deploy→incidente causador, ainda não implementada."
  }
}
```

### Campos

- **`deploymentFrequency`** — sempre disponível.
  - `total`: contagem de deploys pra **produção** no período (`semantic_environment = 'PRODUCTION'`, classificação configurável por `mapping-rules`).
  - `byDay`: série temporal `{ date: "YYYY-MM-DD", count: number }[]`, só com dias que tiveram deploy (dias sem deploy não aparecem no array — não vêm com `count: 0`).
- **`leadTimeForChanges`** — tempo entre abertura e merge de Pull Request.
  - Quando `available: true`: `avgHours`/`medianHours` em horas (`null` se `sampleSize` for `0` — sem PR merged no período, não dá pra tirar média), `sampleSize` = quantos PRs entraram na conta.
  - Gatilho fixo nesta versão: sempre abertura→merge do PR. Não é ainda configurável por time (1º commit, deploy como fim, etc. — ver Limitações).
- **`meanTimeToRestore`** — tempo entre disparo e resolução de incidente (`triggered_at`→`resolved_at`), só incidentes com `resolved_at` preenchido no período.
- **`changeFailureRate`** — **sempre `available: false`** nesta versão (ver Limitações Conhecidas).

### Filtro por time (`?teamId=`)

Quando `teamId` é passado, `deploymentFrequency`, `leadTimeForChanges` e `meanTimeToRestore` ganham um campo extra, **`"scope": "team"`** (ausente quando `teamId` não é passado — não polui a resposta tenant-wide de sempre). É assim que a tela sabe "esse número é real por time", já que as 3 métricas dependem de vínculos manuais que podem não existir ainda pra aquele time (ver `admin.md`, seção "Vínculo de recursos externos a times"):

- **`deploymentFrequency`**: filtra por `enriched_deployments.team_id` — já funciona pra qualquer time com integração de CI/CD associada (é automático, sem vínculo manual necessário).
- **`leadTimeForChanges`**: só conta PR de repositório **já vinculado** àquele time (`POST /teams/:teamId/resource-links`, `resourceType: "github_repository"`). Sem nenhum repo vinculado ainda, `sampleSize: 0` — não é erro, é "ninguém vinculou repo a esse time ainda".
- **`meanTimeToRestore`**: só conta incidente cujo time do Waroom já foi vinculado àquele time da plataforma (`resourceType: "waroom_team"`). Mesma lógica de "zero não é erro" se nada foi vinculado.
- **`changeFailureRate`**: continua sempre `available: false`, com ou sem `teamId`.

```json
// GET .../dashboard/dora?teamId=f67b8639-...&from=2020-01-01&to=2026-12-31 — real, capturado em teste
{
  "period": { "from": "...", "to": "..." },
  "deploymentFrequency": { "total": 1484, "byDay": [...], "scope": "team" },
  "leadTimeForChanges": { "available": true, "avgHours": 22.4, "medianHours": 0.5, "sampleSize": 507, "scope": "team" },
  "meanTimeToRestore": { "available": true, "avgHours": 364.4, "sampleSize": 44, "scope": "team" },
  "changeFailureRate": { "available": false, "reason": "..." }
}
```

---

## `GET /tenants/:tenantId/dashboard/flow`

Flow Metrics (Distribution, Load/WIP, Velocity, Cycle Time). É sempre "agora" (retrato do momento, não uma série temporal).

### Query params

| Nome     | Formato | Obrigatório | Default |
| -------- | ------- | ----------- | ------- |
| `teamId` | uuid    | Não         | tenant inteiro (sem filtro) |

Filtra `distribution`/`wip` por `enriched_work_items.team_id` — funciona pra qualquer time com integração Jira/Linear associada, **sem precisar de nenhum vínculo manual** (diferente de Lead Time/MTTR no DORA). Sem campo `scope` aqui — as duas métricas de Flow são igualmente filtráveis, não tem a mistura "uma é real por time, outra não" que o DORA tem.

### Exemplo de request

```
GET /tenants/c94be6fb-9a26-488a-a624-fb2c891c1168/dashboard/flow
Authorization: Bearer <accessToken>
```

### Exemplo de resposta (real, capturado em teste)

```json
{
  "distribution": [
    { "category": "FEATURE", "count": 2 },
    { "category": "TECHNICAL_DEBT", "count": 2 }
  ],
  "wip": { "count": 0 },
  "velocity": {
    "available": false,
    "reason": "Requer histórico de mudança de status (changelog do Jira, histórico do Linear), que os conectores atuais não coletam — só o snapshot atual do item."
  },
  "cycleTime": {
    "available": false,
    "reason": "Mesmo motivo do Velocity — requer histórico de mudança de status que os conectores atuais não coletam."
  }
}
```

### Campos

- **`distribution`** — contagem atual de work items por categoria semântica. `category` é uma de `'BUG' | 'FEATURE' | 'TECHNICAL_DEBT' | 'TOIL' | 'RISK'`; categorias sem nenhum item **não aparecem** no array (não vêm com `count: 0`).
- **`wip`** — quantos work items estão em `semantic_state = 'IN_PROGRESS'` agora.
- **`velocity`** / **`cycleTime`** — **sempre `available: false`** nesta versão (ver Limitações Conhecidas).

---

## Limitações conhecidas (por que alguns campos vêm `available: false`)

| Campo | Motivo | O que resolveria |
| --- | --- | --- |
| `changeFailureRate` | Precisa saber **qual deploy causou qual incidente** — essa correlação não existe no sistema ainda. | Feature futura: linkar `canonical_incidents` a `canonical_deployments`. |
| `velocity`, `cycleTime` | Precisam saber **quando** um item entrou/saiu de cada status (changelog). Os conectores hoje só trazem o snapshot atual (status de agora), não o histórico de transições. | Feature futura: conectores passarem a buscar changelog (Jira) / histórico (Linear). |

**Filtro por time resolvido via vínculo manual, não automático pra PR/incidente**: Pull Requests nunca passaram pela camada de enriquecimento e o conector do GitHub sincroniza por organização inteira (não por repositório), e o Waroom é multi-time por integração de propósito — então nenhum dos dois tem `team_id` automático como Jira/Linear/GitHub Actions têm. A solução foi um vínculo manual de recurso externo → time (`POST /teams/:teamId/resource-links`, ver `admin.md`), não uma mudança nos conectores. Sem vincular, o filtro por time nessas duas métricas simplesmente não encontra nada (`sampleSize: 0`, não erro).

**Gatilhos fixos, não configuráveis por time (ainda)**: a spec descreve um motor de métricas totalmente configurável (`Valor = f(Evento Inicial, Evento Final, Filtro, Agrupamento)` — cada time podendo escolher, por exemplo, se Lead Time começa no 1º commit ou na abertura do card). Esta versão usa um gatilho fixo por métrica (ex: Lead Time é sempre abertura→merge). A classificação semântica em si (o que é "produção", o que conta como "falha") **já é** configurável via `mapping-rules` — isso não muda.

## Erros

| Status | Quando |
| --- | --- |
| `400` | `from`/`to` (rota DORA) não são datas ISO 8601 válidas. |
| `401` | Token ausente/inválido/expirado. |
| `403` | Token válido, mas de um tenant diferente do `:tenantId` da URL. |
