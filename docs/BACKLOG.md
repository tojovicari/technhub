# Backlog

Itens levantados mas não priorizados/implementados ainda. Não é spec — quando
um item aqui for pra frente de verdade, o desenho real vai pra
`.spec/spec-engineering-intelligence.md` (fonte da verdade), não fica só
aqui.

## Retenção de dados por plano — gaps conhecidos

**Contexto**: `plans.data_retention_months` + `RetentionPurgeService`
(`POST /internal/retention/purge`, cron semanal) expurgam dado canônico
mais velho que a retenção do plano + carência (`DATA_RETENTION_GRACE_MONTHS = 3`).
Validado nesta rodada com um tenant descartável isolado (nunca contra dado
real — ver nota abaixo), confirmando: purge scoped corretamente por
`tenant_id`, cascade pra `enriched_*` funciona, `canonical_work_item_status_transitions`
é purgada explicitamente (sem FK, não cascateia sozinha), e o alerta
`data_retention_purge_approaching` dispara/resolve certo.

1. **Cron real nunca disparou.** `.github/workflows/retention-purge.yml`
   existe e segue o mesmo padrão dos outros dois workflows, mas — assim
   como `sync.yml` — nunca rodou contra produção nesta sessão. O
   comportamento da rota (`requireInternalToken`, resposta) foi validado
   só localmente, chamando o serviço direto.
2. **Volume real de expurgo não foi stress-testado.** O teste desta rodada
   usou 1 registro por tabela (5 no total). `PURGE_BATCH_SIZE = 1000` e
   `MAX_PURGE_BATCHES_PER_TABLE` (teto por tabela/execução) são valores
   conservadores sem carga real pra medir contra — mesmo espírito do que já
   está registrado abaixo pra `DATABASE_POOL_MAX`/`SYNC_BATCH_CONCURRENCY`,
   vale reajustar quando houver uma base de tenants de verdade com histórico
   grande acumulado.
3. **Sem trava de segurança contra corte de data absurdo.** Se alguém
   configurar `data_retention_months` muito baixo por engano (ex: `1`) num
   plano com tenants reais vinculados, o próximo cron expurga de verdade,
   sem confirmação/preview antes. Não corrigido nesta rodada — considerar
   um preview ("isso vai apagar N registros de M tenants") antes de uma
   mudança de retenção entrar em vigor, se isso virar risco real de uso.

## Quebra de esforço por épico — gaps conhecidos

**Contexto**: `GET /tenants/:tenantId/teams/:teamId/profile/epics` (Time →
Projeto → Épico → Item) resolve o "pai/container" de 1 salto de cada work
item (`CanonicalWorkItem.parentExternalId`) e sobe a cadeia até achar um
ancestral marcado como fronteira de épico (`epicGrouping` em
`mapping_rules`, ver `src/enrichment/epic-resolver.ts`).

1. **Jira Epic Link clássico (company-managed) — feito.** `JiraProvider`
   agora descobre o custom field via `GET /rest/api/3/field`
   (`schema.custom === 'com.pyxis.greenhopper.jira:gh-epic-link'`, id
   numérico varia por site) na primeira sync de cada integração, cacheado
   em `provider_integrations.epic_link_field_id`/`epic_link_field_resolved`
   (mesmo mecanismo de ida-e-volta do `cursor`, via `SyncContext`/
   `SyncResult.epicLinkFieldId`). `parent` (team-managed) sempre vence
   quando presente; cai pro custom field só quando `parent` é `null`.
   **Não verificado ao vivo** — shape de `GET /rest/api/3/field` assumido
   pela documentação pública da Atlassian; testado só estruturalmente
   (montagem de JQL/URL, precedência `parent` vs. custom field), sem
   credencial real disponível nesta sessão.
2. **Resolução só dentro da mesma integração/projeto.** Se um épico e sua
   story estiverem em projetos Jira diferentes (raro, mas possível), a
   cadeia não resolve — o `parentExternalId` aponta pra um `externalId`
   que só existe no lookup de outra integração, fora do alcance de
   `resolveEpicGroup`. Não corrigido.
3. **Parents órfãos (épico nunca sincronizado, mesmo dentro do mesmo
   projeto) — reconciliação automática implementada.** Causa original: o
   backfill do Jira só varre `DEFAULT_BACKFILL_DEPTH_DAYS = 365` dias por
   `created` (`backfill-window.ts`), depois disso vira sync permanentemente
   incremental por `updated` — um épico maduro e raramente editado nunca
   era sincronizado, mesmo com os filhos sincronizando normalmente
   (confirmado com dado real: 34/34 itens testados, 0 resolveram épico).
   Corrigido via `SyncOrchestrator.reconcileDanglingParents`: toda sync
   bem-sucedida de um provider que implementa `BaseProvider.fetchByExternalIds`
   (Jira, Azure Boards) busca até `MAX_DANGLING_PARENTS_PER_SYNC = 200`
   `parent_external_id`s órfãos (`WorkItemRepository.findDanglingParentExternalIds`)
   diretamente pelo id/key e persiste como work item normal. Autocura ao
   longo de várias syncs, não instantâneo numa execução só — cadeias de
   vários saltos (comum no Azure Boards: Task→Story→Feature→Epic) podem
   levar mais de uma sync pra resolver de vez, decisão deliberada pra
   manter o passo simples. **Não verificado ao vivo** (mesma ressalva do
   item 1) — testado estruturalmente: a query de órfãos foi validada contra
   dado real de produção (achou 104 órfãos distintos, respeitou o teto),
   `markSyncOutcome`/`getDecryptedCredentialsById` foram validados end-to-end
   contra o banco real, mas a chamada de `fetchByExternalIds` em si (JQL
   `key in (...)` do Jira, `workitemsbatch` do Azure) não foi exercitada
   contra API real nesta sessão.
4. **Azure Boards `$expand: 'relations'` não verificado ao vivo** — mesma
   ressalva já registrada pros outros pontos incertos do conector
   (`azure-boards.provider.ts`). Não confirmado se a API realmente devolve
   o link `System.LinkTypes.Hierarchy-Reverse` no formato assumido, nem se
   o id do pai sempre aparece como último segmento numérico da `url`.

## Painel do gestor do SaaS — o que já existe e o que ainda falta

**Contexto**: o painel cross-tenant do gestor do SaaS (autenticação via
allowlist de GitHub, `/{prefix}/tenants` + detalhe + drilldown de
users/teams/integrations, `/{prefix}/plans`, suspender/reativar tenant,
cancelar assinatura, CRUD de plano com Price automático no Stripe) já está
implementado — ver `src/http/routes/admin.routes.ts`,
`src/auth/core/platform-operator-allowlist.ts`, `PLATFORM_OPERATOR_GITHUB_IDS`/
`PLATFORM_ADMIN_ROUTE_PREFIX`. UI real está sendo construída pelo front agora
(`.spec/api-reference/platform-admin.md`).

Pedidos do front, na ordem que eles mesmos sugeriram (cada um pré-requisito
do seguinte):

1. **Drilldown de leitura por tenant — feito.** `GET {prefix}/tenants/:tenantId`
   (detalhe) + `.../users`, `.../teams`, `.../integrations` (reaproveitam os
   mesmos repositórios das rotas tenant-scoped equivalentes, só chamados com
   o `tenantId` da URL em vez de vir do token).
2. **Audit log das ações do painel — feito.** Tabela
   `platform_operator_audit_log` (`db/migrations/0038`, sem RLS — dado da
   plataforma). Toda ação de escrita do painel (`suspend`/`reactivate`/
   `cancel-subscription`/`create`/`update` de plano) grava uma entrada; `GET
   {prefix}/audit-log?tenantId=&limit=` lista. `PlatformOperatorAuditLogRepository`
   (`src/platform-admin/`).
3. **Impersonation (operador "vira" um usuário de um tenant) — feito,
   acesso completo de `ADMIN`.** `POST {prefix}/tenants/:tenantId/impersonate/:userId`
   emite um `AuthTokenPayload` normal com `impersonatedBy` preenchido (TTL
   de 60min, mesmo do token normal — era 15min quando impersonation ainda
   era read-only) e **`systemRole` sempre
   `'ADMIN'`, independente do papel real da pessoa impersonada** (decisão
   revista nesta rodada — começou read-only, virou acesso completo por
   pedido explícito). Reaproveita 100% das rotas tenant-scoped existentes,
   sem duplicar nada. **Compensação obrigatória pela ausência do bloqueio de
   escrita**: `requireAuth` (`src/http/middleware/require-auth.ts`) grava
   `IMPERSONATED_WRITE` no audit log (`metadata: { method, url }`) pra
   **toda** escrita numa sessão impersonada, sem exceção — nenhuma rota
   existente ou futura escapa disso. `POST {prefix}/end-impersonation`
   grava o encerramento deliberado (sem revogar o JWT — TTL curto já limita
   a exposição); "voltar a ser operador" é local no front.
4. **Histórico de sync/enrichment por tenant — feito.** Tabela
   `integration_run_history` (`db/migrations/0039`, RLS por tenant — dado de
   tenant, não de plataforma). Uma linha por execução de sync
   (`SyncOrchestrator.runSyncForIntegration`, tanto `.../sync` manual quanto
   `/internal/sync` do cron — `triggeredBy: 'manual'|'cron'` via
   `SyncContext.triggeredBy`) ou enrichment (`EnrichmentService.runForIntegration`,
   sempre `'manual'` hoje), sucesso ou falha, com `summary` (contagens) e
   `errorMessage` quando aplicável. `IntegrationRunHistoryRepository.record`
   nunca lança (mesmo espírito do `SyncOrchestrator`: falha ao logar não pode
   derrubar a sync/enrichment que já rodou). Leitura: `GET
   /tenants/:tenantId/integrations/:integrationId/run-history` (tenant-scoped)
   e `GET {prefix}/tenants/:tenantId/integrations/:integrationId/run-history`
   (painel do gestor, cross-tenant, mesmo espelho de leitura do resto do
   drilldown).
- **MRR + funil de conversão — feito.** `GET {prefix}/metrics`, ver
  `.spec/api-reference/platform-admin.md`. Sem série temporal ainda (só
  retrato do agora). **Funil de inadimplência/recuperação — feito**:
  `onInvoicePaymentFailed`/`onInvoicePaid` (`billing.service.ts`) agora
  gravam `subscription_history` (`reason: 'payment_failed'`/
  `'payment_recovered'`) na transição de verdade pra/de `past_due` (não em
  toda falha/pagamento repetido do mesmo ciclo) — `funnel.delinquency` no
  `/metrics`. Deixou de ser o gap documentado antes aqui.
- **Deletar/arquivar plano** — só `create`/`update` hoje, ainda não pedido.
- **Trocar de plano de um tenant diretamente pelo painel** (sem passar pelo
  checkout normal do tenant) — não pedido ainda.

## Conectores Azure DevOps (Boards/Repos/Pipelines) — construídos sem credencial real, revisitar no primeiro teste ao vivo

**Contexto**: `azure_boards`, `azure_repos` e `azure_pipelines`
(`src/integrations/providers/azure-*`) foram construídos contra a API REST
documentada da Microsoft, sem PAT/org real pra testar — mesmo regime já
aceito hoje pro ArgoCD. `npm run build` limpo e smoke test manual (registro
no `ProviderFactory`, `testConnection` contra org inexistente devolvendo
erro estruturado sem lançar exceção não tratada, `team-resource-links/candidates`
vazio sem erro pra tenant sem dados Azure) já passaram, mas isso não
substitui um teste ao vivo. Três pontos específicos pra revisar assim que
houver credencial real:

1. **`azure_boards`** — não confirmado se o shape de
   `updates[].fields['System.State'].oldValue`/`.newValue` (endpoint
   `_apis/wit/workitems/{id}/updates`) bate com o assumido no mapeamento de
   transições de status; também não confirmado se WIQL no nível da
   organização (sem `WHERE [System.TeamProject] = '...'`) de fato varre
   todos os Projects que o PAT enxerga.
2. **`azure_repos`** — não confirmado se
   `_apis/git/pullrequests/{id}/commits` devolve os commits em ordem
   cronológica ascendente por padrão (usado pra inferir `firstCommitAt`), nem
   o shape exato de `iterations/{id}/changes` usado pra `linesAdded`/
   `linesDeleted`/`changedFiles`. `linesAdded`/`linesDeleted`/`commentsCount`
   ficam sempre `0` de propósito — a API básica de listagem de PR não expõe
   esses campos, e nenhum valor foi inventado.
3. **`azure_pipelines`** — maior incerteza dos três: não confirmado se
   `environmentdeploymentrecords` (`_apis/distributedtask/environments`)
   carrega o SHA do commit ou só metadata do run/pipeline; se não carregar,
   `commitSha` fica sempre `null` (degradação aceitável, não bloqueia o
   resto). Escopo deliberadamente limitado ao paradigma moderno de
   Environments — pipelines clássicos de Release Management
   (`_apis/release/releases`) ficam de fora, gap conhecido documentado no
   docstring do conector.

## Pool de conexões / `/internal/sync` em escala — resolvido, revisitar com número real

**Contexto**: `DATABASE_POOL_MAX` (default 20, `src/database/pool.ts`) e
`SyncOrchestrator.runBatch` em lotes de `SYNC_BATCH_CONCURRENCY = 10`
(`src/integrations/core/sync.orchestrator.ts`) já resolvem o gargalo que
existia antes (pool sem `max`, tudo num `Promise.all` só). Os números (20 e
10) são chutes conservadores sem carga real de produção — vale reajustar
quando houver uma base de tenants de verdade pra medir contra. O cron de
`.github/workflows/sync.yml` continua desligado (só `workflow_dispatch`) por
uma decisão à parte (frequência, não escala) — religar é uma ação separada,
não decorre automaticamente deste fix.
