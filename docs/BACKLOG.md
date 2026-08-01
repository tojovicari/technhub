# Backlog

Itens levantados mas não priorizados/implementados ainda. Não é spec — quando
um item aqui for pra frente de verdade, o desenho real vai pra
`.spec/spec-engineering-intelligence.md` (fonte da verdade), não fica só
aqui.

## Painel do gestor do SaaS — fora de escopo da primeira rodada

**Contexto**: o painel cross-tenant do gestor do SaaS (autenticação via
allowlist de GitHub, `/{prefix}/tenants`, `/{prefix}/plans`, suspender/
reativar tenant, cancelar assinatura, CRUD de plano com Price automático no
Stripe) já está implementado — ver `src/http/routes/admin.routes.ts`,
`src/auth/core/platform-operator-allowlist.ts`, `PLATFORM_OPERATOR_GITHUB_IDS`/
`PLATFORM_ADMIN_ROUTE_PREFIX`. Ficou de fora dessa primeira rodada, de
propósito:

- **UI de verdade (React)** — só a API existe; o front constrói a tela, ver
  `.spec/api-reference/platform-admin.md`.
- **Deletar/arquivar plano** — só `create`/`update` hoje.
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
