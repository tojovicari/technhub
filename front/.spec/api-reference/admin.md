# API Reference — Back Office (Tenants, Usuários, Times, Integrações, Regras)

Todas as rotas abaixo, exceto as marcadas como "bootstrap", exigem `Authorization: Bearer <accessToken>` e o `:tenantId` da URL precisa bater com o tenant do token (`403` caso contrário).

## Tenants

### `POST /tenants`

Sem autenticação — é o ponto de partida de tudo.

```json
// Request
{ "name": "Nome da Empresa" }
```

```json
// Resposta 201
{
  "id": "uuid",
  "name": "Nome da Empresa",
  "status": "ACTIVE",
  "createdAt": "...",
  "updatedAt": "..."
}
```

`400` se `name` ausente/vazio.

## Usuários

### `GET /tenants/:tenantId/users`

Exige `ADMIN` (mesmo RBAC do `POST` fora do bootstrap). Lista **todos** os usuários do tenant, sem paginação, ordenados por `fullName`.

```json
// Resposta 200 (real, capturado em teste)
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "primaryEmail": "user@example.com",
    "fullName": "Nome Completo",
    "avatarUrl": null,
    "systemRole": "ADMIN",
    "status": "ACTIVE",
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

### `POST /tenants/:tenantId/users`

**Comportamento duplo — leia com atenção:**
- Se o tenant **ainda não tem nenhum usuário**: rota aberta (sem token), o usuário criado vira `ADMIN` automaticamente (qualquer `systemRole` enviado é ignorado). É o fluxo de bootstrap.
- Se o tenant **já tem pelo menos um usuário**: exige `Authorization: Bearer <token>` de um `ADMIN` do mesmo tenant.

```json
// Request
{
  "primaryEmail": "user@example.com",
  "fullName": "Nome Completo",
  "avatarUrl": "https://...",       // opcional
  "systemRole": "GESTOR"            // opcional, um de ADMIN | GESTOR | USUARIO; ignorado no bootstrap
}
```

```json
// Resposta 201 — mesma forma do objeto `user` do callback de login
{ "id": "uuid", "tenantId": "uuid", "primaryEmail": "...", "fullName": "...", "avatarUrl": null, "systemRole": "GESTOR", "status": "DISCOVERED", "createdAt": "...", "updatedAt": "..." }
```

| Status | Motivo |
| --- | --- |
| `400` | `primaryEmail`/`fullName` ausentes, ou `systemRole` inválido. |
| `401`/`403` | Faltando token de ADMIN (fora do bootstrap). |
| `404` | Tenant não encontrado. |
| `409` | Já existe usuário com esse email neste tenant. |

Usuário criado por aqui começa com `status: "DISCOVERED"` — vira `"ACTIVE"` só depois do primeiro login bem-sucedido (`markLoggedIn`, disparado pelo callback de auth).

**Fora do bootstrap, um email de convite é disparado automaticamente** (assíncrono, best-effort — nunca atrasa nem muda a resposta `201`, mesmo se o envio falhar). O email já vem com um link de login funcional (`GET /auth/:provider/login?tenantId=...`). **A tela de convite não precisa gerar nem exibir nenhum link** — só confirmar pro admin que o convite foi enviado (ex: toast "Convite enviado para {email}"). Não existe campo na resposta indicando se o envio deu certo (é best-effort, sem tabela de auditoria ainda) — trate como "enviado", não como algo a confirmar de volta pra UI.

### `POST /tenants/:tenantId/users/:userId/aliases`

Vincula um usuário da plataforma a uma identidade externa num provider (ex: `username` do GitHub, `accountId` do Jira) — é essa ponte que permite atribuir PRs/issues/incidentes a uma pessoa real depois. Exige `ADMIN` ou `GESTOR`.

```json
// Request
{
  "provider": "github",
  "externalUserId": "39227316",
  "externalUsername": "octocat",   // opcional
  "externalEmail": "octocat@github.com" // opcional
}
```

`201` com o alias criado. `404` se usuário não existe; `409` se esse `provider`+`externalUserId` já está vinculado a outro usuário neste tenant.

### `GET /tenants/:tenantId/discovered-users`

Lista identidades externas vistas durante o sync (autor de PR, assignee de issue/incidente, quem disparou um deploy) que **ainda não** correspondem a nenhum `User` da plataforma — candidatos a convite. Exige `ADMIN` (mesma régua do `POST /tenants/:tenantId/users` fora do bootstrap, já que essa tela existe só pra alimentar o convite). Sem paginação.

**Não confundir com `status: "DISCOVERED"` de um `User`** (nota acima, seção anterior) — são conceitos diferentes com o mesmo nome: um `User` com esse status já é um usuário real da plataforma que só ainda não fez login; um item desta lista **não é** um `User`, é só um rastro de identidade externa vista no sync.

```json
// Resposta 200 (real, capturado em teste)
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "provider": "github_actions",
    "externalUserId": "52472962",
    "externalUsername": "github-pages[bot]",
    "externalEmail": null,
    "externalAvatarUrl": "https://avatars.githubusercontent.com/u/9919?v=4",
    "firstSeenAt": "2026-07-24T12:38:00.839Z",
    "lastSeenAt": "2026-07-24T12:38:00.839Z"
  }
]
```

**Não é sempre tão rico quanto o exemplo acima** — o que vem preenchido depende do provider:
- `github` / `github_actions` / `linear`: username/nome + avatar sempre que a pessoa existe de fato no provider (email só no Linear, e só se o token tiver acesso a esse campo).
- `jira`: username (`displayName`) quase sempre; email só se a configuração de privacidade daquele usuário no Jira permitir.
- `waroom`: só `externalUserId` (nenhum nome/email) — o Waroom não expõe isso nos dados que o sync já busca.

**Fluxo de convite — reaproveita os 2 endpoints que já existem, não tem endpoint próprio de "aceitar candidato":**
1. `POST /tenants/:tenantId/users` com os dados do candidato (pré-preencha `fullName`/`avatarUrl` a partir dele; `primaryEmail` você tem que pedir pro admin digitar quando o candidato não trouxe um, ex: Jira/Waroom sem email resolvido).
2. `POST /tenants/:tenantId/users/:userId/aliases` com `provider`/`externalUserId` do candidato, apontando pro `userId` criado no passo 1.
3. Repita o `GET /discovered-users` — o candidato some da lista (o `user_provider_aliases` criado no passo 2 é o que faz ele sumir, a linha em `discovered_identities` continua existindo como histórico).

**Juntar duas identidades da mesma pessoa vindas de providers diferentes é manual**: convide uma vez a partir de um candidato, depois repita só o passo 2 (vincular alias) pros outros candidatos que forem a mesma pessoa, apontando pro mesmo `userId` já criado — não existe (nem é planejado) matching automático entre providers.

## Times

### `POST /tenants/:tenantId/teams`

Exige `ADMIN` ou `GESTOR`.

```json
// Request
{
  "name": "Squad Checkout",
  "defaultMonthlyCapacityHours": 160,   // opcional, default 160
  "planningCycle": "MONTHLY",           // opcional, um de MONTHLY | WEEKLY | BIWEEKLY_SPRINT, default MONTHLY
  "workingDaysPerWeek": 5               // opcional, default 5
}
```

`201` com o time criado (inclui `id`, `tenantId`, `createdAt`, `updatedAt`).

### `PATCH /tenants/:tenantId/teams/:teamId`

Exige `ADMIN` ou `GESTOR` (mesmo RBAC do `POST`). Todos os campos do corpo são opcionais — **só atualiza o que vier preenchido**, o resto permanece como estava (não é um replace).

```json
// Request — todos os campos opcionais, mesma validação do POST (planningCycle só aceita o enum)
{
  "name": "Squad Checkout",
  "defaultMonthlyCapacityHours": 160,
  "planningCycle": "MONTHLY",
  "workingDaysPerWeek": 4
}
```

`200` com o time atualizado (mesmo shape do `GET`/`POST`). `404` se o time não existe.

### `GET /tenants/:tenantId/teams`

Exige `ADMIN` ou `GESTOR` (mesmo RBAC do `POST`). Lista **todos** os times do tenant, sem paginação, ordenados por `name`.

```json
// Resposta 200 (real, capturado em teste)
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "name": "Squad Checkout",
    "defaultMonthlyCapacityHours": 160,
    "planningCycle": "MONTHLY",
    "workingDaysPerWeek": 5,
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

### `POST /tenants/:tenantId/teams/:teamId/members`

Exige `ADMIN` ou `GESTOR`.

```json
// Request
{
  "userId": "uuid",
  "roleInTeam": "Developer",                  // opcional
  "capacityAllocationPercent": 100,           // opcional, default 100
  "customMonthlyCapacityHours": 120           // opcional — sobrescreve a capacidade default do time só pra esse membro
}
```

`201` com a membership criada. `404` se time/usuário não existem; `409` se o usuário já é membro deste time.

### `GET /tenants/:tenantId/teams/:teamId/members`

Exige `ADMIN` ou `GESTOR` (mesmo RBAC do `POST`). Lista os membros do time, sem paginação — cada item já vem com um resumo do usuário aninhado (`userId` cru não seria muito útil pra uma tela de "membros do time"). Array vazio (`[]`) se o time não tem membros ainda, não `404`.

```json
// Resposta 200 (real, capturado em teste)
[
  {
    "membership": {
      "id": "uuid",
      "tenantId": "uuid",
      "userId": "uuid",
      "teamId": "uuid",
      "roleInTeam": "TECH_LEAD",
      "capacityAllocationPercent": 100,
      "customMonthlyCapacityHours": null,
      "joinedAt": "..."
    },
    "user": {
      "id": "uuid",
      "fullName": "Nome Completo",
      "primaryEmail": "user@example.com",
      "avatarUrl": null
    }
  }
]
```

### `PATCH /tenants/:tenantId/teams/:teamId/members/:membershipId`

Exige `ADMIN` ou `GESTOR` (mesmo RBAC do `POST`). `:membershipId` é o `id` da membership (o campo `membership.id` que já vem no `GET` acima — não é o `userId`). Todos os campos do corpo são opcionais, mesma semântica de PATCH parcial do endpoint de time acima.

```json
// Request — todos os campos opcionais
{
  "roleInTeam": "TECH_LEAD",
  "capacityAllocationPercent": 50,
  "customMonthlyCapacityHours": 80
}
```

`200` com a membership atualizada (mesmo shape do `membership` aninhado no `GET` acima). `404` se a membership não existe.

**Limitação conhecida**: não dá pra usar isto pra *limpar* `customMonthlyCapacityHours` de volta pra `null` (voltar a usar a capacidade default do time) — o campo só aceita ser definido, não removido. Se isso vier a ser necessário, precisa de um follow-up (ex: aceitar `null` explícito como "limpar", diferente de campo ausente como "não mexer").

## Vínculo de recursos externos a times

Jira/Linear/GitHub Actions seguem o modelo "1 integração = 1 time" (`teamId` no cadastro da integração, ver `POST /tenants/:tenantId/integrations`), então `enriched_work_items`/`enriched_deployments` já têm `team_id` automático. **Waroom** (multi-time por integração, de propósito) e **PRs do GitHub** (sync por organização inteira, não por repositório) não seguem esse modelo — pra esses dois, o vínculo de time é manual, recurso por recurso. É o que alimenta o filtro `?teamId=` de MTTR e Lead Time em `dashboard.md`.

### `GET /tenants/:tenantId/team-resource-links/candidates?provider=<provider>&resourceType=<resourceType>`

Lista recursos externos já vistos no dado sincronizado que **ainda não** estão vinculados a nenhum time — candidatos a vínculo. Exige `ADMIN` ou `GESTOR`. Combinações válidas de `provider`+`resourceType` hoje: `waroom`+`waroom_team`, `github`+`github_repository`. Qualquer outra combinação (ou parâmetro ausente) → `400`.

```json
// GET .../candidates?provider=waroom&resourceType=waroom_team — resposta 200 (real, capturado em teste)
[
  { "externalTeamId": "cmqik6vz60001ih01n0ixlncf", "externalTeamName": "Emissão e Resseguros" },
  { "externalTeamId": "cmqqpi7bj001kik011jpk4fst", "externalTeamName": "Sinistros" }
]
```

```json
// GET .../candidates?provider=github&resourceType=github_repository — resposta 200 (real, capturado em teste)
["Akad-Seguros/premium-engine", "z1app/mobile", "z1app/api"]
```

Repare que a forma da resposta muda por `resourceType` (objetos com nome pro Waroom, string crua pro GitHub) — o nome do repositório já é o próprio identificador, não tem um "nome de exibição" separado do "id" como o time do Waroom tem.

### `POST /tenants/:tenantId/teams/:teamId/resource-links`

Cria o vínculo. Exige `ADMIN` ou `GESTOR`.

```json
// Request
{
  "provider": "waroom",                 // "waroom" | "github"
  "resourceType": "waroom_team",        // "waroom_team" | "github_repository"
  "externalResourceId": "cmqik6vz60001ih01n0ixlncf",  // externalTeamId do Waroom, ou "owner/repo" do GitHub
  "externalResourceName": "Emissão e Resseguros"      // opcional, só exibição
}
```

`201` com o vínculo criado. `404` se o time não existe. `409` se esse recurso já está vinculado a **outro** time (um recurso só pode pertencer a um time por vez).

**Depois de vincular, o vínculo só reflete nos dashboards depois do próximo enriquecimento** (`POST /tenants/:tenantId/enrichment/waroom/run` pra incidentes — Lead Time de PR não passa por enriquecimento, então reflete imediatamente).

### `GET /tenants/:tenantId/teams/:teamId/resource-links`

Lista o que já está vinculado a um time. Exige `ADMIN` ou `GESTOR`.

```json
// Resposta 200 (real, capturado em teste)
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "teamId": "uuid",
    "provider": "waroom",
    "resourceType": "waroom_team",
    "externalResourceId": "cmqik6vz60001ih01n0ixlncf",
    "externalResourceName": "Emissão e Resseguros",
    "createdAt": "..."
  }
]
```

**Limitação conhecida**: sem `DELETE` nesta versão — um vínculo criado errado precisa ser corrigido direto no banco por enquanto. Se isso for necessidade real, é um follow-up pequeno.

## Integrações

`status` (presente na resposta do `POST` e de cada item do `GET` abaixo) é um de `ACTIVE | ERROR | DISABLED` — **não valide como se só `"ACTIVE"` fosse possível**. `ERROR` é um estado real e esperado (a última tentativa de `sync` falhou — ver `POST .../sync` abaixo), não uma exceção rara de se ignorar no schema.

### `POST /tenants/:tenantId/integrations`

Cadastra (ou atualiza, se já existir uma pro mesmo `provider`) as credenciais de um conector. Exige `ADMIN`. **Valida a credencial de verdade contra o provider externo antes de salvar** — se a credencial não funcionar, devolve `422`, não salva nada.

```json
// Request
{
  "provider": "jira",       // github | jira | linear | waroom | github_actions
  "credentials": {
    "apiToken": "...",
    "extra": { }             // formato varia por provider, ver tabela abaixo
  },
  "teamId": "uuid"           // opcional — associa a integração a um time da plataforma
}
```

`credentials.extra` por provider:

| Provider | `extra` necessário |
| --- | --- |
| `github` (PRs) | `{ "organization": "nome-da-org" }` |
| `jira` | `{ "email": "...", "projectKey": "KAN" }`, mais `credentials.baseUrl` (ex: `https://empresa.atlassian.net`) |
| `linear` | `{ "teamKey": "ENG" }` |
| `waroom` | nenhum campo extra obrigatório (sync cobre todos os times/serviços visíveis à API key) |
| `github_actions` | `{ "repository": "owner/repo" }` |

```json
// Resposta 201
{
  "id": "uuid",
  "tenantId": "uuid",
  "provider": "jira",
  "category": "issue_tracker",
  "status": "ACTIVE",
  "teamId": "uuid",
  "lastCursor": null,
  "lastSyncedAt": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

| Status | Motivo |
| --- | --- |
| `400` | `provider` ausente/não suportado, ou `credentials` ausente/não é objeto. |
| `422` | A credencial não passou na validação real contra o provider (corpo inclui `detail` com a mensagem específica). |
| `404` | Tenant não encontrado, ou `teamId` informado não existe neste tenant. |

**Nunca envie o token real do usuário em texto puro num log/print — trate como segredo desde a captura no formulário.**

### `GET /tenants/:tenantId/integrations`

Exige `ADMIN` ou `GESTOR` (mesmo RBAC do `POST .../sync`). Lista **todas** as integrações do tenant, sem paginação — **nunca inclui a credencial**, só o resumo (mesmo formato do `POST`).

```json
// Resposta 200 (real, capturado em teste)
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "provider": "jira",
    "category": "issue_tracker",
    "status": "ACTIVE",
    "teamId": "uuid",
    "lastCursor": null,
    "lastSyncedAt": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

### `POST /tenants/:tenantId/integrations/:provider/sync`

Dispara uma página de sincronização incremental (não é "sincronizar tudo de uma vez" — cada chamada busca uma página; chame de novo pra continuar até `nextCursor` vir `null`). Exige `ADMIN` ou `GESTOR`.

```json
// Resposta 200
{
  "success": true,
  "nextCursor": "2",          // chame de novo se não for null, pra pegar a próxima página
  "fetchedCount": 50,
  "workItems": [ ... ],       // presente só em providers issue_tracker
  "pullRequests": [ ... ],    // presente só em providers vcs
  "incidents": [ ... ],       // presente só em providers incident
  "deployments": [ ... ]      // presente só em providers cicd
}
```

`404` se não houver integração cadastrada pra esse `provider` neste tenant. Uma falha parcial ainda devolve `200`, mas com `"success": false` e um array `errors`.

## Regras Semânticas (Domain Context Engine)

Define o que conta como "produção", "bug", "falha", etc. — é o que a Enriched Layer usa pra classificar o dado bruto. Precedência: regra do time > regra da organização > fallback do sistema (hardcoded, usado quando nem time nem organização configuraram nada).

### `POST /tenants/:tenantId/mapping-rules` (organização — fallback do tenant inteiro)
### `POST /tenants/:tenantId/teams/:teamId/mapping-rules` (time — maior precedência)

Ambas exigem `ADMIN` ou `GESTOR`, mesmo corpo:

```json
{
  "rules": {
    "workItemType": [
      {
        "targetCategory": "BUG",
        "matchMode": "ANY",
        "conditions": [{ "field": "issue_type", "operator": "IN", "values": ["Bug", "Defect"] }]
      }
    ],
    "workflowStates": [
      { "targetState": "IN_PROGRESS", "isActiveTime": true, "rawStatusValues": ["In Progress", "Doing"] }
    ],
    "deploymentEnvironment": [
      {
        "targetEnvironment": "PRODUCTION",
        "matchMode": "ANY",
        "conditions": [{ "field": "environment", "operator": "IN", "values": ["prod", "production"] }]
      }
    ],
    "incidentSeverity": [
      {
        "targetClassification": "COUNTS_AS_FAILURE",
        "matchMode": "ANY",
        "conditions": [{ "field": "severity", "operator": "IN", "values": ["SEV1", "SEV2"] }]
      }
    ]
  }
}
```

Os 4 arrays são **obrigatórios no corpo** (podem vir vazios `[]`, mas a chave precisa existir) — `400` se algum estiver ausente ou não for array.

- `targetCategory`: `BUG | FEATURE | TECHNICAL_DEBT | TOIL | RISK`
- `targetState`: `BACKLOG | IN_PROGRESS | WAITING_REVIEW | DONE`
- `targetEnvironment`: `PRODUCTION | STAGING | OTHER`
- `targetClassification`: `COUNTS_AS_FAILURE | INFORMATIONAL`
- `operator`: `IN | EQUALS | CONTAINS_ANY` (os três funcionam de forma idêntica hoje — checagem de interseção case-insensitive)
- `matchMode`: `ANY` (qualquer condição basta) ou `ALL` (todas precisam bater)

**Sobre `condition.field` — importante pra montar a tela, confirmado direto no motor de avaliação:**
- Em `workItemType`, `field` varia de verdade: `"issue_type"` ou `"labels"` são dois atributos brutos diferentes do work item, o avaliador trata cada um. Mostre como dropdown de 2 opções, não texto livre.
- Em `deploymentEnvironment` e `incidentSeverity`, **`field` é ignorado pelo avaliador** — a comparação é sempre contra `environment`/`severity`, não importa o que vier em `field`. O campo continua obrigatório no shape (não dá pra omitir na request), mas a tela não precisa perguntar isso pro usuário: hardcode `"environment"` ou `"severity"` conforme a categoria ao montar o payload.
- `incidentSeverity` não precisa de multi-select de valores observados (ver `GET .../observed-values` abaixo) — pode ser um dropdown estático com `SEV1 | SEV2 | SEV3 | SEV4 | UNKNOWN`. É um conjunto fechado e sempre exaustivo porque o `waroom.provider.ts` já normaliza a severidade bruta pra esse enum antes da regra do admin rodar.

`200` com o corpo salvo de volta. `404` se tenant/time não existem.

### `GET /tenants/:tenantId/mapping-rules/observed-values?field=<field>`

Valores brutos distintos já vistos no dado canônico sincronizado daquele tenant, pra alimentar um multi-select em vez de um campo de texto livre nas condições (`workItemType`/`deploymentEnvironment`) e em `workflowStates.rawStatusValues`. Exige `ADMIN` ou `GESTOR` (mesma régua do resto de mapping-rules). Escopo: **tenant inteiro**, não por time — o dado canônico não carrega `team_id` (só a Enriched Layer resolve isso, mesma limitação já documentada nos dashboards).

`field` é obrigatório, um de `issue_type | labels | status | environment` (não inclui `severity` — ver nota acima). `400` se ausente ou fora dessa lista.

```json
// GET .../observed-values?field=issue_type — resposta 200 (real, capturado em teste)
{
  "field": "issue_type",
  "values": ["Bug", "Epic", "Feature", "Issue", "Subtask", "Task", "Toil"]
}
```

| `field` | Fonte | Usado em |
| --- | --- | --- |
| `issue_type` | `canonical_work_items.raw_issue_type` | condições de `workItemType` |
| `labels` | `canonical_work_items.raw_labels` (array, achatado) | condições de `workItemType` |
| `status` | `canonical_work_items.raw_status` | `workflowStates.rawStatusValues` |
| `environment` | `canonical_deployments.environment` | condições de `deploymentEnvironment` |

**Lista vazia é um caso real e esperado**: um tenant que ainda não sincronizou nenhuma integração daquela categoria devolve `{"field": "...", "values": []}`, não erro. A tela precisa de um fallback pra esse caso (ex: voltar pra input de texto livre até existir dado, ou uma mensagem "sincronize uma integração primeiro").

### `GET /tenants/:tenantId/mapping-rules` (organização) / `GET /tenants/:tenantId/teams/:teamId/mapping-rules` (time)

Exigem `ADMIN` ou `GESTOR` (mesmo RBAC dos `POST`s). **Devolvem exatamente o que está gravado naquele nível específico — sem mesclar com fallback de organização/sistema.** Isso é deliberado: este endpoint é pra alimentar a tela de edição, que precisa saber "o que já está configurado aqui", não "qual regra vale no fim das contas" (isso é uso interno do motor de enriquecimento).

```json
// Resposta 200 (real, capturado em teste — GET de um time com regra configurada)
{
  "tenantId": "uuid",
  "teamId": "uuid",
  "rules": {
    "workItemType": [],
    "workflowStates": [],
    "incidentSeverity": [],
    "deploymentEnvironment": [
      {
        "targetEnvironment": "PRODUCTION",
        "matchMode": "ANY",
        "conditions": [{ "field": "environment", "operator": "IN", "values": ["github-pages"] }]
      }
    ]
  }
}
```

`404` se nada foi configurado ainda naquele nível (`{ "error": "..." }`) — trate como "formulário vazio", não como erro real. No `GET` de organização, `teamId` sempre vem `null` na resposta.

## Enriquecimento

### `POST /tenants/:tenantId/enrichment/:provider/run`

Reprocessa todos os registros canônicos daquele provider aplicando as regras semânticas efetivas. Exige `ADMIN` ou `GESTOR`.

```json
// Resposta 200
{ "processedCount": 50, "breakdown": { "PRODUCTION": 50 } }
```

`breakdown` varia por categoria do provider (chaves de `SemanticCategory` pra issue trackers, `SemanticEnvironment` pra CI/CD, `IncidentFailureClassification` pra incidentes).

| Status | Motivo |
| --- | --- |
| `404` | Integração não encontrada. |
| `400` com `{"error": "...associada a um time..."}` | Provider exige `teamId` (issue tracker/CI-CD) e a integração não tem um associado — recadastre a integração informando `teamId`. |
| `400` com `{"error": "...categoria...sem Enriched Layer..."}` | Categoria do provider ainda não suportada (ex: `vcs`, `communication`). |
