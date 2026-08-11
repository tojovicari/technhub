# API de Dashboard — referência pro time de front

Os três endpoints de leitura agregada disponíveis hoje: DORA, o histórico semanal de DORA e Flow Metrics. É a primeira camada de leitura do sistema — tudo mais na API é escrita (cadastro de integrações, disparo de sync, configuração de regras).

## Autenticação

Todo endpoint aqui exige `Authorization: Bearer <accessToken>` (o mesmo token retornado no login — ver fluxo de auth). Sem token válido: `401`. Token de um tenant diferente do `:tenantId` da URL: `403`.

**RBAC**: os 3 papéis (`ADMIN`, `GESTOR`, `USUARIO`) podem acessar os três endpoints — dashboard é visualização, não tem restrição de papel.

## O padrão `available: false`

Algumas métricas ainda não têm dado suficiente pra serem calculadas de verdade. Em vez de omitir o campo ou inventar um número, a API sempre devolve o campo com `available: false` e um `reason` explicando o motivo. Trate isso na UI como "não disponível ainda" (ex: um estado vazio com o texto do `reason`, ou simplesmente ocultar o card), **nunca como erro**.

---

## `GET /tenants/:tenantId/dashboard/dora`

Métricas DORA (Deployment Frequency, Lead Time for Changes, Mean Time to Restore, Change Failure Rate). Escopo: **tenant inteiro por padrão**, mas já dá pra filtrar por time via `teamId` (ver "Filtro por time" abaixo) — depende só de o admin ter vinculado os recursos daquele time primeiro.

### Query params

| Nome     | Formato       | Obrigatório | Default                     |
| -------- | ------------- | ----------- | ---------------------------- |
| `from`   | ISO 8601 date | Não         | 30 dias atrás de hoje        |
| `to`     | ISO 8601 date | Não         | agora                        |
| `teamId` | uuid          | Não         | tenant inteiro (sem filtro)  |

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
  "deploymentFrequency": { "total": 0, "byDay": [] },
  "leadTimeForChanges": { "available": true, "avgHours": null, "medianHours": null, "sampleSize": 0 },
  "meanTimeToRestore": { "available": true, "avgHours": 200.81, "sampleSize": 65 },
  "changeFailureRate": { "available": true, "totalDeployments": 12, "failedDeployments": 3, "rate": 0.25 },
  "appliedTriggerConfig": {
    "deploymentFrequency": { "config": { "startEvent": "CICD_DEPLOY" }, "source": "system_default", "teamId": null, "updatedAt": "2026-08-06T00:00:00.000Z" },
    "leadTimeForChanges": { "config": { "startEvent": "PR_OPENED", "endEvent": "PR_MERGED" }, "source": "system_default", "teamId": null, "updatedAt": "2026-08-06T00:00:00.000Z" },
    "meanTimeToRestore": { "config": { "startEvent": "INCIDENT_TRIGGERED" }, "source": "system_default", "teamId": null, "updatedAt": "2026-08-06T00:00:00.000Z" },
    "changeFailureRate": { "config": { "correlationWindowHours": 1 }, "source": "system_default", "teamId": null, "updatedAt": "2026-08-06T00:00:00.000Z" }
  }
}
```

### Campos

- **`deploymentFrequency`** — sempre disponível.
  - `total`: contagem de deploys pra **produção** no período (`semantic_environment = 'PRODUCTION'`, classificação configurável por `mapping-rules`) — **gatilho padrão**. Configurável por time (`POST /tenants/:tenantId/teams/:teamId/metric-triggers` / `PATCH` no mesmo path): times sem pipeline de CI/CD rastreado podem escolher contar transição pra "Done" do board em vez disso (`startEvent: "WORKFLOW_DONE_TRANSITION"`), opcionalmente filtrado por categoria (`categoryFilter`).
  - `byDay`: série temporal `{ date: "YYYY-MM-DD", count: number }[]`, só com dias que tiveram deploy/transição (dias sem nenhum não aparecem no array — não vêm com `count: 0`).
- **`leadTimeForChanges`** — tempo entre início e fim configuráveis, default abertura→merge do PR.
  - Quando `available: true`: `avgHours`/`medianHours` em horas (`null` se `sampleSize` for `0` — sem PR merged no período, não dá pra tirar média), `sampleSize` = quantos PRs entraram na conta.
  - **Gatilho configurável**: `startEvent: "PR_OPENED"` (default) ou `"FIRST_COMMIT"`; `endEvent: "PR_MERGED"` (default) ou `"CICD_DEPLOY"` (correlação aproximada, ver limitações). `FIRST_COMMIT` já funciona — o provider do GitHub popula `first_commit_at` (chamada a `/pulls/:n/commits`, data do primeiro commit). Só PR sincronizado **depois** dessa mudança tem o campo preenchido; PR sincronizado antes fica com `first_commit_at: null` até um próximo `POST .../sync` tocar nele de novo — não é retroativo sozinho.
- **`meanTimeToRestore`** — tempo entre disparo (padrão) ou reconhecimento e resolução de incidente, só incidentes com `resolved_at` preenchido no período. Configurável por time: `startEvent: "INCIDENT_ACKNOWLEDGED"` troca `triggered_at`→`resolved_at` por `acknowledged_at`→`resolved_at` — incidentes **sem** `acknowledged_at` ficam de fora da amostra nesse caso (não caem silenciosamente pro `triggered_at`), então `sampleSize` pode ficar bem menor que o total de incidentes resolvidos.
- **`changeFailureRate`** — deixou de ser sempre `available: false`.
  - `totalDeployments`: deploys `SUCCESS`+produção no período que entraram na conta.
  - `failedDeployments`: quantos desses tiveram pelo menos um incidente correlacionado (ver definição abaixo).
  - `rate`: **fração (0-1)**, não percentual — `failedDeployments / totalDeployments`. Multiplique por 100 na UI se for exibir como `%`.
  - `available: false` só quando `totalDeployments === 0` (nenhum deploy de produção bem-sucedido no período) — mesmo padrão de "zero é resultado válido vs. sem dado" já usado em `cycleTime`/`velocity`.
  - **Como a correlação funciona** (importante pra explicar o número na UI, se quiser): não existe um link explícito entre deploy e incidente nos dados de nenhum provider integrado — é sempre inferido. Um deploy conta como "causou falha" se existe um incidente classificado como falha real (`failure_classification: 'COUNTS_AS_FAILURE'`, baseado na severidade via `mapping-rules`) **do mesmo time**, disparado dentro de uma janela configurável depois do deploy terminar — **default 1 hora**, mas cada time (ou a organização inteira) pode configurar um valor diferente. É uma aproximação deliberada, não uma verdade absoluta — incidentes que demoram mais que a janela configurada pra aparecer não são contados como causados por aquele deploy.
- **`appliedTriggerConfig`** — Eco de "o que foi usado pra calcular este número" (auditoria). As 4 métricas ecoam aqui. `source` diz de onde veio a config efetiva: `"team"` (só quando `?teamId=` foi passado e o time tem config própria), `"org"` (configuração de organização) ou `"system_default"` (ninguém configurou nada — mesmo valor que já era hardcoded antes desta config existir). `teamId` ecoa o `?teamId=` da própria request (`null` se não foi passado). `updatedAt` é quando aquela configuração específica foi salva pela última vez (ou um marco fixo, se `source: "system_default"`).

### Filtro por time (`?teamId=`)

Quando `teamId` é passado, `deploymentFrequency`, `leadTimeForChanges` e `meanTimeToRestore` ganham um campo extra, **`"scope": "team"`** (ausente quando `teamId` não é passado — não polui a resposta tenant-wide de sempre). É assim que a tela sabe "esse número é real por time", já que as 3 métricas dependem de vínculos manuais que podem não existir ainda pra aquele time (`POST /tenants/:tenantId/teams/:teamId/resource-links`):

- **`deploymentFrequency`**: filtra por `enriched_deployments.team_id` — já funciona pra qualquer time com integração de CI/CD associada (automático, sem vínculo manual necessário).
- **`leadTimeForChanges`**: só conta PR de repositório **já vinculado** àquele time (`POST /tenants/:tenantId/teams/:teamId/resource-links`, `resourceType: "github_repository"`). Sem nenhum repo vinculado ainda, `sampleSize: 0` — não é erro. **Com `endEvent: "CICD_DEPLOY"`**, esse vínculo passa a ser obrigatório mesmo **sem** `teamId` (chamada tenant-wide).
- **`meanTimeToRestore`**: só conta incidente cujo time do Waroom já foi vinculado àquele time da plataforma (`resourceType: "waroom_team"`). Mesma lógica de "zero não é erro" se nada foi vinculado.
- **`changeFailureRate`**: mesmo filtro de `deploymentFrequency` (`enriched_deployments.team_id` direto) — e a correlação com incidente **também exige que o incidente seja do mesmo time**. Com `teamId` passado, a janela usada é a config efetiva **daquele time** (`appliedTriggerConfig.changeFailureRate`, precedência time > organização > sistema).

```json
// GET .../dashboard/dora?teamId=f67b8639-...&from=2020-01-01&to=2026-12-31 — formato real
{
  "period": { "from": "...", "to": "..." },
  "deploymentFrequency": { "total": 1484, "byDay": [...], "scope": "team" },
  "leadTimeForChanges": { "available": true, "avgHours": 22.4, "medianHours": 0.5, "sampleSize": 507, "scope": "team" },
  "meanTimeToRestore": { "available": true, "avgHours": 364.4, "sampleSize": 44, "scope": "team" },
  "changeFailureRate": { "available": true, "totalDeployments": 1484, "failedDeployments": 22, "rate": 0.0148, "scope": "team" }
}
```

---

## `GET /tenants/:tenantId/dashboard/dora/history`

`deploymentFrequency`/`changeFailureRate` (o par que forma o "quadrante DORA") como série temporal — um ponto por semana, **não cumulativo**: cada ponto é escopado só à sua própria janela `(ponto anterior, este ponto]`. É o campo certo pra plotar tendência ("nossa frequência de deploy tá subindo ou caindo?"), diferente do `/dashboard/dora` de cima, que dá um agregado único pro período inteiro.

`leadTimeForChanges`/`meanTimeToRestore` **não** entram aqui — são distribuições de duração, menos naturais como barra semanal.

Cada ponto usa a config efetiva de `deploymentFrequency`/`changeFailureRate` (resolvida uma vez pro `tenantId`/`teamId` da chamada, igual ao `/dashboard/dora`) — mas **sem** `appliedTriggerConfig` por ponto (seria ruído numa série já densa). Pra saber qual config foi usada na série inteira, consulte `GET /dashboard/dora` (mesmo `teamId`) e leia `appliedTriggerConfig` de lá.

```
GET /tenants/:tenantId/dashboard/dora/history?weeks=12&teamId=<uuid opcional>
```

| Query param | Formato | Obrigatório | Default | Limite |
| ----------- | ------- | ------------ | ------- | ------ |
| `weeks`     | inteiro | Não          | 12      | 1–52 (`400` fora disso) |
| `teamId`    | uuid    | Não          | —       | filtra por `enriched_deployments.team_id`, mesmo comportamento do `/dashboard/dora?teamId=` |

Mesmo RBAC do `/dashboard/dora` (sem restrição de papel, os 3 papéis podem ver).

```json
// Resposta 200 (real, capturado em teste, weeks=8, sem teamId)
{
  "points": [
    { "date": "2026-06-12", "deploymentFrequency": { "total": 0, "byDay": [] }, "changeFailureRate": { "available": false, "reason": "Nenhum deploy de produção bem-sucedido neste período." } }
  ]
}
```

---

## `GET /tenants/:tenantId/dashboard/flow`

Flow Metrics (Distribution, Load/WIP, Velocity, Cycle Time). `distribution`/`wip` são sempre "agora" (retrato do momento). `velocity`/`cycleTime` dependem de período (`from`/`to`).

### Query params

| Nome     | Formato      | Obrigatório | Default                                    |
| -------- | ------------ | ----------- | ------------------------------------------- |
| `teamId` | uuid         | Não         | tenant inteiro (sem filtro)                 |
| `from`   | ISO 8601     | Não         | 30 dias atrás (mesmo default do DORA)       |
| `to`     | ISO 8601     | Não         | agora                                       |

`from`/`to` só afetam `velocity`/`cycleTime` — `distribution`/`wip` continuam ignorando período, sempre o estado atual.

Filtra `distribution`/`wip` por `enriched_work_items.team_id`. Depende de como a integração Jira/Linear foi cadastrada:

- Integração **escopada** (`projectKey`/`teamKey` no cadastro, `teamId` direto na integração): filtro funciona pra qualquer time associado, sem vínculo manual — comportamento de sempre.
- Integração **não-escopada** (sincroniza o site/workspace inteiro): o `team_id` de cada work item só existe depois de alguém vincular o projeto/time de origem (`POST /tenants/:tenantId/teams/:teamId/resource-links`, `resourceType: "jira_project"`/`"linear_team"`). Sem vincular, esses itens ficam de fora do filtro.

Por isso `distribution`/`wip` ganham `"scope": "team"` quando `teamId` é passado (mesmo sinal do DORA) — um campo só pros dois, já que compartilham exatamente o mesmo filtro.

### Exemplo de request

```
GET /tenants/c94be6fb-9a26-488a-a624-fb2c891c1168/dashboard/flow
Authorization: Bearer <accessToken>
```

### Exemplo de resposta (real, capturado em teste)

```json
{
  "distribution": [
    { "category": "BUG", "count": 13 },
    { "category": "FEATURE", "count": 73 },
    { "category": "TOIL", "count": 64 }
  ],
  "wip": { "count": 21 },
  "period": { "from": "2026-06-28T15:24:27.040Z", "to": "2026-07-28T15:24:27.040Z" },
  "velocity": { "total": 0, "byDay": [], "scope": "team" },
  "cycleTime": { "available": false, "reason": "Nenhum work item concluído (completed_at) neste período ainda." },
  "scope": "team"
}
```

`velocity: { "total": 0, ... }` é um valor **legítimo** (zero itens concluídos nesse período), não erro. `cycleTime` vira `available: false` **só** quando a amostra é zero de verdade — se houver pelo menos 1, vem com `avgHours`/`medianHours`/`sampleSize` normalmente.

### Campos

- **`distribution`** — contagem atual de work items por categoria semântica. `category` é uma de `'BUG' | 'FEATURE' | 'TECHNICAL_DEBT' | 'TOIL' | 'RISK'`; categorias sem nenhum item **não aparecem** no array.
- **`wip`** — quantos work items estão em `semantic_state = 'IN_PROGRESS'` agora.
- **`period`** — o `from`/`to` efetivamente usado (depois de aplicar o default de 30 dias, se omitido). Só relevante pra `velocity`/`cycleTime`.
- **`velocity`** — mesmo formato de `deploymentFrequency` no DORA (`total`/`byDay`/`scope?`): quantos work items foram concluídos (`completed_at`) no período, por dia. Não é mais sempre `available: false` — populado a partir do changelog de status do Jira/Linear.
- **`cycleTime`** — mesmo formato de Lead Time/MTTR no DORA. Horas entre `started_working_at` (primeira vez que o item entrou num estado que conta como trabalho ativo) e `completed_at` (primeira vez que chegou em `DONE`) — "primeira", não "última", cobre reabertura sem contar tempo extra.
- **`scope`** — presente só quando `?teamId=` é passado (`"team"`). Ausente na resposta tenant-wide.

**Nota de configuração, não bug**: `velocity`/`cycleTime` dependem de `mapping_rules.workflowStates` cobrir os nomes de status reais usados no Jira/Linear daquele tenant. Um board cujos status não batem com nenhuma regra configurada fica com esses campos zerados/`available: false` mesmo tendo dado real — é sinal de regra semântica não configurada, não erro do sistema.

---

## Limitações conhecidas

Nenhum campo do DORA fica permanentemente `available: false` nesta versão — `velocity`/`cycleTime` (Flow) e `changeFailureRate` saíram dessa categoria; todos só vêm `available: false` quando a amostra do período é genuinamente zero.

`changeFailureRate` merece uma ressalva à parte, mesmo populado: **a correlação deploy→incidente é sempre inferida por proximidade de tempo + mesmo time, nunca um link explícito**. A janela é configurável por time (`correlationWindowHours`, default `1` hora), então o efeito exato varia conforme a config efetiva. Incidentes que demoram mais que a janela pra se manifestar não entram na conta (subestima a taxa real), e um incidente coincidentemente próximo de um deploy não relacionado pode ser contado por engano (superestima).

**Filtro por time resolvido via vínculo manual em alguns casos, não automático**: Pull Requests nunca passaram pela camada de enriquecimento e o conector do GitHub sincroniza por organização inteira, e o Waroom é multi-time por integração de propósito — nenhum dos dois tem `team_id` automático. Jira/Linear (Flow) podem sincronizar sem escopo e depender do mesmo vínculo manual. A solução em todos os casos é `POST /tenants/:tenantId/teams/:teamId/resource-links`. Sem vincular, o filtro por time simplesmente não encontra nada (`sampleSize: 0` no DORA, `distribution: []`/`wip.count: 0` no Flow — não é erro).

**Gatilhos configuráveis por time, com uma lacuna real**: as 4 métricas de DORA resolvem `Valor = f(Evento Inicial, Evento Final, Filtro)` por precedência time > organização > sistema. A única opção que **não existe** é `leadTime.startEvent: "CARD_OPENED"` — não há vínculo PR↔work item no schema hoje, então essa opção fica de fora até essa linkagem ser resolvida à parte. A classificação semântica em si (o que é "produção", o que conta como "falha") continua configurável via `mapping-rules`, independente disso.

## Erros

| Status | Quando |
| --- | --- |
| `400` | `from`/`to` (rotas `/dashboard/dora` **e** `/dashboard/flow`) não são datas ISO 8601 válidas — mesma validação, mesma mensagem nas duas. |
| `400` | `weeks` (`/dashboard/dora/history`) fora do intervalo 1–52, ou não é inteiro. |
| `401` | Token ausente/inválido/expirado. |
| `403` | Token válido, mas de um tenant diferente do `:tenantId` da URL. |
