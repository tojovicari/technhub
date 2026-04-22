# Platform Admin — Subscription Override API

> **Versão:** v1  
> **Status:** 📋 planejado  
> **Permissão base:** `platform_role: super_admin` (⚠️ `platform_admin` bloqueado nos endpoints de write)  
> **Base URL:** `/api/v1`  
> **OpenAPI:** [platform-admin-v1.yaml](../openapi/platform-admin-v1.yaml)

---

## Visão Geral

Endpoints para atribuir e modificar subscriptions manualmente, sem depender do fluxo Stripe. Essencial para:

- Clientes **Enterprise que pagam por fora** (wire transfer, nota fiscal, PO)
- Contas de **parceiros e demo** com acesso avançado
- **Reactivação manual** de tenants que quitaram fora do Stripe
- **Extensão de grace period** para clientes em negociação
- **Cancelamento forçado** por não-pagamento confirmado

### ⚠️ Separação de permissão

| Endpoint                                   | super_admin | platform_admin |
| ------------------------------------------ | :---------: | :------------: |
| `PUT /platform/tenants/:id/subscription`   |     ✅      |     ❌ 403     |
| `PATCH /platform/tenants/:id/subscription` |     ✅      |     ❌ 403     |

A separação existe porque esses endpoints mudam diretamente o estado financeiro dos tenants. Um `platform_admin` pode ler e listar, mas não escrever.

---

## PUT /platform/tenants/:tenant_id/subscription

Force-assign de plano a um tenant, sem Stripe. Cria ou substitui a subscription com `provider = null`.

**Permissão:** `platform_role: super_admin` apenas

### Path params

| Param       | Tipo | Notas        |
| ----------- | ---- | ------------ |
| `tenant_id` | uuid | ID do tenant |

### Body

| Campo                | Tipo              | Obrigatório | Default    | Notas                                                                                                                |
| -------------------- | ----------------- | ----------- | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `plan_id`            | uuid              | ✅          | —          | ID do plano a atribuir (deve existir e estar ativo)                                                                  |
| `status`             | string            | ❌          | `"active"` | `"trialing" \| "active"` — os únicos status válidos para atribuição manual                                           |
| `current_period_end` | string (ISO 8601) | ✅          | —          | Data de fim do ciclo de acesso                                                                                       |
| `reason`             | string            | ✅          | —          | Motivo da atribuição manual — salvo na `SubscriptionHistory` para auditoria (ex: `"enterprise_annual_invoice_2026"`) |

### Exemplo de request

```json
{
  "plan_id": "plan_enterprise_id",
  "status": "active",
  "current_period_end": "2027-04-22T00:00:00.000Z",
  "reason": "enterprise_manual_billing_invoice_INV-2026-042"
}
```

### Resposta — 200 OK

```json
{
  "data": {
    "id": "sub_xyz",
    "tenant_id": "ten_abc123",
    "status": "active",
    "plan": {
      "id": "plan_enterprise_id",
      "name": "enterprise",
      "display_name": "Enterprise",
      "price_cents": 0,
      "billing_period": "annual"
    },
    "current_period_start": "2026-04-22T00:00:00.000Z",
    "current_period_end": "2027-04-22T00:00:00.000Z",
    "provider": null,
    "provider_subscription_id": null,
    "provider_customer_id": "cus_stripe456",
    "updated_at": "2026-04-22T12:00:00.000Z"
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

> `provider_customer_id` é preservado se já existia antes do force-assign; `null` apenas para tenants que nunca tiveram conexão com o Stripe.

### Erros

| Status | Código          | Quando                                                                                                      |
| ------ | --------------- | ----------------------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`   | `current_period_end` no passado; `status` inválido; `reason` ausente                                        |
| 401    | `UNAUTHORIZED`  | Token inválido                                                                                              |
| 403    | `FORBIDDEN`     | Chamado por `platform_admin` ou sem `platform_role`                                                         |
| 404    | `NOT_FOUND`     | Tenant ou plano não encontrado                                                                              |
| 422    | `UNPROCESSABLE` | Plano inativo (`isActive = false`) — force-assign não exige `stripePriceId` (é o ponto de ignorar o Stripe) |

### Efeitos colaterais

1. Cria ou atualiza `Subscription` com `provider = null`, `providerSubscriptionId = null`. `providerCustomerId` é **preservado** se já existia — o admin pode precisar dele para cancelar manualmente no Stripe
2. `trial_ends_at` é setado como `current_period_end` quando `status = "trialing"`; caso contrário é zerado para `null`
3. Cria entrada em `SubscriptionHistory` com o `reason` fornecido
4. Invalida cache de entitlement do tenant imediatamente
5. **Não cancela** subscription ativa no Stripe — se havia uma Stripe subscription, ela permanece ativa no Stripe. O admin é responsável por cancelá-la manualmente no dashboard do Stripe.

---

## PATCH /platform/tenants/:tenant_id/subscription

Executa ações pontuais sobre a subscription de um tenant sem reatribuir o plano.

**Permissão:** `platform_role: super_admin` apenas

### Path params

| Param       | Tipo | Notas        |
| ----------- | ---- | ------------ |
| `tenant_id` | uuid | ID do tenant |

### Body

| Campo            | Tipo    | Obrigatório | Default | Notas                                                         |
| ---------------- | ------- | ----------- | ------- | ------------------------------------------------------------- |
| `action`         | string  | ✅          | —       | Ação a executar — ver tabela abaixo                           |
| `reason`         | string  | ✅          | —       | Motivo da ação — sempre salvo para auditoria                  |
| `extension_days` | integer | ⚠️          | —       | Obrigatório quando `action = "extend_grace"`. Mín: 1, Máx: 30 |

### Ações disponíveis

| Ação           | Pré-condição          | Efeito                                                                                                                                                                                             |
| -------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extend_grace` | `status = past_due`   | Incrementa `graceExtensionDays += extension_days`. `pastDueSince` **não é alterado** (é a data real de início do atraso). O job recalcula o deadline como `pastDueSince + 10 + graceExtensionDays` |
| `reactivate`   | `status = downgraded` | Restaura `status → active`, zera `downgradedAt`, `dataDeletionScheduledAt`, `pastDueSince` e `graceExtensionDays`; atualiza `currentPeriodStart/End`; cria `SubscriptionHistory`                   |
| `cancel`       | Qualquer status ativo | Seta `status → cancelled`, `cancelledAt = now`, agenda `scheduledDowngradePlanId` para Free                                                                                                        |

### Exemplos de request

**extend_grace:**

```json
{
  "action": "extend_grace",
  "extension_days": 7,
  "reason": "cliente_em_negociacao_renovacao_Q2"
}
```

**reactivate:**

```json
{
  "action": "reactivate",
  "reason": "pagamento_wire_transfer_confirmado_ref_TRF-2026-0422"
}
```

**cancel:**

```json
{
  "action": "cancel",
  "reason": "nao_pagamento_confirmado_30d"
}
```

### Resposta — 200 OK

O shape varia conforme a ação aplicada:

**extend_grace:**

```json
{
  "data": {
    "id": "sub_xyz",
    "tenant_id": "ten_abc123",
    "action_applied": "extend_grace",
    "status": "past_due",
    "past_due_since": "2026-04-10T00:00:00.000Z",
    "grace_expires_at": "2026-04-27T00:00:00.000Z",
    "updated_at": "2026-04-22T12:00:00.000Z"
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

**reactivate:**

```json
{
  "data": {
    "id": "sub_xyz",
    "tenant_id": "ten_abc123",
    "action_applied": "reactivate",
    "status": "active",
    "current_period_start": "2026-04-22T00:00:00.000Z",
    "current_period_end": "2027-04-22T00:00:00.000Z",
    "updated_at": "2026-04-22T12:00:00.000Z"
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

**cancel:**

```json
{
  "data": {
    "id": "sub_xyz",
    "tenant_id": "ten_abc123",
    "action_applied": "cancel",
    "status": "cancelled",
    "cancelled_at": "2026-04-22T12:00:00.000Z",
    "updated_at": "2026-04-22T12:00:00.000Z"
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

> O campo `grace_expires_at` é calculado como `pastDueSince + 10 dias + graceExtensionDays` onde `graceExtensionDays` é o **total acumulado pós-update** (não apenas o incremento desta chamada). Retornado apenas para `extend_grace`.

### Erros

| Status | Código         | Quando                                                                                          |
| ------ | -------------- | ----------------------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`  | `action` inválida; `extension_days` ausente para `extend_grace`; `extension_days` fora do range |
| 401    | `UNAUTHORIZED` | Token inválido                                                                                  |
| 403    | `FORBIDDEN`    | Chamado por `platform_admin`                                                                    |
| 404    | `NOT_FOUND`    | Tenant não encontrado                                                                           |
| 409    | `CONFLICT`     | Pré-condição não atendida (ex: `extend_grace` em subscription `active`)                         |

### Tabela de pré-condições e erros 409

| Ação           | Status atual                         | Resultado               |
| -------------- | ------------------------------------ | ----------------------- |
| `extend_grace` | `past_due`                           | ✅ aplica               |
| `extend_grace` | qualquer outro                       | 409 `INVALID_STATUS`    |
| `reactivate`   | `downgraded`                         | ✅ aplica               |
| `reactivate`   | qualquer outro                       | 409 `INVALID_STATUS`    |
| `cancel`       | `trialing \| active \| past_due`     | ✅ aplica               |
| `cancel`       | `cancelled \| expired \| downgraded` | 409 `ALREADY_CANCELLED` |

### Efeitos colaterais por ação

**extend_grace:**

- Incrementa `graceExtensionDays += extension_days` na Subscription (`pastDueSince` não muda — é a data real de início do atraso e serve como âncora de auditoria)
- Cria **somente `BillingEvent`** com `eventType: subscription.admin_extend_grace` — status não muda, logo **não cria `SubscriptionHistory`**
- Invalida cache de entitlement

**reactivate:**

- `status → active`
- `downgradedAt = null`, `dataDeletionScheduledAt = null`, `pastDueSince = null`, `graceExtensionDays = 0` ← reset obrigatório para próximo ciclo past_due partir do zero
- `currentPeriodStart = now`, `currentPeriodEnd = now + período do plano`
- Cria `SubscriptionHistory` com o `reason` fornecido no body da requisição
- Invalida cache de entitlement

**cancel:**

- `status → cancelled`, `cancelledAt = now`
- `scheduledDowngradePlanId = <id do plano Free>`
- Cria `SubscriptionHistory` com `reason` fornecido
- Invalida cache de entitlement
- **Não cancela** no Stripe automaticamente

---

## Notas de implementação

### extend_grace — abordagem recomendada

O campo `pastDueSince` não deve ser alterado (é a data real de início do atraso para auditoria). Em vez disso, o job `enforce-past-due` deve verificar:

```typescript
// No job enforce-past-due.ts, ao calcular se 10 dias expiraram:
const graceDays = 10 + (subscription.graceExtensionDays ?? 0);
const graceExpiredAt = new Date(
  subscription.pastDueSince.getTime() + graceDays * 24 * 60 * 60 * 1000,
);
if (graceExpiredAt <= now) {
  /* downgrade */
}
```

Isso requer adicionar o campo `graceExtensionDays Int @default(0)` à migration do módulo de override.

### Migration necessária para extend_grace

```prisma
model Subscription {
  // ... campos existentes ...
  graceExtensionDays  Int  @default(0)  // dias adicionados por ação manual de admin
}
```

### Logs de auditoria

Todo PATCH deve criar um `BillingEvent`. Apenas `reactivate` e `cancel` criam também `SubscriptionHistory` (pois mudam o status). `extend_grace` cria **somente `BillingEvent`** — status não muda, nada a registrar no histórico:

```typescript
await prisma.billingEvent.create({
  data: {
    tenantId,
    eventType: `subscription.admin_${action}`,
    provider: null,
    rawPayload: {
      admin_account_id: req.user.sub,
      action,
      reason,
      extension_days: action === "extend_grace" ? extension_days : undefined,
    },
    occurredAt: new Date(),
  },
});
```
