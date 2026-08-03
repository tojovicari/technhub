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
   de 15min, contra os 60min do token normal) e **`systemRole` sempre
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
4. **Histórico de sync/enrichment por tenant — não feito.** Mesma lacuna já
   registrada no spec do front (Seção 5.2, "não construa achando que depois
   troca") — hoje não existe registro histórico de execução em lugar nenhum
   do sistema, só o estado mais recente (`provider_integrations.status`/
   `last_synced_at`). Resolver isso ajudaria tanto o back office normal
   quanto esse painel. Próximo item real da lista.
- **MRR + funil de conversão — feito.** `GET {prefix}/metrics`, ver
  `.spec/api-reference/platform-admin.md`. Sem série temporal ainda (só
  retrato do agora); funil histórico de inadimplência/recuperação não é
  confiável hoje (`invoice.payment_failed`/`invoice.paid` não gravam
  `subscription_history`, só atualizam o status atual).
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
