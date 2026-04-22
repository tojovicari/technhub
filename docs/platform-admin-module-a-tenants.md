# Módulo A — Gestão de Tenants

> **Status:** 📋 planejado — aguardando implementação  
> **Prioridade:** 🔴 Alta  
> **Depende de:** billing v1 (Subscription, Plan, BillingEvent — já implementados)  
> **Migration necessária:** ❌ nenhuma  
> **Contrato de API:** [platform-admin-tenants-api.md](./frontend/platform-admin-tenants-api.md)  
> **OpenAPI:** [platform-admin-v1.yaml](./openapi/platform-admin-v1.yaml)

---

## 1. Objetivo

Dar visibilidade sobre a base de tenants (clientes) do SaaS. Hoje o admin é plan-centric — você vê planos, não clientes. O Módulo A inverte isso: você lista tenants, filtra por status, abre o detalhe de um cliente e vê o histórico completo de planos.

---

## 2. Endpoints a implementar

| Método | Rota                                                | Auth                         | O que faz                                                 |
| ------ | --------------------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| GET    | `/platform/tenants`                                 | super_admin / platform_admin | Lista todos os tenants com subscription + usage + MRR     |
| GET    | `/platform/tenants/:tenant_id`                      | super_admin / platform_admin | Detalhe do tenant: subscription completa, contas, eventos |
| GET    | `/platform/tenants/:tenant_id/subscription-history` | super_admin / platform_admin | Histórico cronológico de mudanças de plano                |
| GET    | `/platform/billing/plans/:plan_id/tenants`          | super_admin / platform_admin | Quem está em um plano específico                          |

---

## 3. Arquivos a criar/modificar

```
src/modules/billing/
├── platform-routes.ts          ← adicionar as 4 rotas novas
├── service.ts                  ← adicionar 4 funções de serviço
└── schema.ts                   ← adicionar listTenantsQuerySchema
```

---

## 4. Funções de serviço a adicionar (`service.ts`)

### `listTenants(filters)`

```typescript
type ListTenantsFilters = {
  status?: string;
  plan_id?: string;
  search?: string;
  cursor?: string;
  limit: number;
};

export async function listTenants(filters: ListTenantsFilters) {
  // ESTRATÉGIA DE DUAS VIAS — veja nota abaixo
  //
  // Via A — quando status ou plan_id fornecido (filter-first):
  //   1. Query Subscription WHERE status/planId (+ cursor: id < cursor)
  //   2. Extrair tenantIds → Query Tenant WHERE id IN (tenantIds) + search
  //   3. Join manual dos resultados
  //   ⚠️ next_cursor = SUBSCRIPTION.id do último item (não Tenant.id)
  //      pois a paginação é sobre Subscription, não Tenant
  //
  // Via B — sem status/plan_id (tenant-first):
  //   1. Query Tenant WHERE search (+ cursor: id < cursor) com take: limit+1
  //   2. Query Subscription WHERE tenantId IN (ids) — um batch
  //   ⚠️ next_cursor = TENANT.id do último item
  //
  // Cursor é opaco para o cliente (sempre UUID); server sabe qual type usar
  // com base nos filtros presentes. Mudar filtros = resetar cursor.
  //
  // Em ambas as vias:
  //   - Batch usage com groupBy (seats + integrations) — NÃO getUsage() por tenant
  //   - Calcular mrr_cents
  //   - Retornar paginado com next_cursor
}
```

> **Por que duas vias?** Se `status=past_due` e só 5 de 20 tenants estão nesse status,
> buscar o tenant primeiro e filtrar depois quebraria a paginação — o `take: limit+1`
> seria aplicado ao conjunto de todos os tenants, não ao filtrado.

**Batch de usage (substitui `getUsage()` por tenant no contexto de lista):**

```typescript
// ✅ Correto — 2 queries no total, independente de quantos tenants
const [seatsGrouped, integrationsGrouped] = await Promise.all([
  prisma.platformAccount.groupBy({
    by: ["tenantId"],
    where: { tenantId: { in: tenantIds }, isActive: true },
    _count: { id: true },
  }),
  prisma.integrationConnection.groupBy({
    by: ["tenantId"],
    where: { tenantId: { in: tenantIds }, status: "active" },
    _count: { id: true },
  }),
]);

const seatsMap = Object.fromEntries(
  seatsGrouped.map((r) => [r.tenantId, r._count.id]),
);
const intMap = Object.fromEntries(
  integrationsGrouped.map((r) => [r.tenantId, r._count.id]),
);

// Uso: seatsMap[tenantId] ?? 0
// ❌ Errado — getUsage(tenantId) em loop = 2N queries para N tenants
```

**Cálculo de MRR por tenant:**

```typescript
function calcMrrCents(subscription: Subscription & { plan: Plan }): number {
  if (!["active", "trialing", "past_due"].includes(subscription.status))
    return 0;
  if (subscription.plan.priceCents === 0) return 0;
  return subscription.plan.billingPeriod === "annual"
    ? Math.round(subscription.plan.priceCents / 12)
    : subscription.plan.priceCents;
}
```

### `getTenantDetail(tenantId)`

```typescript
export async function getTenantDetail(tenantId: string) {
  // 1. Verificar existência do tenant
  // 2. Buscar subscription com include: { plan, scheduledDowngradePlan }
  // 3. Buscar platformAccounts SEM filtro de isActive (retornar todos — ativos e inativos),
  //    ordenados por role, com take: 100. O campo isActive é incluído no response.
  //    Cap em 100 contas — suficiente para v1. Se tenant tiver mais,
  //    retornar igualmente (não paginar) mas logar aviso.
  // 4. Buscar últimos 5 billing events (orderBy: occurredAt desc, take: 5)
  // 5. Calcular usage via getUsage(tenantId) — retorna { seats_used, integrations_used }
  //    accounts_count = usage.seats_used
  //    (getUsage já faz platformAccount.count({ isActive: true }) — sem COUNT extra)
  // 6. Retornar formato TenantDetail
}
```

### `getTenantSubscriptionHistory(tenantId, filters)`

```typescript
export async function getTenantSubscriptionHistory(
  tenantId: string,
  filters: { cursor?: string; limit: number },
) {
  // 1. Buscar subscription do tenant para obter subscription.id
  //    (retornar 404 se não encontrado)
  // 2. Query em SubscriptionHistory WHERE subscriptionId = sub.id
  // 3. Include plan (id, name, displayName, priceCents)
  // 4. Ordenar por effectiveFrom DESC
  //    Cursor: usar effectiveFrom < last_effectiveFrom (não id < cursor)
  //    porque id é UUID v4 e não é ordenável — índice é [subscriptionId, effectiveFrom]
  //    next_cursor = effectiveFrom.toISOString() do último item retornado
  // 5. Retornar paginado
}
```

### `getPlanTenants(planId, filters)`

```typescript
export async function getPlanTenants(
  planId: string,
  filters: { status?: string; cursor?: string; limit: number },
) {
  // 1. Verificar existência do plano
  // 2. Query em Subscription WHERE planId AND (status filter) + cursor + take: limit+1
  // 3. Batch: buscar nome/slug dos tenants em UMA query
  //    prisma.tenant.findMany({ where: { id: { in: tenantIds } } })
  //    NÃO: prisma.tenant.findUnique() por tenantId em loop (N+1)
  // 4. Calcular mrr_cents
  // 5. COUNT total: prisma.subscription.count({
  //      where: { planId, ...(filters.status ? { status: filters.status } : {}) }
  //    }) — reflete o filtro de status; SEM filtro = total do plano
  // 6. Retornar com plan summary + data[] paginado + total
}
```

---

## 5. Schema Zod a adicionar (`schema.ts`)

```typescript
export const listTenantsQuerySchema = z.object({
  status: z
    .enum([
      "trialing",
      "active",
      "past_due",
      "downgraded",
      "cancelled",
      "expired",
    ])
    .optional(),
  plan_id: z.string().uuid().optional(),
  search: z.string().min(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const listPlanTenantsQuerySchema = z.object({
  status: z
    .enum([
      "trialing",
      "active",
      "past_due",
      "downgraded",
      "cancelled",
      "expired",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const subscriptionHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // cursor = effectiveFrom do último item (ISO 8601) — não UUID
  cursor: z.string().datetime({ offset: true }).optional(),
});
```

---

## 6. Migration necessária

**Nenhuma.** Todos os dados já existem:

| Dado                                   | Origem                        |
| -------------------------------------- | ----------------------------- |
| Tenant (id, name, slug)                | `Tenant`                      |
| Subscription (status, planId, etc.)    | `Subscription`                |
| Plan (name, priceCents, billingPeriod) | `Plan`                        |
| Usuários                               | `PlatformAccount`             |
| Histórico de planos                    | `SubscriptionHistory`         |
| Eventos                                | `BillingEvent`                |
| Usage (seats)                          | `PlatformAccount.count`       |
| Usage (integrations)                   | `IntegrationConnection.count` |

---

## 7. Performance

A listagem de tenants faz múltiplas sub-queries. Estratégia para manter performance:

1. **Filter-first quando `status`/`plan_id` presentes** — query na `Subscription` primeiro, extrair tenantIds, depois buscar `Tenant`. Evita trazer tenants sem relevância para paginação.
   - ⚠️ **Páginas sub-preenchidas:** quando `search` é combinado com `status`/`plan_id` (Via A), a busca de tenants por nome/slug pode filtrar alguns IDs do resultado de subscriptions. A página retornada pode ter menos itens que `limit` mesmo existindo mais dados. Comportamento aceito para v1 — documentado no contrato.
2. **Tenant-first quando só `search`** — query em `Tenant` com filtro, depois `Subscription` em um batch `WHERE tenantId IN (...)`.
3. **Usage em batch com `groupBy`** — 2 queries para todos os tenants da página. Nunca `getUsage()` em loop.
4. **Índices existentes** que cobrem os campos de filtro:
   - `Subscription.status` ✅ (`@@index([status])`)
   - `Subscription.tenantId` ✅ (implícito pelo `@unique`)
   - `PlatformAccount.tenantId` ✅ (`@@index([tenantId])`)
   - `IntegrationConnection.tenantId` ✅ (`@@index([tenantId])`)
   - `BillingEvent.tenantId` ✅ (`@@index([tenantId])`)
   - (⚠️ `Subscription.planId` — **sem índice explícito** no schema atual; se `plan_id` filter for um filtro frequente, adicionar `@@index([planId])` em uma futura migration)

5. **Cursor strategy** — o padrão atual do codebase usa `id: { lt: cursor }` com `orderBy: createdAt DESC`. UUID v4 não é lexicograficamente ordenável, portanto o cursor não é exato com ordenação por data. É uma limitação conhecida e consistente com `listAllPlans` e `listBillingEvents`. Aceitar para v1; para v2 considerar cursor `opaque` com `createdAt`.

   **Exceção:** `getTenantSubscriptionHistory` deve usar `effectiveFrom < last_effectiveFrom` como cursor, pois o índice é `[subscriptionId, effectiveFrom]` e a ordenação é temporal.

   **Resetar cursor no frontend** ao trocar `status`, `plan_id` ou `search` — anotar no guia frontend.

Se `search` for usado frequentemente com > 10k tenants, considerar full-text index em `Tenant.name`.

---

## 8. Acceptance Criteria

- [ ] `GET /platform/tenants` retorna lista paginada com subscription + usage + mrr_cents
- [ ] Filtro `status` usa Via A (filter-first) — paginação correta mesmo com subset pequeno
- [ ] Filtro `plan_id` usa Via A (filter-first) — idem
- [ ] Listagem sem filtros usa Via B (tenant-first)
- [ ] Usage batch com `groupBy` — sem N+1
- [ ] Filtro `search` busca por nome e slug (Via A) ou nome/slug/email (Via B)
- [ ] Campo `total` **não é retornado em `GET /platform/tenants`** — COUNT de todos os tenants é caro; omitido em v1
- [ ] `GET /platform/billing/plans/:id/tenants` **retorna `total`** — COUNT barato (planId indexado)
- [ ] Paginação por cursor funciona; cursor deve ser resetado ao mudar filtros
- [ ] `GET /platform/tenants/:id` retorna detalhe com `accounts[]` e `recent_events[]`
- [ ] `GET /platform/tenants/:id/subscription-history` retorna histórico cronológico
- [ ] `GET /platform/billing/plans/:id/tenants` retorna tenants no plano com MRR
- [ ] Todas as rotas retornam 403 se `platform_role` for null ou tenant-only
- [ ] Retornam 404 quando tenant ou plano não existe

---

## 9. Testes unitários recomendados

```typescript
// service.test.ts
describe("listTenants", () => {
  it("retorna tenants com mrr_cents correto para plano annual (÷12)");
  it("retorna mrr_cents = 0 para status downgraded");
  it("filtra por status corretamente");
  it("filtra por plan_id corretamente");
  it("busca por nome via search");
  it("pagina corretamente com cursor");
});

describe("getTenantSubscriptionHistory", () => {
  it("retorna histórico ordenado por effectiveFrom DESC");
  it("retorna 404 quando tenant não existe");
});
```
