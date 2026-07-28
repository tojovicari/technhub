# API de Dashboard — referência pro time de front

Documenta os dois endpoints de leitura agregada disponíveis hoje: DORA e Flow Metrics. É a primeira camada de leitura do sistema — tudo que existia antes disso era só escrita (cadastro de integrações, disparo de sync, configuração de regras).

## Autenticação

Todo endpoint aqui exige `Authorization: Bearer <accessToken>` (o mesmo token retornado no login — ver fluxo de auth). Sem token válido: `401`. Token de um tenant diferente do `:tenantId` da URL: `403`.

**RBAC**: os 3 papéis (`ADMIN`, `GESTOR`, `USUARIO`) podem acessar os dois endpoints — dashboard é visualização, não tem restrição de papel.

## O padrão `available: false`

Algumas métricas ainda não têm dado suficiente pra serem calculadas de verdade. Em vez de omitir o campo ou inventar um número, a API sempre devolve o campo com `available: false` e um `reason` explicando o motivo. Trate isso na UI como "não disponível ainda" (ex: um estado vazio com o texto do `reason`, ou simplesmente ocultar o card), nunca como erro.

---

## `GET /tenants/:tenantId/dashboard/dora`

Métricas DORA (Deployment Frequency, Lead Time for Changes, Mean Time to Restore, Change Failure Rate). Escopo: **tenant inteiro** — ainda não dá pra filtrar por time (ver Limitações Conhecidas).

### Query params

| Nome   | Formato       | Obrigatório | Default              |
| ------ | ------------- | ----------- | --------------------- |
| `from` | ISO 8601 date | Não         | 30 dias atrás de hoje |
| `to`   | ISO 8601 date | Não         | agora                 |

Data inválida em qualquer um dos dois → `400`.

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

---

## `GET /tenants/:tenantId/dashboard/flow`

Flow Metrics (Distribution, Load/WIP, Velocity, Cycle Time). Sem query params — é sempre "agora" (retrato do momento, não uma série temporal).

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

**Escopo tenant inteiro, sem filtro por time**: Pull Requests nunca passaram pela camada de enriquecimento e o conector do GitHub sincroniza por organização inteira (não por repositório/time), então hoje não tem como saber de qual time é um PR específico. Até isso ser resolvido, os dois endpoints somam tudo do tenant.

**Gatilhos fixos, não configuráveis por time (ainda)**: a spec descreve um motor de métricas totalmente configurável (`Valor = f(Evento Inicial, Evento Final, Filtro, Agrupamento)` — cada time podendo escolher, por exemplo, se Lead Time começa no 1º commit ou na abertura do card). Esta versão usa um gatilho fixo por métrica (ex: Lead Time é sempre abertura→merge). A classificação semântica em si (o que é "produção", o que conta como "falha") **já é** configurável via `mapping-rules` — isso não muda.

## Erros

| Status | Quando |
| --- | --- |
| `400` | `from`/`to` (rota DORA) não são datas ISO 8601 válidas. |
| `401` | Token ausente/inválido/expirado. |
| `403` | Token válido, mas de um tenant diferente do `:tenantId` da URL. |
