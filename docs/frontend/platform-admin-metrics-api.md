# Platform Admin — Revenue Metrics API

> **Versão:** v1  
> **Status:** 📋 planejado  
> **Permissão base:** `platform_role: super_admin | platform_admin`  
> **Base URL:** `/api/v1`  
> **OpenAPI:** [platform-admin-v1.yaml](../openapi/platform-admin-v1.yaml)

---

## Visão Geral

Endpoint de métricas financeiras da plataforma: MRR, ARR, distribuição por plano, churn e movimentação de subscriptions por período.

**Este endpoint NÃO existe ainda.** Este documento é o contrato para implementação.

> ⚠️ **Nota sobre MRR e planos anuais:** o MRR de um plano `billing_period = "annual"` é calculado como `Math.round(price_cents / 12)`. O ARR é `MRR × 12`. Subscriptions com `status = cancelled, expired` não entram no MRR.

---

## GET /platform/billing/metrics

Retorna métricas financeiras agregadas da plataforma para um período.

**Permissão:** `platform_role: super_admin | platform_admin`

### Query params

| Param    | Tipo   | Obrigatório | Default      | Notas                                            |
| -------- | ------ | ----------- | ------------ | ------------------------------------------------ |
| `period` | string | ❌          | `"last_30d"` | `last_30d \| last_90d \| last_12m \| mtd \| ytd` |

### Definição dos períodos

| Valor      | Intervalo                           |
| ---------- | ----------------------------------- |
| `last_30d` | hoje − 30 dias até hoje             |
| `last_90d` | hoje − 90 dias até hoje             |
| `last_12m` | hoje − 12 meses até hoje            |
| `mtd`      | 1º dia do mês atual até hoje        |
| `ytd`      | 1º de janeiro do ano atual até hoje |

### Resposta — 200 OK

```json
{
  "data": {
    "period": "last_30d",
    "period_start": "2026-03-23T00:00:00.000Z",
    "period_end": "2026-04-22T14:30:00.000Z",
    "calculated_at": "2026-04-22T14:30:00.000Z",

    "mrr_cents": 227800,
    "arr_cents": 2733600,

    "subscriptions": {
      "total_active": 29,
      "by_status": {
        "trialing": 4,
        "active": 23,
        "past_due": 2,
        "downgraded": 3,
        "cancelled": 5,
        "expired": 1
      }
    },

    "period_movements": {
      "new_subscriptions": 6,
      "upgrades": 2,
      "downgrades": 1,
      "churned": 1,
      "reactivated": 0
    },

    "churn_rate_percent": 3.23,

    "by_plan": [
      {
        "plan_id": "plan_enterprise_id",
        "plan_name": "enterprise",
        "plan_display_name": "Enterprise",
        "billing_period": "annual",
        "price_cents": 0,
        "active_subscriptions": 2,
        "mrr_cents": 0
      },
      {
        "plan_id": "plan_pro_id",
        "plan_name": "pro",
        "plan_display_name": "Pro",
        "billing_period": "monthly",
        "price_cents": 14900,
        "active_subscriptions": 12,
        "mrr_cents": 178800
      },
      {
        "plan_id": "plan_starter_id",
        "plan_name": "starter",
        "plan_display_name": "Starter",
        "billing_period": "monthly",
        "price_cents": 4900,
        "active_subscriptions": 10,
        "mrr_cents": 49000
      },
      {
        "plan_id": "plan_free_id",
        "plan_name": "free",
        "plan_display_name": "Free",
        "billing_period": "monthly",
        "price_cents": 0,
        "active_subscriptions": 5,
        "mrr_cents": 0
      }
    ]
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando                       |
| ------ | -------------- | ---------------------------- |
| 400    | `BAD_REQUEST`  | `period` inválido            |
| 401    | `UNAUTHORIZED` | Token inválido ou ausente    |
| 403    | `FORBIDDEN`    | `platform_role` insuficiente |

---

## Definições dos campos

### MRR e ARR

```
mrr_cents = soma de priceCents (para monthly) + Math.round(priceCents / 12) (para annual)
            de todas subscriptions com status IN (active, trialing, past_due)

arr_cents = mrr_cents × 12
```

> Subscriptions com `provider = null` (atribuídas manualmente) com `price_cents = 0` retornam `mrr_cents = 0` e não entram no cálculo (ex: Enterprise em free trial / parceiros). Se quiser rastrear receita manual, o plano deve ter `price_cents > 0`.

### Churn rate

```
churn_rate_percent = (churned / total_active_start_of_period) × 100

churned = subscriptions que mudaram para cancelled ou expired no período
total_active_start_of_period = count de subscriptions com createdAt <= periodStart
                               (aproximação v1 — inclui todos os status, não apenas active)
```

### Period movements

| Campo               | Definição                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new_subscriptions` | Subscriptions criadas no período (via `Subscription.createdAt`)                                                                                                                                      |
| `upgrades`          | `SubscriptionHistory` onde o plano novo tem `price_cents` maior que o anterior, no período                                                                                                           |
| `downgrades`        | `SubscriptionHistory` onde o plano novo tem `price_cents` menor que o anterior, no período                                                                                                           |
| `churned`           | Subscriptions que entraram em `cancelled` ou `expired` no período                                                                                                                                    |
| `reactivated`       | Subscriptions reativadas manualmente por admin no período — contadas via `BillingEvent.eventType = 'subscription.admin_reactivate'`. Reativações automáticas via Stripe não são contabilizadas aqui. |

---

## Notas de implementação

### Query de MRR por plano

```typescript
// Buscar todas subscriptions ativas com o plano
const subscriptions = await prisma.subscription.findMany({
  where: {
    status: { in: ["active", "trialing", "past_due"] },
  },
  include: { plan: true },
});

// Agrupar por plano e calcular MRR
const byPlan = subscriptions.reduce(
  (acc, sub) => {
    const planId = sub.plan.id;
    if (!acc[planId]) {
      acc[planId] = {
        plan_id: planId,
        plan_name: sub.plan.name,
        plan_display_name: sub.plan.displayName,
        billing_period: sub.plan.billingPeriod,
        price_cents: sub.plan.priceCents,
        active_subscriptions: 0,
        mrr_cents: 0,
      };
    }
    acc[planId].active_subscriptions++;
    acc[planId].mrr_cents +=
      sub.plan.billingPeriod === "annual"
        ? Math.round(sub.plan.priceCents / 12)
        : sub.plan.priceCents;
    return acc;
  },
  {} as Record<string, any>,
);
```

### Query de movimentos no período

```typescript
// Novos (por Subscription.createdAt)
const newCount = await prisma.subscription.count({
  where: { createdAt: { gte: periodStart, lte: periodEnd } },
});

// Churn (por SubscriptionHistory)
const churned = await prisma.subscriptionHistory.count({
  where: {
    status: { in: ["cancelled", "expired"] },
    effectiveFrom: { gte: periodStart, lte: periodEnd },
  },
});

// Reactivated (por BillingEvent — não usar SubscriptionHistory.reason, é texto livre)
const reactivated = await prisma.billingEvent.count({
  where: {
    eventType: "subscription.admin_reactivate",
    occurredAt: { gte: periodStart, lte: periodEnd },
  },
});

// Upgrades e downgrades requerem duas queries:
// 1. Buscar entradas com effectiveFrom no período (plano novo)
// 2. Para cada subscriptionId, buscar o entry imediatamente ANTES de periodStart (baseline)
// Comparar price_cents do baseline vs. entry no período.
// ⚠️ Query apenas dentro do período não fornece o baseline — a maioria dos "anteriores"
//    está fora da janela e não aparece no resultado.
```

### Sobre cache

Este endpoint **não deve ter cache de longo prazo** — os dados mudam com frequência (webhooks Stripe, jobs de billing). Se performance for problema com > 10k subscriptions, adicionar cache de 5 minutos com invalidação por evento de webhook.

---

## UI sugerida para o frontend

### Cards de topo

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   MRR       │  │  Tenants    │  │  Churn      │  │  Novos      │
│  $2,278/mo  │  │  29 ativos  │  │  3.2%       │  │  6 este mês │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

### Breakdown por plano (tabela ou pie chart)

| Plano      | Tenants | MRR        |
| ---------- | ------- | ---------- |
| Pro        | 12      | $1,788/mo  |
| Starter    | 10      | $490/mo    |
| Enterprise | 2       | — (manual) |
| Free       | 5       | —          |

### Alertas automáticos sugeridos

Com base na resposta desta API, o frontend pode exibir alertas contextuais:

```typescript
if (metrics.subscriptions.by_status.past_due > 0) {
  // ⚠️ "X tenants com pagamento pendente"
}

if (metrics.churn_rate_percent > 5) {
  // 🔴 "Churn acima de 5% no período"
}

if (metrics.period_movements.upgrades > metrics.period_movements.downgrades) {
  // ✅ "Net revenue expansion positivo"
}
```
