# Backlog

Itens levantados mas não priorizados/implementados ainda. Não é spec — quando
um item aqui for pra frente de verdade, o desenho real vai pra
`.spec/spec-engineering-intelligence.md` (fonte da verdade), não fica só
aqui.

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
