# Módulo B — Override de Subscriptions

> **Status:** 📋 planejado — aguardando implementação  
> **Prioridade:** 🔴 Alta  
> **Depende de:** Módulo A (listagem de tenants) + billing v1  
> **Migration necessária:** ✅ sim — campo `graceExtensionDays` em `Subscription`  
> **Contrato de API:** [platform-admin-subscriptions-api.md](./frontend/platform-admin-subscriptions-api.md)  
> **OpenAPI:** [platform-admin-v1.yaml](./openapi/platform-admin-v1.yaml)

---

## 1. Objetivo

Permitir que `super_admins` atribuam e modifiquem subscriptions diretamente, sem fluxo Stripe. Essencial para:

- Clientes **Enterprise** que pagam via wire transfer / nota fiscal (sem cartão de crédito)
- **Contas de parceiros / demo** com acesso avançado gratuito
- **Reativação manual** de tenants que quitaram fora do Stripe
- **Extensão de grace period** quando cliente está em negociação
- **Cancelamento forçado** por não-pagamento confirmado

### ⚠️ Separação de roles

`platform_admin` **não pode usar** nenhum endpoint deste módulo. Somente `super_admin`. Qualquer chamada de `platform_admin` retorna `403`.

---

## 2. Endpoints a implementar

| Método | Rota                                        | Auth                   | O que faz                                         |
| ------ | ------------------------------------------- | ---------------------- | ------------------------------------------------- |
| PUT    | `/platform/tenants/:tenant_id/subscription` | **super_admin apenas** | Force-assign de plano sem Stripe                  |
| PATCH  | `/platform/tenants/:tenant_id/subscription` | **super_admin apenas** | Ações manuais: extend_grace / reactivate / cancel |

---

## 3. Arquivos a criar/modificar

```
src/modules/billing/
├── platform-routes.ts      ← adicionar PUT e PATCH /platform/tenants/:id/subscription
├── service.ts              ← adicionar forceAssignSubscription() e patchSubscription()
└── schema.ts               ← adicionar forceAssignSchema e patchSubscriptionSchema

apps/api/prisma/
└── schema.prisma           ← adicionar graceExtensionDays em Subscription
```

---

## 4. Migration Prisma

```prisma
// Em model Subscription, adicionar:
graceExtensionDays  Int  @default(0)
// Dias extras de grace adicionados manualmente por admin.
// O job enforce-past-due usa: passedDays >= (10 + graceExtensionDays)
```

```bash
npx prisma migrate dev --name add_grace_extension_days
```

---

## 5. Funções de serviço a adicionar (`service.ts`)

### `forceAssignSubscription(tenantId, input)`

```typescript
type ForceAssignInput = {
  plan_id: string;
  status?: "trialing" | "active";
  current_period_end: Date;
  reason: string;
};

export async function forceAssignSubscription(
  tenantId: string,
  input: ForceAssignInput,
) {
  // 1. Verificar existência do tenant
  // 2. Verificar que plano existe e isActive = true
  // ⚠️  Steps 3–5 devem rodar em prisma.$transaction (upsert + SubscriptionHistory + BillingEvent atomicamente)
  // 3. Upsert da Subscription (pode já existir — é uma atualização de plano):
  //    provider = null, providerSubscriptionId = null
  //    providerCustomerId: preservar se já existir — admin pode precisar para cancelar no Stripe manualmente
  //    currentPeriodStart = now(), currentPeriodEnd = input.current_period_end
  //    status = input.status ?? 'active'
  //    trialEndsAt = status === 'trialing' ? input.current_period_end : null
  //    Zerar: pastDueSince, downgradedAt, dataDeletionScheduledAt, cancelledAt
  //    graceExtensionDays = 0  ← reset obrigatório; grace acumulado no ciclo anterior não se aplica ao novo período
  // 4. Criar SubscriptionHistory com reason = input.reason
  // 5. Criar BillingEvent com eventType = 'subscription.admin_force_assign'
  // 6. Invalidar cache de entitlement (fora da transaction — não é crítico ser atômico)
  // 7. Retornar subscription atualizada com plan incluído
}
```

### `patchSubscription(tenantId, action, reason, extensionDays?)`

```typescript
type PatchAction = "extend_grace" | "reactivate" | "cancel";

export async function patchSubscription(
  tenantId: string,
  action: PatchAction,
  reason: string,
  extensionDays?: number,
) {
  // 1. Buscar subscription atual com include: { plan: true }
  //    — necessário para reactivate calcular currentPeriodEnd (plan.billingPeriod)
  //    — e para cancel buscar o plano Free (prisma.plan.findFirst({ where: { name: 'free' } }))
  // 2. Validar pré-condição por ação (ver tabela abaixo)
  // 3. Em prisma.$transaction: aplicar mutação específica + criar BillingEvent (auditoria operacional — sempre)
  //    Criar SubscriptionHistory APENAS para reactivate e cancel (mudança de status)
  //    extend_grace não cria SubscriptionHistory — status não muda, nada a registrar
  // 4. Invalidar cache de entitlement (fora da transaction)
}
```

#### Mutações por ação

| Ação           | Pré-condição                             | Mutação                                                                                                                                    |
| -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `extend_grace` | `status === 'past_due'`                  | `graceExtensionDays += extensionDays`                                                                                                      |
| `reactivate`   | `status === 'downgraded'`                | `status = 'active'`, zerar downgradedAt, dataDeletionScheduledAt, pastDueSince, `graceExtensionDays = 0`; atualizar currentPeriodStart/End |
| `cancel`       | `status IN (trialing, active, past_due)` | `status = 'cancelled'`, `cancelledAt = now()`, setar scheduledDowngradePlanId para Free                                                    |

#### Erros esperados por pré-condição não atendida

```typescript
// extend_grace quando status != past_due:
throw Object.assign(new Error("Subscription is not past_due"), {
  code: "CONFLICT",
  conflict_type: "INVALID_STATUS",
});

// reactivate quando status != downgraded:
throw Object.assign(new Error("Subscription is not downgraded"), {
  code: "CONFLICT",
  conflict_type: "INVALID_STATUS",
});

// cancel quando já está cancelled/expired/downgraded:
throw Object.assign(new Error("Subscription is already cancelled or expired"), {
  code: "CONFLICT",
  conflict_type: "ALREADY_CANCELLED",
});
```

---

## 6. Schemas Zod a adicionar (`schema.ts`)

```typescript
export const forceAssignSchema = z.object({
  plan_id: z.string().uuid(),
  status: z.enum(["trialing", "active"]).default("active"),
  current_period_end: z
    .string()
    .datetime()
    .transform((s) => new Date(s))
    .refine((d) => d > new Date(), {
      message: "current_period_end must be in the future",
    }),
  reason: z.string().min(5),
});

export const patchSubscriptionSchema = z
  .object({
    action: z.enum(["extend_grace", "reactivate", "cancel"]),
    reason: z.string().min(5),
    extension_days: z.number().int().min(1).max(30).optional(),
  })
  .refine(
    (data) =>
      data.action !== "extend_grace" || data.extension_days !== undefined,
    {
      message: "extension_days is required when action is extend_grace",
      path: ["extension_days"],
    },
  );
```

---

## 7. Impacto no job `enforce-past-due`

O job existente precisa ser atualizado para considerar `graceExtensionDays`:

```typescript
// apps/api/src/modules/billing/jobs/enforce-past-due.ts
// Linha que calcula se os 10 dias expiraram — antes:
const graceDays = 10;
// Depois:
const graceDays = 10 + (subscription.graceExtensionDays ?? 0);

const graceExpiredAt = addDays(subscription.pastDueSince!, graceDays);
if (graceExpiredAt <= now) {
  // downgrade
}
```

---

## 8. Auditoria

Toda mutação do Módulo B deve criar um **`BillingEvent`** para auditoria operacional. Ações que alteram status também criam **`SubscriptionHistory`**:

| Ação           | BillingEvent | SubscriptionHistory |
| -------------- | :----------: | :-----------------: |
| `force_assign` |      ✅      |         ✅          |
| `extend_grace` |      ✅      | ❌ status não muda  |
| `reactivate`   |      ✅      |         ✅          |
| `cancel`       |      ✅      |         ✅          |

**`BillingEvent`** — formato padrão:

```typescript
await prisma.billingEvent.create({
  data: {
    tenantId,
    eventType: `subscription.admin_${action}`, // ex: subscription.admin_force_assign
    provider: null,
    rawPayload: {
      admin_account_id: req.user.sub,
      action,
      reason,
      ...(extensionDays ? { extension_days: extensionDays } : {}),
    },
    occurredAt: new Date(),
  },
});
```

---

## 9. Acceptance Criteria

- [ ] `PUT /platform/tenants/:id/subscription` cria ou atualiza subscription com `provider = null`
- [ ] Force-assign cria `SubscriptionHistory` com o reason fornecido
- [ ] Force-assign cria `BillingEvent` de tipo `subscription.admin_force_assign`
- [ ] `PATCH` com `extend_grace` incrementa `graceExtensionDays`
- [ ] `PATCH` com `reactivate` restaura `status = active` e zera campos de downgrade
- [ ] `PATCH` com `cancel` seta `status = cancelled` e scheduledDowngradePlanId para Free
- [ ] Todas as pré-condições inválidas retornam 409 com `conflict_type`
- [ ] `platform_admin` recebe 403 em ambos os endpoints
- [ ] Cache de entitlement invalidado após toda mutação
- [ ] Job `enforce-past-due` respeita `graceExtensionDays` ao calcular deadline

---

## 10. Testes unitários recomendados

```typescript
describe("forceAssignSubscription", () => {
  it("cria subscription nova com provider = null");
  it(
    "atualiza subscription existente preservando providerCustomerId existente",
  );
  it("cria SubscriptionHistory com reason correto");
  it("lança NOT_FOUND quando tenant não existe");
  it("lança NOT_FOUND quando plano não existe");
  it("lança UNPROCESSABLE quando plano está inativo");
});

describe("patchSubscription", () => {
  it("extend_grace: incrementa graceExtensionDays");
  it("extend_grace: lança CONFLICT quando status != past_due");
  it("reactivate: restaura campos corretamente");
  it("cancel: seta cancelledAt e scheduledDowngradePlanId");
  it("cancel: lança CONFLICT quando já cancelado");
});
```
