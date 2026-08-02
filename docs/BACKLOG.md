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

Pedidos do front nesta rodada, priorizados na ordem que eles mesmos sugeriram
(cada um é pré-requisito do seguinte):

1. **Drilldown de leitura por tenant — feito.** `GET {prefix}/tenants/:tenantId`
   (detalhe) + `.../users`, `.../teams`, `.../integrations` (reaproveitam os
   mesmos repositórios das rotas tenant-scoped equivalentes, só chamados com
   o `tenantId` da URL em vez de vir do token).
2. **Audit log das ações do painel — não feito, próximo.** Quem
   suspendeu/reativou/cancelou qual tenant e quando — hoje `suspend`/
   `reactivate`/`cancel-subscription` não deixam rastro nenhum. Pré-requisito
   de segurança pra (3) — sem log, impersonation vira uma porta sem câmera.
   Provável desenho: tabela nova (`platform_operator_audit_log` ou similar,
   sem RLS — é dado da plataforma, não de tenant), gravando `externalUserId`
   do operador + ação + `tenantId` alvo + timestamp, escrita em cada handler
   de `admin.routes.ts` que muda estado.
3. **Histórico de sync/enrichment por tenant — não feito.** Mesma lacuna já
   registrada no spec do front (Seção 5.2, "não construa achando que depois
   troca") — hoje não existe registro histórico de execução em lugar nenhum
   do sistema, só o estado mais recente (`provider_integrations.status`/
   `last_synced_at`). Resolver isso ajudaria tanto o back office normal
   quanto esse painel.
4. **Impersonation (operador "vira" um usuário de um tenant) — não feito,
   por último, de propósito.** Não é uma rota a mais — é um mecanismo de
   troca de token novo (token de operador → token daquele tenant/usuário),
   já que hoje o token de operador **deliberadamente** não funciona em
   nenhuma rota `/tenants/:tenantId/*` (isolamento dos dois mecanismos de
   auth, ver `require-platform-operator.ts`). Perguntas em aberto antes de
   desenhar de verdade: token de impersonation expira sozinho (TTL curto) ou
   precisa de um "voltar a ser operador" explícito? Cada ação feita
   impersonando fica marcada no audit log de (2) como "operador X agindo
   como usuário Y", não só como o usuário normal — inegociável, senão vira
   acesso sem rastro. **Não começar sem (2) existir primeiro.**
- **Deletar/arquivar plano** — só `create`/`update` hoje, ainda não pedido.
- **Trocar de plano de um tenant diretamente pelo painel** (sem passar pelo
  checkout normal do tenant) — não pedido ainda.

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
