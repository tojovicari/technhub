# Platform Admin — Tenant Management API

> **Versão:** v1  
> **Status:** 📋 planejado  
> **Permissão base:** `platform_role: super_admin | platform_admin`  
> **Base URL:** `/api/v1`  
> **OpenAPI:** [platform-admin-v1.yaml](../openapi/platform-admin-v1.yaml)

---

## Visão Geral

Endpoints para o super_admin e platform_admin enxergarem e gerenciarem a base de tenants (clientes) da plataforma.

**Estes endpoints NÃO existem ainda.** Este documento é o contrato para implementação.

---

## Schemas compartilhados

### TenantSummary (usado em listagens)

```typescript
{
  id: string; // ID do tenant
  name: string; // Nome da organização
  slug: string; // Slug único
  created_at: string; // ISO 8601
  subscription: {
    id: string;
    status: "trialing" |
      "active" |
      "past_due" |
      "downgraded" |
      "cancelled" |
      "expired";
    plan: {
      id: string;
      name: string; // ex: "pro"
      display_name: string; // ex: "Pro"
      price_cents: number;
      billing_period: "monthly" | "annual";
    }
    current_period_end: string; // ISO 8601
    trial_ends_at: string | null; // ISO 8601 ou null
    past_due_since: string | null;
    cancelled_at: string | null;
  }
  usage: {
    seats_used: number;
    integrations_used: number;
  }
  accounts_count: number; // total de usuários ativos no tenant
  mrr_cents: number; // contribuição mensal (Math.round(annual / 12) para billing_period=annual; 0 para Free)
}
```

### TenantDetail (usado em detalhe)

```typescript
{
  // todos os campos de TenantSummary, mais:
  subscription: {
    // todos os campos de TenantSummary.subscription, mais:
    provider: string | null;                  // "stripe" | null (null = manual)
    provider_subscription_id: string | null;
    provider_customer_id: string | null;
    scheduled_downgrade_plan: {
      id: string;
      name: string;
      display_name: string;
    } | null;
    pending_plan_changes: Record<string, unknown> | null;
    downgraded_at: string | null;
    data_deletion_scheduled_at: string | null;
  };
  accounts: Array<{
    id: string;
    email: string;
    full_name: string;
    role: "org_admin" | "manager" | "viewer";
    is_active: boolean;
    last_login_at: string | null;
    created_at: string;
  }>;
  recent_events: Array<{
    id: string;
    event_type: string;
    provider: string | null;
    occurred_at: string;
  }>;  // últimos 5 eventos de billing
}
```

### SubscriptionHistoryEntry

```typescript
{
  id: string;
  subscription_id: string;
  plan: {
    id: string;
    name: string;
    display_name: string;
    price_cents: number;
  }
  status: string;
  effective_from: string; // ISO 8601
  reason: string | null;
  created_at: string;
}
```

---

## GET /platform/tenants

Lista todos os tenants com informações de subscription e usage.

**Permissão:** `platform_role: super_admin | platform_admin`

### Query params

| Param     | Tipo    | Obrigatório | Default | Notas                                                                                           |
| --------- | ------- | ----------- | ------- | ----------------------------------------------------------------------------------------------- |
| `status`  | string  | ❌          | —       | Filtra por status da subscription: `trialing\|active\|past_due\|downgraded\|cancelled\|expired` |
| `plan_id` | uuid    | ❌          | —       | Filtra tenants no plano especificado                                                            |
| `search`  | string  | ❌          | —       | Busca por nome, slug ou email de usuário (min 2 chars)                                          |
| `limit`   | integer | ❌          | `20`    | Máx 100                                                                                         |
| `cursor`  | string  | ❌          | —       | UUID do último item retornado (cursor de paginação)                                             |

> **Atenção cursor:** O cursor é scoped ao conjunto de filtros ativo. Ao alterar `status`, `plan_id` ou `search`, o cursor deve ser resetado para `null`.
>
> O cursor é **opaco** para o cliente — sempre um UUID, mas internamente pode ser `Subscription.id` (Via A: quando `status`/`plan_id` fornecido) ou `Tenant.id` (Via B: sem filtros). Nunca reutilize um cursor ao trocar filtros.

> **Sem campo `total`:** `GET /platform/tenants` não retorna contagem total (COUNT de todos os tenants é caro). Use `next_cursor === null` para detectar fim da lista.

> **Páginas sub-preenchidas (Via A + search):** ao combinar `status`/`plan_id` com `search`, a página pode retornar menos itens que `limit` mesmo havendo mais dados. Isso ocorre quando `search` filtra alguns dos tenant IDs retornados pela subscription query. Continue paginando enquanto `next_cursor !== null`.

### Resposta — 200 OK

```json
{
  "data": {
    "tenants": [
      {
        "id": "ten_abc123",
        "name": "Acme Corp",
        "slug": "acme",
        "created_at": "2026-01-15T09:00:00.000Z",
        "subscription": {
          "id": "sub_xyz",
          "status": "active",
          "plan": {
            "id": "plan_pro",
            "name": "pro",
            "display_name": "Pro",
            "price_cents": 14900,
            "billing_period": "monthly"
          },
          "current_period_end": "2026-05-15T09:00:00.000Z",
          "trial_ends_at": null,
          "past_due_since": null,
          "cancelled_at": null
        },
        "usage": {
          "seats_used": 8,
          "integrations_used": 3
        },
        "accounts_count": 8,
        "mrr_cents": 14900
      }
    ],
    "next_cursor": "ten_xyz456"
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando                       |
| ------ | -------------- | ---------------------------- |
| 401    | `UNAUTHORIZED` | Token inválido ou ausente    |
| 403    | `FORBIDDEN`    | `platform_role` insuficiente |

---

## GET /platform/tenants/:tenant_id

Detalhe completo de um tenant: subscription, usuários, integrações e eventos recentes.

**Permissão:** `platform_role: super_admin | platform_admin`

### Path params

| Param       | Tipo | Notas        |
| ----------- | ---- | ------------ |
| `tenant_id` | uuid | ID do tenant |

### Resposta — 200 OK

```json
{
  "data": {
    "id": "ten_abc123",
    "name": "Acme Corp",
    "slug": "acme",
    "created_at": "2026-01-15T09:00:00.000Z",
    "subscription": {
      "id": "sub_xyz",
      "status": "active",
      "plan": {
        "id": "plan_pro",
        "name": "pro",
        "display_name": "Pro",
        "price_cents": 14900,
        "billing_period": "monthly"
      },
      "current_period_end": "2026-05-15T09:00:00.000Z",
      "trial_ends_at": null,
      "past_due_since": null,
      "cancelled_at": null,
      "downgraded_at": null,
      "data_deletion_scheduled_at": null,
      "provider": "stripe",
      "provider_subscription_id": "sub_stripe123",
      "provider_customer_id": "cus_stripe456",
      "scheduled_downgrade_plan": null,
      "pending_plan_changes": null
    },
    "usage": {
      "seats_used": 8,
      "integrations_used": 3
    },
    "accounts": [
      // cap interno: até 100 contas; suficiente para v1
      {
        "id": "acc_001",
        "email": "admin@acme.com",
        "full_name": "Jane Doe",
        "role": "org_admin",
        "is_active": true,
        "last_login_at": "2026-04-21T14:30:00.000Z",
        "created_at": "2026-01-15T09:00:00.000Z"
      }
    ],
    "recent_events": [
      {
        "id": "evt_001",
        "event_type": "invoice.paid",
        "provider": "stripe",
        "occurred_at": "2026-04-15T00:00:00.000Z"
      }
    ]
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando                |
| ------ | -------------- | --------------------- |
| 401    | `UNAUTHORIZED` | —                     |
| 403    | `FORBIDDEN`    | —                     |
| 404    | `NOT_FOUND`    | Tenant não encontrado |

---

## GET /platform/tenants/:tenant_id/subscription-history

Histórico cronológico de mudanças de plano do tenant.

**Permissão:** `platform_role: super_admin | platform_admin`

### Query params

| Param    | Tipo    | Default | Notas                                                                     |
| -------- | ------- | ------- | ------------------------------------------------------------------------- |
| `limit`  | integer | `20`    | Máx 100                                                                   |
| `cursor` | string  | —       | `effectiveFrom` do último `SubscriptionHistoryEntry` retornado (ISO 8601) |

> O cursor é o valor de `effective_from` do último item da página anterior, não o `id`.
> Isso porque a ordenação é por `effectiveFrom DESC` e o índice é `[subscriptionId, effectiveFrom]`.
> O `next_cursor` no response conterá o `effective_from` do último item quando houver mais páginas.

### Resposta — 200 OK

```json
{
  "data": {
    "entries": [
      {
        "id": "hist_001",
        "subscription_id": "sub_xyz",
        "plan": {
          "id": "plan_pro",
          "name": "pro",
          "display_name": "Pro",
          "price_cents": 14900
        },
        "status": "active",
        "effective_from": "2026-03-01T00:00:00.000Z",
        "reason": "checkout_completed",
        "created_at": "2026-03-01T00:00:15.000Z"
      },
      {
        "id": "hist_000",
        "subscription_id": "sub_xyz",
        "plan": {
          "id": "plan_free",
          "name": "free",
          "display_name": "Free",
          "price_cents": 0
        },
        "status": "active",
        "effective_from": "2026-01-15T09:00:00.000Z",
        "reason": "initial_registration",
        "created_at": "2026-01-15T09:00:00.000Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando                |
| ------ | -------------- | --------------------- |
| 401    | `UNAUTHORIZED` | —                     |
| 403    | `FORBIDDEN`    | —                     |
| 404    | `NOT_FOUND`    | Tenant não encontrado |

---

## GET /platform/billing/plans/:plan_id/tenants

Lista os tenants atualmente no plano especificado.

**Permissão:** `platform_role: super_admin | platform_admin`

> Complementa o campo `active_subscriptions_count` já existente em `GET /platform/billing/plans/:id` — mostra quem são, não só a contagem.

### Query params

| Param    | Tipo    | Default | Notas                             |
| -------- | ------- | ------- | --------------------------------- |
| `status` | string  | —       | Filtra por status da subscription |
| `limit`  | integer | `20`    | Máx 100                           |
| `cursor` | string  | —       | Cursor de paginação               |

### Resposta — 200 OK

```json
{
  "data": {
    "plan": {
      "id": "plan_pro",
      "name": "pro",
      "display_name": "Pro"
    },
    "tenants": [
      {
        "id": "ten_abc123",
        "name": "Acme Corp",
        "slug": "acme",
        "subscription_status": "active",
        "current_period_end": "2026-05-15T09:00:00.000Z",
        "mrr_cents": 14900
      }
    ],
    "next_cursor": null,
    "total": 12
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando               |
| ------ | -------------- | -------------------- |
| 401    | `UNAUTHORIZED` | —                    |
| 403    | `FORBIDDEN`    | —                    |
| 404    | `NOT_FOUND`    | Plano não encontrado |

---

## Notas de implementação

### Query de listagem (GET /platform/tenants)

A estratégia varia de acordo com os filtros presentes:

**Via A — quando `status` ou `plan_id` fornecido (filter-first):**

```typescript
// 1. Buscar subscriptions que atendem aos filtros
const subscriptions = await prisma.subscription.findMany({
  where: {
    ...(status ? { status } : {}),
    ...(plan_id ? { planId: plan_id } : {}),
    ...(cursor ? { id: { lt: cursor } } : {}),
  },
  include: { plan: true },
  orderBy: { createdAt: "desc" },
  take: limit + 1,
});

const tenantIds = subscriptions.map((s) => s.tenantId);

// 2. Buscar tenants dessas subscriptions (+ filtro de search se houver)
const tenants = await prisma.tenant.findMany({
  where: {
    id: { in: tenantIds },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  },
});

// Reindexar tenants por id para join O(1)
const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t]));

// 3. Montar response: iterar sobre subscriptions (máximo limit itens),
//    filtrar as que não têm tenant correspondente (search eliminou)
const hasMore = subscriptions.length > filters.limit;
const page = hasMore ? subscriptions.slice(0, -1) : subscriptions;

const result = page
  .filter((s) => tenantMap[s.tenantId] !== undefined) // ← obrigatório quando search presente
  .map((s) => ({
    ...tenantMap[s.tenantId],
    subscription: s,
    // usage, mrr_cents vem dos maps gerados no batch abaixo
  }));

// next_cursor = s.id do último item de `page` (Subscription.id)
const nextCursor = hasMore ? page[page.length - 1].id : null;
```

> **Por que filter-first?** Se `status=past_due` e só 5 de 20 tenants estão nesse status,
> buscar tenants primeiro quebraria a paginação — o `take` seria aplicado ao total de tenants,
> não ao subconjunto filtrado.
>
> **Limitação Via A + search:** quando `status`/`plan_id` e `search` são combinados, a busca é
> restrita a `name` e `slug` do tenant. A busca por **email de conta não é aplicada**
> neste cenário (seria necessário um JOIN adicional). Documentar no frontend.

**Via B — sem `status`/`plan_id` (tenant-first):**

```typescript
// 1. Buscar tenants com search e paginação
const tenants = await prisma.tenant.findMany({
  where: {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
            {
              platformAccounts: {
                some: { email: { contains: search, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
    ...(cursor ? { id: { lt: cursor } } : {}),
  },
  // Não incluir platformAccounts aqui — accounts_count vem do groupBy batch abaixo
  orderBy: { createdAt: "desc" },
  take: limit + 1,
});

const tenantIds = tenants.map((t) => t.id);

// 2. Buscar subscriptions de todos os tenants em um batch
const subscriptions = await prisma.subscription.findMany({
  where: { tenantId: { in: tenantIds } },
  include: { plan: true },
});

const subMap = Object.fromEntries(subscriptions.map((s) => [s.tenantId, s]));
```

### Batch de usage (ambas as vias)

```typescript
// 2 queries para todos os tenants da página — não getUsage() em loop
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
```

### Cálculo de MRR por tenant

```typescript
function calcMrr(subscription: Subscription & { plan: Plan }): number {
  const { status, plan } = subscription;
  if (!["active", "trialing", "past_due"].includes(status)) return 0;
  if (plan.priceCents === 0) return 0;
  return plan.billingPeriod === "annual"
    ? Math.round(plan.priceCents / 12)
    : plan.priceCents;
}
```

### Filtro por status quando existe plan_id

Quando `plan_id` e `status` são fornecidos juntos, ambos aplicam-se na query de `Subscription` (Via A):

```
WHERE planId = :plan_id AND status = :status
```

> **Limitação conhecida de cursor:** O padrão `id: { lt: cursor }` é consistente com outros endpoints
> (`listAllPlans`, `listBillingEvents`), mas UUID v4 não é lexicograficamente ordenável.
> O cursor funciona como pós-condição de exclusão, podendo pular registros em criações
> simultâneas. Aceito para v1.
