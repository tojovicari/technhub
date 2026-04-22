# Módulo C — Revenue Metrics (MRR / Churn)

> **Status:** 📋 planejado — aguardando implementação  
> **Prioridade:** 🔴 Alta  
> **Depende de:** billing v1 (Subscription, Plan, SubscriptionHistory — já implementados)  
> **Migration necessária:** ❌ nenhuma  
> **Contrato de API:** [platform-admin-metrics-api.md](./frontend/platform-admin-metrics-api.md)  
> **OpenAPI:** [platform-admin-v1.yaml](./openapi/platform-admin-v1.yaml)

---

## 1. Objetivo

Prover um endpoint de métricas financeiras agregadas da plataforma. Responde perguntas como: "Qual é o MRR atual?", "Quantos tenants churned este mês?", "Em quais planos está concentrada a receita?"

---

## 2. Endpoint a implementar

| Método | Rota                        | Auth                         | O que faz                                                   |
| ------ | --------------------------- | ---------------------------- | ----------------------------------------------------------- |
| GET    | `/platform/billing/metrics` | super_admin / platform_admin | MRR, ARR, breakdown por plano, movimentos do período, churn |

### Query params

| Param    | Tipo   | Default    | Valores aceitos                                  |
| -------- | ------ | ---------- | ------------------------------------------------ |
| `period` | string | `last_30d` | `last_30d \| last_90d \| last_12m \| mtd \| ytd` |

---

## 3. Arquivos a criar/modificar

```
src/modules/billing/
├── platform-routes.ts      ← adicionar GET /platform/billing/metrics
└── service.ts              ← adicionar getRevenueMetrics()
```

Sem schema Zod novo — apenas validação inline do `period` via enum.

---

## 4. Função de serviço a adicionar (`service.ts`)

### `getRevenueMetrics(period)`

```typescript
type MetricsPeriod = "last_30d" | "last_90d" | "last_12m" | "mtd" | "ytd";

export async function getRevenueMetrics(period: MetricsPeriod) {
  const { periodStart, periodEnd } = resolvePeriod(period);

  // Executar em paralelo:
  const [activeSubscriptions, periodHistory, allCounts] = await Promise.all([
    fetchActiveSubscriptions(), // MRR atual
    fetchPeriodHistory(periodStart, periodEnd), // movements
    fetchCountsByStatus(), // breakdown
  ]);

  return buildMetricsResponse({
    activeSubscriptions,
    periodHistory,
    allCounts,
    period,
    periodStart,
    periodEnd,
  });
}
```

---

## 5. Lógica de cálculo

### 5.1 Resolução de período

```typescript
function resolvePeriod(period: MetricsPeriod): {
  periodStart: Date;
  periodEnd: Date;
} {
  const now = new Date();
  const periodEnd = now;
  let periodStart: Date = new Date(now); // inicialização padrão exigida pelo TS (todos os cases cobertos abaixo)
  switch (period) {
    case "last_30d": {
      periodStart = new Date(now);
      periodStart.setDate(periodStart.getDate() - 30);
      break;
    }
    case "last_90d": {
      periodStart = new Date(now);
      periodStart.setDate(periodStart.getDate() - 90);
      break;
    }
    case "last_12m": {
      periodStart = new Date(now);
      periodStart.setMonth(periodStart.getMonth() - 12);
      break;
    }
    case "mtd": {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case "ytd": {
      periodStart = new Date(now.getFullYear(), 0, 1);
      break;
    }
  }
  return { periodStart, periodEnd };
}
```

> `periodEnd` = `now` (momento exato da chamada) — **não é end-of-day**.

### 5.2 MRR e ARR

```typescript
// Buscar subscriptions ativas com plano
const subs = await prisma.subscription.findMany({
  where: { status: { in: ["active", "trialing", "past_due"] } },
  include: { plan: true },
});

let mrrCents = 0;
const byPlan: Record<string, PlanMetrics> = {};

for (const sub of subs) {
  const planMrr =
    sub.plan.billingPeriod === "annual"
      ? Math.round(sub.plan.priceCents / 12)
      : sub.plan.priceCents;

  mrrCents += planMrr;

  if (!byPlan[sub.planId]) {
    byPlan[sub.planId] = {
      plan_id: sub.planId,
      plan_name: sub.plan.name,
      plan_display_name: sub.plan.displayName,
      billing_period: sub.plan.billingPeriod,
      price_cents: sub.plan.priceCents,
      active_subscriptions: 0,
      mrr_cents: 0,
    };
  }
  byPlan[sub.planId].active_subscriptions++;
  byPlan[sub.planId].mrr_cents += planMrr;
}

const arrCents = mrrCents * 12;
```

### 5.3 Breakdown por status (contagem total)

```typescript
const counts = await prisma.subscription.groupBy({
  by: ["status"],
  _count: { _all: true },
});
// Mapear para { trialing: N, active: N, past_due: N, ... }
```

### 5.4 Movimentos no período

Os movimentos usam `SubscriptionHistory` com `effectiveFrom` no intervalo do período:

```typescript
// Novas subscriptions (createdAt no período)
const newCount = await prisma.subscription.count({
  where: { createdAt: { gte: periodStart, lte: periodEnd } },
});

// Churn: subscriptions que entraram em cancelled ou expired no período
const churned = await prisma.subscriptionHistory.count({
  where: {
    status: { in: ["cancelled", "expired"] },
    effectiveFrom: { gte: periodStart, lte: periodEnd },
  },
});

// Reactivated: subscriptions que saíram de downgraded para active no período
// Usar BillingEvent (reason é texto livre do admin — não é confiável para query)
const reactivated = await prisma.billingEvent.count({
  where: {
    eventType: "subscription.admin_reactivate",
    occurredAt: { gte: periodStart, lte: periodEnd },
  },
});
```

**Upgrades e downgrades** requerem comparar o plano novo com o plano _imediatamente anterior_ de cada subscription. Requerem duas queries — a entrada no período **e** o baseline anterior ao período:

```typescript
// Passo 1: buscar entradas do período (planos novos)
const historiesInPeriod = await prisma.subscriptionHistory.findMany({
  where: { effectiveFrom: { gte: periodStart, lte: periodEnd } },
  include: { plan: true },
  orderBy: [{ subscriptionId: "asc" }, { effectiveFrom: "asc" }],
});

// Passo 2: para cada subscriptionId único, buscar a entrada imediatamente
// anterior a periodStart (o baseline de comparação)
const uniqueSubIds = [
  ...new Set(historiesInPeriod.map((h) => h.subscriptionId)),
];

// Prisma não suporta DISTINCT ON / LATERAL JOIN — buscar o último entry antes
// do período para cada sub individualmente (aceitável para volumes normais de subs):
const baselineMap = new Map<string, { priceCents: number }>();
await Promise.all(
  uniqueSubIds.map(async (subId) => {
    const prior = await prisma.subscriptionHistory.findFirst({
      where: { subscriptionId: subId, effectiveFrom: { lt: periodStart } },
      include: { plan: true },
      orderBy: { effectiveFrom: "desc" },
    });
    if (prior) baselineMap.set(subId, { priceCents: prior.plan.priceCents });
  }),
);

// Passo 3: contar upgrades e downgrades comparando price_cents
let upgrades = 0;
let downgrades = 0;
// Usar apenas a primeira entrada por subscription no período (evita dupla contagem)
const seenSubs = new Set<string>();
for (const h of historiesInPeriod) {
  if (seenSubs.has(h.subscriptionId)) continue;
  seenSubs.add(h.subscriptionId);
  const baseline = baselineMap.get(h.subscriptionId);
  if (!baseline) continue; // subscription nova no período — não é up/downgrade
  if (h.plan.priceCents > baseline.priceCents) upgrades++;
  else if (h.plan.priceCents < baseline.priceCents) downgrades++;
}

// ⚠️ NÃO usar `reason` para detectar upgrade/downgrade — é texto livre do admin/webhook
//    e não é confiável como discriminador. Usar diferença de price_cents.
// ⚠️ Se uniqueSubIds for muito grande (> 500), substituir o Promise.all por uma
//    abordagem de raw query ou aceitar a limitação e documentar para v2.
```

### 5.5 Churn rate

```typescript
// Total ativo no início do período (aproximação v1)
// Conta subscriptions criadas ANTES de periodStart, independente do status atual.
// ⚠️ Inclui subscriptions já canceladas antes do período (leve sobrecontagem)
// e exclui subscriptions criadas antes mas já deletadas (sem soft-delete — não aplica).
// Aceito para v1; para v2 usar SubscriptionHistory para reconstruir estado em periodStart.
const activeAtPeriodStart = await prisma.subscription.count({
  where: {
    createdAt: { lte: periodStart },
  },
});

const churnRatePercent =
  activeAtPeriodStart > 0
    ? parseFloat(((churned / activeAtPeriodStart) * 100).toFixed(2))
    : 0;
```

---

## 6. Sobre cache

Este endpoint **não deve usar cache de longo prazo**. Os dados mudam a cada webhook Stripe. Se performance for problema com > 10k subscriptions, adicionar **cache de 5 minutos** com invalidação por evento de webhook `invoice.paid`, `customer.subscription.updated`, etc.

Implementação de cache simples se necessário:

```typescript
// Usar o Map de cache já existente em entitlement.ts como referência
const metricsCache = new Map<
  string,
  { data: MetricsResponse; cachedAt: Date }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
```

---

## 7. Acceptance Criteria

- [ ] `GET /platform/billing/metrics` retorna todos os campos da spec
- [ ] `mrr_cents` para plano `annual` = `Math.round(price_cents / 12)` (arredondamento padrão)
- [ ] `mrr_cents` para subscriptions `downgraded | cancelled | expired` = 0
- [ ] `arr_cents` = `mrr_cents × 12`
- [ ] Parâmetro `period` aceita os 5 valores definidos
- [ ] `churn_rate_percent` calculado corretamente
- [ ] `by_plan` lista todos os planos com subscriptions ativas (inclusive Free com price_cents=0)
- [ ] `period_start` e `period_end` refletem as datas corretas para cada period
- [ ] Retorna 403 se chamado sem `platform_role`
- [ ] `total_active` = soma de `trialing + active + past_due`

---

## 8. Testes unitários recomendados

```typescript
describe("getRevenueMetrics", () => {
  it("calcula MRR corretamente para mix de planos monthly + annual");
  it("exclui subscribers downgraded/cancelled do MRR");
  it("calcula ARR = MRR × 12");
  it("resolvePeriod retorna datas corretas para todos os 5 períodos");
  it("churn_rate_percent = 0 quando não há churn no período");
  it(
    "by_plan inclui planos com 0 assinantes ativas? (não — apenas planos com subs ativas)",
  );
});
```
