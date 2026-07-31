# Backlog

Itens levantados mas não priorizados/implementados ainda. Não é spec — quando
um item aqui for pra frente de verdade, o desenho real vai pra
`.spec/spec-engineering-intelligence.md` (fonte da verdade), não fica só
aqui.

## Escalar `/internal/sync` além de poucos tenants

**Contexto**: `POST /internal/sync` (`src/http/routes/internal.routes.ts`) processa
toda integração `ACTIVE` de todo tenant `ACTIVE` — hoje via
`SyncOrchestrator.runBatch`, que dispara um `Promise.all` com uma chamada por
integração de uma vez só. O cron que disparava isso (`.github/workflows/sync.yml`)
foi **desligado de propósito** (só `workflow_dispatch` manual por enquanto) até isso
ser resolvido.

**Gargalos identificados** (não é o Fly.io/CPU — é I/O-bound, aguenta concorrência):

1. **Pool de conexões do Postgres sem `max` configurado** (`src/database/pool.ts:16`,
   `new Pool({ connectionString: ... })`) — default da lib `pg` é **10 conexões**.
   Com centenas/milhares de integrações disparando `withTenantContext` ao mesmo
   tempo, só 10 avançam por vez, o resto fica na fila — a chamada toda fica
   progressivamente mais lenta conforme a base de tenants cresce.
2. **Listagem de integrações por tenant é sequencial** (`internal.routes.ts`, loop
   `for (const tenant of tenants)` com `await` dentro) — um round-trip ao banco por
   tenant, um de cada vez, antes mesmo de começar a sincronizar.

**Direção provável**: configurar `max` explícito no pool (dimensionado pro que o
Postgres gerenciado do Fly aguenta) e trocar o `Promise.all` de tudo de uma vez por
lotes menores processados em sequência (ou com um limite de concorrência). Precisa
de número real de tenants/integrações esperado antes de dimensionar direito — não
faz sentido chutar agora.

## Painel de administração do SaaS (dono da plataforma, cross-tenant)

**Contexto**: hoje o RBAC (`ADMIN`/`GESTOR`/`USUARIO`, CLAUDE.md) é todo **escopado a
um tenant** — mesmo `ADMIN` só enxerga/gerencia o próprio tenant (faturamento
incluso: `billing.routes.ts`, cada tenant faz seu próprio checkout/portal via
Stripe, `requireSameTenant` em toda rota). Não existe hoje nenhum papel que enxergue
**todos os tenants ao mesmo tempo** — quem opera o SaaS em si (não um cliente, o
dono da plataforma) não tem painel próprio.

**Escopo levantado pelo usuário**: um "gestor do SaaS", separado do `ADMIN` de
tenant, que contemple pelo menos:

- Controle de planos — já existe uma tabela real (`plans`, via `PlanRepository`,
  populada por migration/seed), mas só leitura hoje (`findByName`/`findById`/
  `findPublicActive`, sem `create`/`update`). Um painel de dono-de-SaaS precisaria
  de CRUD de verdade aqui.
- Assinaturas de todos os tenants numa visão só (hoje só dá pra ver uma de cada vez,
  via `GET /tenants/:tenantId/billing/subscription`).
- Meios de pagamento — já usa Stripe (`billing.routes.ts`/`billing-webhook.routes.ts`),
  precisa decidir o que esse painel expõe que o Stripe Dashboard já não resolve
  sozinho (evitar reconstruir o que o próprio Stripe já oferece).

**Não desenhado ainda** — decisões em aberto antes de virar plano de verdade:

- Isso é um `systemRole` novo (`SUPER_ADMIN`?), ou uma pessoa/mecanismo totalmente
  fora do modelo de `users`/`tenants` atual (já que hoje todo `User` pertence a
  exatamente um tenant, `users.tenant_id NOT NULL` — um "dono do SaaS" não se encaixa
  nesse modelo sem mudança de schema)?
- Fica num app/rota separado (`/admin/*`, fora do namespace `/tenants/:tenantId/*`)
  ou dentro da mesma API?
- Autenticação separada da SSO-first atual (que resolve tenant a partir do email
  depois do OAuth) — um dono de SaaS não tem "um tenant" pra resolver.
