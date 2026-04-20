# Módulo de Subscription & Billing — Plano de Refinamento

> **Status:** ✅ implementado — sandbox Stripe ativo e pronto para testes de integração  
> **Data do plano:** 2026-04-17 | **Implementado:** 2026-04-20  
> **Autor:** colaboração CTO AI + produto

---

## 1. Objetivo

Adicionar ao moasy.tech a capacidade de gerenciar planos de subscrição por tenant, controlar acesso a features com base no plano contratado, e processar cobrança recorrente via **Stripe**.

---

## 2. Contexto arquitetural

O moasy.tech já tem:

- **Tenants** como unidade de isolamento de dados (multi-tenant por `tenant_id`)
- **IAM** com Permission Profiles e RBAC por usuário dentro do tenant
- **Auth** com `PlatformAccount` e JWT carregando `tenant_id`, `roles`, `permissions`
- **Módulos independentes** com ownership de dados por domínio

O módulo de billing será o **produtor** das restrições de plano; outros módulos serão **consumidores** que aplicam guards baseados nos limites do plano ativo do tenant.

---

## 3. Proposta de Planos

> ✅ **Decisão #1 fechada:** Os limites e features são inteiramente definidos pelos planos criados — não há tiers hardcoded no código. Os planos abaixo são seed inicial (`is_system: true`), mas podem ser editados e novos planos podem ser criados livremente. Preço, módulos e limites são 100% configuráveis.

### 3.1 Tiers de partida (seed do sistema — valores editáveis no admin)

Os planos abaixo são gerados no seed inicial (`is_system: true`) apenas como **ponto de referência**. Todos os campos — preço, módulos habilitados, limites de seats e integrações, janela de histórico, features — são editáveis no admin da plataforma sem nenhuma mudança de código. Novos planos podem ser criados a qualquer momento.

| Feature                         | **Free**     | **Starter** | **Pro**           | **Enterprise** |
| ------------------------------- | ------------ | ----------- | ----------------- | -------------- |
| Preço / mês (sugestão)          | $0           | $49         | $149              | negociável     |
| Seats (usuários do dashboard)   | 2            | 5           | 15                | ilimitado      |
| Integrações ativas              | 1            | 2           | ilimitado         | ilimitado      |
| Janela de dados históricos      | 30 dias      | 90 dias     | 1 ano             | ilimitado      |
| Core (projetos, tasks, epics)   | ✅           | ✅          | ✅                | ✅             |
| DORA metrics                    | ✅ limitado¹ | ✅          | ✅                | ✅             |
| SLA                             | ❌           | ✅          | ✅                | ✅             |
| COGS                            | ❌           | ❌          | ✅                | ✅             |
| Intel (forecasting/anomalias)   | ❌           | ❌          | ❌                | ✅             |
| Alertas Slack/Email             | ❌           | ✅          | ✅                | ✅             |
| API programática (webhooks out) | ❌           | ❌          | ✅                | ✅             |
| Suporte                         | community    | email       | email prioritário | SLA dedicado   |

> ¹ DORA no Free: Deployment Frequency e Lead Time apenas; sem scorecard completo, sem MTTR/CFR. Isso é configurado pelo campo `features.dora_full_scorecard = false` no plano — editável no admin.

> ✅ **Decisões #1 e #2 fechadas:** Preço, módulos, limites e flags são 100% configuráveis por plano no admin. A tabela acima é apenas o seed de referência — nenhum valor está hardcoded.

### 3.2 Planos customizados

Além dos tiers base, o `super_admin` da plataforma pode criar planos customizados para clientes Enterprise com configurações específicas de módulos, limites e preço. Planos customizados podem ser:

- **Ativos ou inativos** (`is_active`) — inativos não aceitam novas subscriptions
- **Públicos** (`is_public: true`) — visíveis no checkout para qualquer tenant
- **Exclusivos** (`is_public: false`) — vinculados a tenants específicos via `PlanTenantAssignment`

> ✅ **Decisão #2a fechada:** Apenas operadores internos da moasy com role `super_admin` (ou futuramente `platform_admin`) podem criar e editar planos. Tenants nunca editam planos — apenas escolhem entre os disponíveis.

---

## 4. Entidades do módulo

### 4.1 `Plan`

Definição de um plano. Planos são gerenciados por operadores da plataforma (não por tenants). Planos do sistema (`is_system: true`) não podem ser deletados.

```
id               UUID  PK
name             string         # slug único: "free", "starter", "pro", "enterprise", "acme-custom"
display_name     string         # nome exibido: "Free", "Pro", "Acme Enterprise"
description      string?        # descrição opcional para o checkout
price_cents      integer        # preço por ciclo de cobrança em centavos (0 para Free; mensal ou anual conforme billing_period)
currency         string         # "USD"
billing_period   enum           # "monthly" | "annual"
stripe_price_id  string?        # ID do price no Stripe (ex: price_xxx); necessário para checkout de planos pagos
modules          string[]       # módulos habilitados: ["core", "integrations", "dora", "sla", "cogs", "intel", "comms"] — core é obrigatório
max_seats        integer?       # null = ilimitado; funciona como HARD LIMIT — bloqueia adição de usuário ao atingir
max_integrations integer?       # null = ilimitado; funciona como HARD LIMIT — bloqueia adição de integração ao atingir
history_days     integer?       # null = ilimitado
trial_days       integer        # dias de trial ao subscrever esse plano (default 0); 0 = sem trial
features         JSONB          # flags adicionais: { alerts, api_webhooks, dora_full_scorecard, ... }
is_system        boolean        # true = plano base do sistema (não deletável)
is_public        boolean        # true = visível no checkout para qualquer tenant; false = exclusivo
is_active        boolean        # false = não aceita novas subscriptions (mas existentes continuam)
created_at       timestamptz
updated_at       timestamptz
```

> ✅ **Decisão #4 fechada:** O trial é configurável por plano via `trial_days`. Ex: Free=0, Pro=14, Enterprise personalizado. Ao criar a subscription, se `trial_days > 0`, o status começa como `trialing` com `trial_ends_at = now + trial_days`.

**Módulos válidos para `modules[]`:**

| Valor          | Módulo                        |
| -------------- | ----------------------------- |
| `core`         | Projetos, tasks, epics, times |
| `integrations` | Conectores JIRA, GitHub, etc. |
| `dora`         | DORA metrics e scorecard      |
| `sla`          | SLA templates e compliance    |
| `cogs`         | Custo de engenharia e COGS    |
| `intel`        | Forecasting e anomalias       |
| `comms`        | Comunicação e alertas         |

> `core` e `integrations` são sempre incluídos em qualquer plano pago; `core` é incluído mesmo no Free.

### 4.2 `Subscription`

Estado da assinatura atual de um tenant.

```
id                          UUID  PK
tenant_id                   UUID  # sem FK — isolamento de módulo; integridade garantida por @unique e verificada na camada de serviço
plan_id                     UUID  FK → Plan   # plano ativo agora
scheduled_downgrade_plan_id UUID? FK → Plan # plano para o qual vai no fim do ciclo (ex: Free ao cancelar)
pending_plan_changes        JSONB?          # mudanças de plano agendadas para aplicar em current_period_end (modules, max_seats, etc.)
status                      enum  # trialing | active | past_due | downgraded | cancelled | expired
trial_ends_at               timestamptz?
current_period_start        timestamptz
current_period_end          timestamptz
past_due_since              timestamptz?  # quando entrou em past_due (usado para contar os 10 dias)
downgraded_at               timestamptz?  # quando o downgrade automático foi aplicado
data_deletion_scheduled_at  timestamptz?  # downgraded_at + 30 dias; nulo enquanto ativo
cancelled_at                timestamptz?
provider                    string?       # provedor de pagamento: "stripe"
provider_subscription_id    string?       # ID externo da subscription no Stripe (ex: sub_xxx)
provider_customer_id        string?       # ID do customer no Stripe (ex: cus_xxx)
created_at                  timestamptz
updated_at                  timestamptz
```

> ✅ **Decisões #5 e #6 fechadas:** Após `past_due_since + 10 dias` sem quitação, downgrade automático para Free (`status → downgraded`, `data_deletion_scheduled_at = downgraded_at + 30 dias`). Se o tenant reativar dentro de 30 dias, os dados são preservados e `data_deletion_scheduled_at` é zerado. Após 30 dias, um job de expurgo remove os dados do tenant do armazenamento permanente. Veja seção 6.4.

### 4.3 `SubscriptionHistory`

Registro histórico de todos os planos pelos quais a subscription passou, para auditoria e análise de upgrade/downgrade paths.

```
id              UUID  PK
subscription_id UUID  # FK → Subscription via subscription_id (mais preciso que tenant_id)
plan_id         UUID  FK → Plan
status          string       # status da subscription quando este registro foi criado
effective_from  timestamptz  # quando esta mudança de plano entrou em vigor
reason          string?      # motivo da mudança: 'initial_registration', 'pending_changes_applied', 'past_due_grace_expired', 'reactivation', etc.
created_at      timestamptz
```

> Novo registro é criado sempre que a subscription muda de plano (upgrade, downgrade, reativação) ou status. O campo `reason` documenta o motivo da mudança para auditoria. Para consultar histórico por tenant, basta fazer JOIN via `Subscription.tenant_id`. A ordem cronológica é garantida por `effective_from + created_at`.

### 4.4 `PlanTenantAssignment`

Vincula um plano exclusivo (`is_public: false`) a tenants específicos que podem subscrevê-lo.

```
id         UUID  PK
plan_id    UUID  FK → Plan
tenant_id  UUID  # sem FK — isolamento de módulo
created_at timestamptz
```

> Tenants sem `PlanTenantAssignment` para um plano `is_public: false` não o veem no checkout nem podem subscrevê-lo.

### 4.5 `SubscriptionUsage` (opcional — fase posterior)

Rastreia consumo real para planos com overage ou cobrança baseada em uso.

```
id             UUID  PK
subscription_id UUID FK → Subscription
metric         string   # "seats_used", "integrations_active"
value          integer
recorded_at    timestamptz
```

### 4.6 `BillingEvent`

Log auditável de eventos de cobrança (webhook do provedor de pagamento ou ação interna).

```
id                String   @id @default(uuid())
tenant_id         UUID  # sem FK — isolamento de módulo
event_type        string   # "subscription.activated", "invoice.paid", "subscription.past_due", etc.
provider          string?
provider_event_id string?  @unique  # event.id do Stripe — garante idempotência de processamento
raw_payload       JSONB?
occurred_at       timestamptz
created_at        timestamptz
```

### 4.7 `PurgeFailureQueue`

Fila de falhas (DLQ) para retry exponencial de expurgo de dados quando o job de purge falha.

```
id              UUID  PK
tenant_id       UUID  # sem FK — isolamento de módulo
subscription_id UUID  # subscription que falhou no expurgo
error           string       # mensagem de erro
retry_count     integer      # número de tentativas (default 0)
next_retry_at   timestamptz? # próxima tentativa agendada (null = imediato)
created_at      timestamptz
resolved_at     timestamptz? # quando o expurgo foi bem-sucedido ou desistiu
```

> **Backoff exponencial:** Retry 1 = +1h, Retry 2 = +2h, Retry 3 = +4h, Retry 4 = +8h, Retry 5+ = +24h. Máximo de 10 tentativas. Após 10 falhas, a entrada permanece na fila com `retry_count = 10` e `next_retry_at = null` para alerta manual do `super_admin`.

---

## 5. Limites e entitlements

### 5.1 Como os limits funcionam

Os campos do `Plan` definem diretamente a policy de acesso — sem JSONB opaco para os limites principais:

```
modules          = ["core", "dora", "sla"]   # módulos acessíveis
max_seats        = 5                         # null = sem limite
max_integrations = 2                         # null = sem limite
history_days     = 90                        # null = sem limite
features         = {                         # booleans para gates granulares
  alerts: true,
  api_webhooks: false,
  dora_full_scorecard: true
}
```

O guard de entitlement busca esses campos diretamente do `Plan` associado à `Subscription` ativa do tenant.

### 5.2 Onde os guards são aplicados

> ✅ **Decisão #3 fechada:** Guard **por módulo**. Cada módulo é responsável por validar o próprio entitlement nas suas rotas.

**Mecanismo sem acoplamento direto:**

- O Billing module expõe funções standalone `requireModule(moduleName)` e `requireFeature(featureName)` em `src/modules/billing/entitlement.ts`
- Cada módulo importa essas funções e as usa como `preHandler` nas rotas: `preHandler: [app.authenticate, requireModule('sla')]`
- O `tenantId` é extraído de `request.user.tenant_id` internamente — o módulo consumidor não precisa passá-lo
- O serviço mantém cache em memória com TTL de 60s — nunca lê a tabela de outra forma a partir dos módulos
- Essa é a **única** interface que módulos externos podem usar do Billing; acesso direto à tabela `Plan` ou `Subscription` de fora do módulo é proibido

**JWT:** o token NÃO carrega limits do plano — o cache do serviço é suficiente e evita tokens gordos.

**Status `past_due`:** durante os 10 dias de grace, o acesso continua normal. Um header `X-Billing-Warning: past_due` é adicionado a todas as respostas para sinalizar ao frontend exibir o banner.

**Status `downgraded`:** o entitlement reflete o plano Free imediatamente. O header passa a ser `X-Billing-Warning: downgraded`. Os dados existentes (projetos, métricas, etc.) são mantidos por 30 dias (`data_deletion_scheduled_at`). Se reativar dentro desse prazo, tudo é preservado; caso contrário, o job de expurgo remove os dados.

**Limites `max_seats` e `max_integrations`:** Funcionam como **hard limits**. Ao atingir o limite, a API bloqueia a adição de novos usuários ou integrações com erro `402 UPGRADE_REQUIRED`. Guards são aplicados em:

- `POST /iam/users/:tenant_id/members` — verifica `max_seats` antes de criar usuário
- `POST /integrations/connections` — verifica `max_integrations` antes de ativar integração

### 5.3 Respostas padronizadas de limite

```json
{
  "data": null,
  "error": {
    "code": "UPGRADE_REQUIRED",
    "message": "Module \"sla\" requires a higher plan.",
    "details": {
      "module_required": "sla",
      "current_plan_modules": ["core", "integrations", "dora"],
      "upgrade_url": "https://moasy.tech/billing/upgrade"
    }
  },
  "meta": { ... }
}
```

---

## 6. Fluxo de subscription

### 6.1 Novo tenant (onboarding)

```
POST /auth/register
  → cria Tenant + PlatformAccount (org_admin)
  → Billing module cria Subscription com plan=free
     se Plan.trial_days > 0: status=trialing, trial_ends_at = now + trial_days
     senão: status=active
```

> ✅ **Decisão #4 fechada:** Trial é configurado no plano (`trial_days`). Por padrão, o Free tem `trial_days=0` → entra direto como `active`. Se quiser dar trial do Pro para novos tenants, basta configurar o plano Pro com `trial_days=14`.

### 6.2 Upgrade via Stripe Checkout

```
POST /billing/checkout          → cria Stripe Checkout Session, retorna URL
  redirect → Stripe Hosted Page
  Stripe webhook → POST /billing/webhooks/stripe
    → processa customer.subscription.updated
    → Subscription.status = active, plan_id atualizado
```

### 6.3 Downgrade voluntário / cancelamento

```
org_admin solicita downgrade ou cancelamento
  → scheduled_downgrade_plan_id preenchido (downgrade) ou cancelled_at agendado
  → Stripe cancela/altera a subscription ao fim do período de cobrança atual
  → Stripe webhook confirma → status → cancelled ou plano novo ao fim do ciclo
```

> ✅ **Decisão #5 fechada:** Downgrade voluntário é **ao final do ciclo** — o tenant mantém acesso até o fim do período pago. O campo `scheduled_downgrade_plan_id` armazena o plano destino. Um banner informa a data do downgrade durante esse período.

### 6.4 Falha de pagamento

```
Stripe → invoice.payment_failed / subscription.past_due
  → Subscription.status = past_due, past_due_since = now
  → Email imediato ao org_admin com link para o Stripe Customer Portal
  → Lembretes por email: D+3, D+7
  → D+10: job periódico detecta past_due_since + 10 dias
       → plan_id = Free, status = downgraded
       → downgraded_at = now, data_deletion_scheduled_at = now + 30 dias
       → BillingEvent registrado
       → Email: "conta rebaixada para Free — dados retidos por 30 dias"

Stripe → invoice.paid (quitação dentro do grace — D0 a D10)
  → status = active, past_due_since = null
  → Email de confirmação ao org_admin
```

### 6.5 Reativação após downgrade por inadimplência

```
org_admin acessa Stripe Checkout e contrata um plano
  → Stripe webhook confirma pagamento
  → Subscription.status = active, plan_id = novo plano
  → data_deletion_scheduled_at = null  ← dados preservados
  → BillingEvent: "subscription.reactivated"
  → Email: "sua conta foi reativada com sucesso"

Se data_deletion_scheduled_at já passou (D+30 expirado):
  → checkout ainda funciona, mas dados já foram expurgados
  → tenant começa com estado limpo no novo plano
```

> ✅ **Decisões finais fechadas:**
>
> - Após 10 dias `past_due` → **downgrade para Free** (não suspensão total; o tenant pode continuar usando a plataforma no nível Free)
> - Dados retidos por **30 dias** após o downgrade — janela para reativar sem perder histórico
> - Reativação é **automática** via webhook do provedor — sem intervenção manual

---

## 7. API do módulo

**Base URL:** `/api/v1`
**Auth:** Todos os endpoints requerem `Authorization: Bearer <JWT>`, exceto `/billing/plans` (público) e `/billing/webhooks/stripe` (autenticado por HMAC).

---

### 7.1 Visão geral de permissões

| Permissão                 | Quem tem                         | Como é verificada                                                        |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| _(nenhuma)_               | Qualquer pessoa                  | Rota pública                                                             |
| `billing.read`            | `org_admin`, `manager` do tenant | claim `permissions` no JWT                                               |
| `billing.manage`          | `org_admin` do tenant            | claim `permissions` no JWT                                               |
| `platform.billing.manage` | `super_admin`, `platform_admin`  | campo `platform_role` no JWT — verificado **antes** das claims de tenant |

**Separação super_admin × tenant:**

O JWT carrega dois contextos:

- `platform_role: "super_admin" | "platform_admin" | null` — escopo da plataforma
- `tenant_id` + `permissions[]` — escopo do tenant

Rotas com prefixo `/platform/` exigem `platform_role` não-nulo. Rotas `/billing/` (sem prefixo `/platform/`) são sempre escopadas ao `tenant_id` do JWT. Um `super_admin` **não tem acesso automático** a dados de um tenant pelo token de plataforma — ele precisa de um token de tenant para agir como org_admin.

---

### 7.2 API de Gestão da Plataforma (super_admin)

> Estas rotas são exclusivas do admin interno da moasy. O frontend do admin da plataforma consome estas rotas.

---

#### GET /platform/billing/plans

Lista todos os planos existentes, incluindo inativos, exclusivos e do sistema.

**Permissão:** `platform.billing.manage`

**Query params:**

| Param       | Tipo    | Obrigatório | Default | Notas                                     |
| ----------- | ------- | ----------- | ------- | ----------------------------------------- |
| `is_active` | boolean | ❌          | —       | Filtra por status ativo/inativo           |
| `is_public` | boolean | ❌          | —       | `true` = públicos; `false` = exclusivos   |
| `is_system` | boolean | ❌          | —       | `true` = apenas planos seed do sistema    |
| `limit`     | integer | ❌          | 20      | Máx 100                                   |
| `cursor`    | string  | ❌          | —       | Cursor de paginação (UUID do último item) |

**Resposta — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "plan-uuid-001",
        "name": "pro",
        "display_name": "Pro",
        "description": "For scaling engineering teams.",
        "price_cents": 14900,
        "currency": "USD",
        "billing_period": "monthly",
        "stripe_price_id": "price_pro_monthly",
        "modules": ["core", "integrations", "dora", "sla", "cogs", "comms"],
        "max_seats": 15,
        "max_integrations": null,
        "history_days": 365,
        "trial_days": 14,
        "features": {
          "alerts": true,
          "api_webhooks": true,
          "dora_full_scorecard": true
        },
        "is_system": true,
        "is_public": true,
        "is_active": true,
        "active_subscriptions_count": 42,
        "created_at": "2026-04-17T00:00:00Z",
        "updated_at": "2026-04-17T00:00:00Z"
      }
    ],
    "next_cursor": null
  },
  "meta": {
    "request_id": "req_001",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

> **`active_subscriptions_count`:** número de tenants com `Subscription.plan_id` apontando para este plano e `status` em `trialing | active | past_due`. Exibir no admin como aviso ao editar ou desativar.

**Erros:**

| Status | Código         | Quando                       |
| ------ | -------------- | ---------------------------- |
| 401    | `UNAUTHORIZED` | Token inválido ou ausente    |
| 403    | `FORBIDDEN`    | `platform_role` insuficiente |

---

#### POST /platform/billing/plans

Cria um novo plano.

**Permissão:** `platform.billing.manage`

**Body:**

| Campo              | Tipo            | Obrigatório | Default | Notas                                                                                |
| ------------------ | --------------- | ----------- | ------- | ------------------------------------------------------------------------------------ |
| `name`             | string          | ✅          | —       | Slug único, sem espaços, ex: `"acme-enterprise"`                                     |
| `display_name`     | string          | ✅          | —       | Nome exibido no checkout                                                             |
| `description`      | string          | ❌          | `null`  | Texto de apoio no checkout                                                           |
| `price_cents`      | integer         | ✅          | —       | Em centavos; `0` para planos grátis                                                  |
| `currency`         | string          | ❌          | `"USD"` | ISO 4217                                                                             |
| `billing_period`   | enum            | ✅          | —       | `"monthly"` \| `"annual"`                                                            |
| `stripe_price_id`  | string          | ❌          | `null`  | ID do price no Stripe (`price_xxx`); obrigatório para planos pagos que usam Checkout |
| `modules`          | string[]        | ✅          | —       | Ao menos `["core"]`. Ver lista de módulos válidos.                                   |
| `max_seats`        | integer \| null | ❌          | `null`  | `null` = ilimitado                                                                   |
| `max_integrations` | integer \| null | ❌          | `null`  | `null` = ilimitado                                                                   |
| `history_days`     | integer \| null | ❌          | `null`  | `null` = ilimitado                                                                   |
| `trial_days`       | integer         | ❌          | `0`     | `0` = sem trial                                                                      |
| `features`         | object          | ❌          | `{}`    | Flags booleanas opcionais (ver abaixo)                                               |
| `is_public`        | boolean         | ❌          | `true`  | `false` = exclusivo; requer assignments                                              |
| `is_active`        | boolean         | ❌          | `true`  | Pode criar já inativo                                                                |

**Flags válidas em `features`:**

| Flag                  | Tipo    | Default | Descrição                                                                |
| --------------------- | ------- | ------- | ------------------------------------------------------------------------ |
| `alerts`              | boolean | `false` | Alertas Slack/Email habilitados                                          |
| `api_webhooks`        | boolean | `false` | API programática e webhooks de saída                                     |
| `dora_full_scorecard` | boolean | `false` | Scorecard completo DORA (MTTR, CFR); `false` = somente freq. e lead time |

**Exemplo de request:**

```json
{
  "name": "acme-enterprise",
  "display_name": "Acme Enterprise",
  "description": "Custom plan for Acme Corp.",
  "price_cents": 49900,
  "currency": "USD",
  "billing_period": "monthly",
  "stripe_price_id": "price_1ABC123",
  "modules": ["core", "integrations", "dora", "sla", "cogs", "intel"],
  "max_seats": null,
  "max_integrations": null,
  "history_days": null,
  "trial_days": 0,
  "features": {
    "alerts": true,
    "api_webhooks": true,
    "dora_full_scorecard": true
  },
  "is_public": false,
  "is_active": true
}
```

**Resposta — 201 Created:**

```json
{
  "data": {
    "id": "plan-uuid-007",
    "name": "acme-enterprise",
    "display_name": "Acme Enterprise",
    "description": "Custom plan for Acme Corp.",
    "price_cents": 49900,
    "currency": "USD",
    "billing_period": "monthly",
    "stripe_price_id": "price_1ABC123",
    "modules": ["core", "integrations", "dora", "sla", "cogs", "intel"],
    "max_seats": null,
    "max_integrations": null,
    "history_days": null,
    "trial_days": 0,
    "features": {
      "alerts": true,
      "api_webhooks": true,
      "dora_full_scorecard": true
    },
    "is_system": false,
    "is_public": false,
    "is_active": true,
    "active_subscriptions_count": 0,
    "created_at": "2026-04-17T10:05:00Z",
    "updated_at": "2026-04-17T10:05:00Z"
  },
  "meta": {
    "request_id": "req_002",
    "version": "v1",
    "timestamp": "2026-04-17T10:05:00Z"
  },
  "error": null
}
```

**Erros:**

| Status | Código          | Quando                                                                  |
| ------ | --------------- | ----------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`   | Campo obrigatório ausente, `modules[]` vazio, `billing_period` inválido |
| 401    | `UNAUTHORIZED`  | Token inválido                                                          |
| 403    | `FORBIDDEN`     | `platform_role` insuficiente                                            |
| 409    | `CONFLICT`      | `name` já existe                                                        |
| 422    | `UNPROCESSABLE` | Módulo inválido em `modules[]`                                          |

---

#### GET /platform/billing/plans/:plan_id

Detalhe completo de um plano.

**Permissão:** `platform.billing.manage`

**Resposta — 200 OK:** mesmo shape do objeto em `POST 201`, incluindo `active_subscriptions_count`.

**Erros:**

| Status | Código         | Quando               |
| ------ | -------------- | -------------------- |
| 401    | `UNAUTHORIZED` | —                    |
| 403    | `FORBIDDEN`    | —                    |
| 404    | `NOT_FOUND`    | Plano não encontrado |

---

#### PATCH /platform/billing/plans/:plan_id

Edita campos de um plano. Todos os campos são opcionais — apenas os enviados são atualizados.

**Permissão:** `platform.billing.manage`

**Body (todos opcionais):**

| Campo              | Tipo            | Notas                                                                                                                                                                                                                                                                                |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `display_name`     | string          | —                                                                                                                                                                                                                                                                                    |
| `description`      | string \| null  | —                                                                                                                                                                                                                                                                                    |
| `price_cents`      | integer         | Muda preço para novas subscriptions; existentes não são afetadas                                                                                                                                                                                                                     |
| `billing_period`   | enum            | `"monthly"` \| `"annual"`                                                                                                                                                                                                                                                            |
| `stripe_price_id`  | string \| null  | Atualiza o price vinculado no Stripe                                                                                                                                                                                                                                                 |
| `modules`          | string[]        | Deve sempre incluir `"core"`. **Reduções de módulos/limits são agendadas** via `apply_at_renewal`                                                                                                                                                                                    |
| `max_seats`        | integer \| null | —                                                                                                                                                                                                                                                                                    |
| `max_integrations` | integer \| null | —                                                                                                                                                                                                                                                                                    |
| `history_days`     | integer \| null | —                                                                                                                                                                                                                                                                                    |
| `trial_days`       | integer         | —                                                                                                                                                                                                                                                                                    |
| `features`         | object          | Merge parcial — campos não enviados são mantidos                                                                                                                                                                                                                                     |
| `is_public`        | boolean         | —                                                                                                                                                                                                                                                                                    |
| `is_active`        | boolean         | `false` impede novas subscriptions; ativas continuam normalmente                                                                                                                                                                                                                     |
| `apply_at_renewal` | boolean         | Default: `false`. Se `true`, mudanças em `modules`, `max_seats`, `max_integrations`, `history_days` e `features` são agendadas em `pending_plan_changes` de cada subscription ativa e aplicadas automaticamente em `current_period_end` via job. Se `false`, propagam imediatamente. |

> ✅ **Decisão #9 fechada:** Mudanças que reduzem entitlements (`modules`, `max_seats`, `max_integrations`, `history_days`, `features`) devem usar `apply_at_renewal: true` para evitar surpresa aos tenants pagantes. A API valida e armazena as mudanças em `Subscription.pending_plan_changes`; um job periódico as aplica em `current_period_end`. Mudanças que **aumentam** entitlements podem usar `apply_at_renewal: false` para efeito imediato.

> **Aviso de impacto:** Se o plano tiver `active_subscriptions_count > 0` e `apply_at_renewal: false`, a resposta inclui `"affected_subscriptions": N` no `meta`. O frontend do admin deve exibir modal de confirmação com opção de marcar "Aplicar apenas na renovação".

**Exemplo de request:**

```json
{
  "is_active": false,
  "description": "Plano descontinuado — use o Pro."
}
```

**Resposta — 200 OK:**

```json
{
  "data": {
    /* objeto Plan completo atualizado */
  },
  "meta": {
    "request_id": "req_003",
    "version": "v1",
    "timestamp": "2026-04-17T10:10:00Z",
    "affected_subscriptions": 0
  },
  "error": null
}
```

**Erros:**

| Status | Código          | Quando                                                                              |
| ------ | --------------- | ----------------------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`   | `modules[]` ficaria vazio; `billing_period` inválido; `modules` não inclui `"core"` |
| 401    | `UNAUTHORIZED`  | —                                                                                   |
| 403    | `FORBIDDEN`     | —                                                                                   |
| 404    | `NOT_FOUND`     | Plano não encontrado                                                                |
| 409    | `CONFLICT`      | `name` já existe em outro plano                                                     |
| 422    | `UNPROCESSABLE` | Módulo inválido                                                                     |

---

#### DELETE /platform/billing/plans/:plan_id

Exclui um plano permanentemente.

**Permissão:** `platform.billing.manage`

**Restrições:**

- Planos com `is_system: true` **nunca podem ser deletados** — retorna `403 FORBIDDEN`.
- Planos com `active_subscriptions_count > 0` **não podem ser deletados** — retorna `409 CONFLICT`. Desative o plano via `PATCH` primeiro.

**Resposta — 204 No Content** (sem body).

**Erros:**

| Status | Código         | Quando                         |
| ------ | -------------- | ------------------------------ |
| 401    | `UNAUTHORIZED` | —                              |
| 403    | `FORBIDDEN`    | Plano é `is_system: true`      |
| 404    | `NOT_FOUND`    | Plano não encontrado           |
| 409    | `CONFLICT`     | Plano tem subscriptions ativas |

---

#### POST /platform/billing/plans/:plan_id/assignments

Vincula um plano `is_public: false` a um tenant específico, tornando-o visível no checkout desse tenant.

**Permissão:** `platform.billing.manage`

**Body:**

| Campo       | Tipo          | Obrigatório | Notas                            |
| ----------- | ------------- | ----------- | -------------------------------- |
| `tenant_id` | string (UUID) | ✅          | Tenant a receber acesso ao plano |

**Exemplo:**

```json
{ "tenant_id": "tenant-uuid-acme" }
```

**Resposta — 201 Created:**

```json
{
  "data": {
    "plan_id": "plan-uuid-007",
    "tenant_id": "tenant-uuid-acme",
    "created_at": "2026-04-17T10:15:00Z"
  },
  "meta": {
    "request_id": "req_004",
    "version": "v1",
    "timestamp": "2026-04-17T10:15:00Z"
  },
  "error": null
}
```

**Erros:**

| Status | Código         | Quando                                                |
| ------ | -------------- | ----------------------------------------------------- |
| 400    | `BAD_REQUEST`  | Plano é `is_public: true` (não precisa de assignment) |
| 401    | `UNAUTHORIZED` | —                                                     |
| 403    | `FORBIDDEN`    | —                                                     |
| 404    | `NOT_FOUND`    | Plano ou tenant não encontrado                        |
| 409    | `CONFLICT`     | Assignment já existe                                  |

---

#### DELETE /platform/billing/plans/:plan_id/assignments/:tenant_id

Remove o vínculo exclusivo entre plano e tenant. O tenant perde visibilidade do plano no checkout, mas subscriptions ativas **não são canceladas** imediatamente.

**Permissão:** `platform.billing.manage`

**Resposta — 204 No Content** (sem body).

**Erros:**

| Status | Código         | Quando                    |
| ------ | -------------- | ------------------------- |
| 401    | `UNAUTHORIZED` | —                         |
| 403    | `FORBIDDEN`    | —                         |
| 404    | `NOT_FOUND`    | Assignment não encontrado |

---

### 7.3 API do Tenant (org_admin / manager)

> Estas rotas são consumidas pelo dashboard do tenant. Todas são escopadas ao `tenant_id` do JWT — um tenant nunca acessa dados de outro.

---

#### GET /billing/plans

Lista planos disponíveis para o tenant: planos `is_public: true` + planos exclusivos vinculados via `PlanTenantAssignment`. Filtra automaticamente planos `is_active: false`.

**Permissão:** nenhuma (pública, mas o JWT define quais exclusivos são retornados)

**Resposta — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "plan-uuid-001",
        "name": "free",
        "display_name": "Free",
        "description": null,
        "price_cents": 0,
        "currency": "USD",
        "billing_period": "monthly",
        "modules": ["core", "integrations", "dora"],
        "max_seats": 2,
        "max_integrations": 1,
        "history_days": 30,
        "trial_days": 0,
        "features": {
          "alerts": false,
          "api_webhooks": false,
          "dora_full_scorecard": false
        },
        "is_current": true
      }
    ]
  },
  "meta": {
    "request_id": "req_005",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

> **`is_current`:** `true` no plano que o tenant está subscrito no momento. Útil para marcar o plano atual no UI de upgrade.

> **Nota:** campos `is_system`, `is_public`, `active_subscriptions_count` são omitidos nesta rota — são dados internos da plataforma.

---

#### GET /billing/subscription

Retorna a subscription ativa do tenant chamante, incluindo o plano associado e datas relevantes.

**Permissão:** `billing.read`

**Resposta — 200 OK:**

```json
{
  "data": {
    "id": "sub-uuid-001",
    "status": "active",
    "plan": {
      "id": "plan-uuid-002",
      "name": "starter",
      "display_name": "Starter",
      "price_cents": 4900,
      "currency": "USD",
      "billing_period": "monthly",
      "modules": ["core", "integrations", "dora", "sla", "comms"],
      "max_seats": 5,
      "max_integrations": 2,
      "history_days": 90,
      "features": {
        "alerts": true,
        "api_webhooks": false,
        "dora_full_scorecard": true
      }
    },
    "scheduled_downgrade_plan": null,
    "trial_ends_at": null,
    "current_period_start": "2026-04-01T00:00:00Z",
    "current_period_end": "2026-05-01T00:00:00Z",
    "past_due_since": null,
    "downgraded_at": null,
    "data_deletion_scheduled_at": null,
    "cancelled_at": null
  },
  "meta": {
    "request_id": "req_006",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

**Campos de status e o que exibir no UI:**

| `status`     | O que exibir                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------- |
| `trialing`   | Banner informativo: "Trial ativo até `trial_ends_at`"                                        |
| `active`     | Nada especial; exibir renovação em `current_period_end`                                      |
| `past_due`   | Banner de alerta: "Pagamento falhou — regularize até `past_due_since + 10 dias`"             |
| `downgraded` | Banner de erro: "Conta rebaixada para Free. Dados excluídos em `data_deletion_scheduled_at`" |
| `cancelled`  | Banner informativo: "Acesso encerra em `current_period_end`"                                 |
| `expired`    | Bloquear acesso; redirecionar para checkout                                                  |

---

#### POST /billing/checkout

Inicia uma Stripe Checkout Session para upgrade ou reativação de plano.

**Permissão:** `billing.manage`

**Body:**

| Campo         | Tipo          | Obrigatório | Notas                                                |
| ------------- | ------------- | ----------- | ---------------------------------------------------- |
| `plan_id`     | string (UUID) | ✅          | Plano desejado (deve estar disponível para o tenant) |
| `success_url` | string (URL)  | ✅          | URL de redirecionamento após pagamento confirmado    |
| `cancel_url`  | string (URL)  | ✅          | URL de redirecionamento ao cancelar o checkout       |

**Exemplo:**

```json
{
  "plan_id": "plan-uuid-002",
  "success_url": "https://app.moasy.tech/billing?success=true",
  "cancel_url": "https://app.moasy.tech/billing"
}
```

**Resposta — 200 OK:**

```json
{
  "data": {
    "checkout_url": "https://checkout.stripe.com/pay/cs_live_xxx"
  },
  "meta": {
    "request_id": "req_007",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

> **Fluxo frontend:** redirecione o usuário para `checkout_url`. Após pagamento, a Stripe redireciona para `success_url`. A subscription é atualizada via webhook — pode levar alguns segundos. Exiba um loading até a subscription refletir o novo plano (polling em `GET /billing/subscription` a cada 2s por até 15s).

**Erros:**

| Status | Código         | Quando                                                   |
| ------ | -------------- | -------------------------------------------------------- |
| 400    | `BAD_REQUEST`  | `plan_id` inválido ou plano não disponível para o tenant |
| 401    | `UNAUTHORIZED` | —                                                        |
| 403    | `FORBIDDEN`    | Permissão insuficiente                                   |
| 502    | `BAD_GATEWAY`  | Erro na API do Stripe                                    |

---

#### POST /billing/portal

Abre o Stripe Customer Portal para o tenant gerenciar cartão de crédito e visualizar faturas.

**Permissão:** `billing.manage`

**Body:**

| Campo        | Tipo         | Obrigatório | Notas                                  |
| ------------ | ------------ | ----------- | -------------------------------------- |
| `return_url` | string (URL) | ✅          | URL para retornar após fechar o portal |

**Resposta — 200 OK:**

```json
{
  "data": {
    "portal_url": "https://billing.stripe.com/session/xxx"
  },
  "meta": {
    "request_id": "req_008",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

**Erros:**

| Status | Código         | Quando                                                                 |
| ------ | -------------- | ---------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`  | Tenant não possui `provider_customer_id` (nunca assinou um plano pago) |
| 401    | `UNAUTHORIZED` | —                                                                      |
| 403    | `FORBIDDEN`    | —                                                                      |
| 502    | `BAD_GATEWAY`  | Erro na API do Stripe                                                  |

---

#### POST /billing/cancel

Agenda o cancelamento da subscription ao final do ciclo atual. O acesso é mantido até `current_period_end`.

**Permissão:** `billing.manage`

**Body:** vazio `{}`

**Resposta — 200 OK:**

```json
{
  "data": {
    "cancelled_at": "2026-04-17T10:20:00Z",
    "access_until": "2026-05-01T00:00:00Z"
  },
  "meta": {
    "request_id": "req_009",
    "version": "v1",
    "timestamp": "2026-04-17T10:20:00Z"
  },
  "error": null
}
```

**Erros:**

| Status | Código         | Quando                                                        |
| ------ | -------------- | ------------------------------------------------------------- |
| 400    | `BAD_REQUEST`  | Tenant já está cancelado ou no plano Free (`price_cents = 0`) |
| 401    | `UNAUTHORIZED` | —                                                             |
| 403    | `FORBIDDEN`    | —                                                             |

---

#### GET /billing/usage

Retorna o consumo atual do tenant em relação aos limites do plano ativo.

**Permissão:** `billing.read`

**Resposta — 200 OK:**

```json
{
  "data": {
    "seats": {
      "used": 3,
      "limit": 5,
      "unlimited": false
    },
    "integrations": {
      "used": 2,
      "limit": 2,
      "unlimited": false
    },
    "history_days": {
      "limit": 90,
      "unlimited": false
    }
  },
  "meta": {
    "request_id": "req_010",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

> **`unlimited: true`** quando o campo correspondente no plano é `null`. Frontend deve omitir o indicador de limite nesses casos.

---

#### GET /billing/events

Histórico de eventos de cobrança do tenant (audit log).

**Permissão:** `billing.manage`

**Query params:**

| Param    | Tipo    | Obrigatório | Default | Notas               |
| -------- | ------- | ----------- | ------- | ------------------- |
| `limit`  | integer | ❌          | 20      | Máx 100             |
| `cursor` | string  | ❌          | —       | Cursor de paginação |

**Resposta — 200 OK:**

```json
{
  "data": {
    "items": [
      {
        "id": "event-uuid-001",
        "event_type": "subscription.activated",
        "occurred_at": "2026-04-01T00:00:00Z",
        "provider": "stripe"
      },
      {
        "id": "event-uuid-002",
        "event_type": "invoice.paid",
        "occurred_at": "2026-04-01T00:01:00Z",
        "provider": "stripe"
      }
    ],
    "next_cursor": null
  },
  "meta": {
    "request_id": "req_011",
    "version": "v1",
    "timestamp": "2026-04-17T10:00:00Z"
  },
  "error": null
}
```

> **`raw_payload`** é omitido nesta rota por segurança — disponível apenas internamente.

**Tipos de evento possíveis:**

| `event_type`               | Descrição                                                   |
| -------------------------- | ----------------------------------------------------------- |
| `subscription.created`     | Nova subscription criada                                    |
| `subscription.activated`   | Tornou-se ativa (trial encerrado ou pagamento confirmado)   |
| `subscription.past_due`    | Pagamento falhou                                            |
| `subscription.downgraded`  | Rebaixamento automático após grace period                   |
| `subscription.reactivated` | Reativação após downgrade                                   |
| `subscription.cancelled`   | Cancelamento agendado confirmado                            |
| `invoice.paid`             | Fatura paga com sucesso                                     |
| `invoice.payment_failed`   | Falha no pagamento                                          |
| `plan.changes_applied`     | Mudanças agendadas de plano aplicadas em current_period_end |
| `data_purge_scheduled`     | Expurgo de dados agendado                                   |
| `data_purge_completed`     | Dados expurgados com sucesso                                |
| `data_purge_failed`        | Falha no expurgo de dados (super_admin alertado)            |

---

#### POST /billing/webhooks/stripe

Recebe eventos do Stripe. **Autenticação via HMAC** — não usa JWT. O header `Stripe-Signature` é verificado com o webhook secret configurado.

**Permissão:** nenhuma (pública, autenticada por HMAC)

**Rate limit:** 100 requisições por minuto por IP — previne flood mesmo com HMAC inválido.

**Headers obrigatórios:**

| Header             | Valor                         |
| ------------------ | ----------------------------- |
| `Stripe-Signature` | Assinatura gerada pelo Stripe |

**Resposta — 200 OK:** `{}` (Stripe exige 2xx para considerar entregue)

**Resposta — 400 Bad Request:** quando a assinatura HMAC é inválida.

**Resposta — 429 Too Many Requests:** rate limit excedido.

> **Idempotência:** eventos do Stripe podem chegar duplicados ou fora de ordem. Cada evento é processado exatamente uma vez, identificado por `event.id` do Stripe, registrado em `BillingEvent`. Eventos já processados retornam `200` sem reprocessar.

---

### 7.4 Header de aviso de billing

Todas as respostas autenticadas do tenant incluem o header `X-Billing-Warning` quando aplicável:

| Valor                    | Quando                       | O que exibir no frontend                                                                       |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `past_due`               | Subscription em `past_due`   | Banner amarelo: "Pagamento pendente. Regularize até [data] para evitar perda de acesso."       |
| `downgraded`             | Subscription em `downgraded` | Banner vermelho: "Conta rebaixada para Free. Dados excluídos em [data_deletion_scheduled_at]." |
| `trial_ending`           | Trial encerra em ≤ 3 dias    | Banner azul: "Seu trial encerra em X dias. Adicione um cartão para continuar."                 |
| `cancellation_scheduled` | `cancelled_at` preenchido    | Banner informativo: "Sua subscription encerra em [current_period_end]."                        |

O frontend deve ler este header em todas as respostas e exibir o banner correspondente globalmente (ex: topo da aplicação).

---

## 8. User Stories

As histórias abaixo cobrem as duas interfaces: **Admin da Plataforma** (super_admin) e **Dashboard do Tenant** (org_admin / manager).

---

### 8.1 Admin da Plataforma (super_admin)

---

**US-B01 — Listar todos os planos**

> Como super_admin, quero ver todos os planos existentes (ativos, inativos, exclusivos e do sistema) para ter visão completa do catálogo.

**Critérios de aceite:**

- Exibir lista paginada com nome, preço, módulos, status ativo/inativo, visibilidade (público/exclusivo) e quantidade de subscribers ativos.
- Permitir filtrar por: `is_active`, `is_public`, `is_system`.
- Itens sem subscriber devem ser visualmente distintos dos que têm.

**API:** `GET /platform/billing/plans`
**Permissão:** `platform.billing.manage`

---

**US-B02 — Criar novo plano**

> Como super_admin, quero criar um plano customizado com módulos, limites, preço e trial configuráveis, para atender clientes Enterprise com condições específicas.

**Critérios de aceite:**

- Formulário com campos: nome (slug), nome de exibição, descrição, preço em centavos, moeda, período de cobrança, módulos habilitados (multi-select), max seats, max integrações, dias de histórico, dias de trial, flags de features, visibilidade pública/exclusiva, status ativo/inativo.
- Validações no frontend antes de submeter: `name` sem espaços; ao menos `core` em `modules[]`; `price_cents ≥ 0`.
- Exibir erro `409` como: "Já existe um plano com esse identificador."
- Após criação, redirecionar para o detalhe do plano criado.

**API:** `POST /platform/billing/plans`
**Permissão:** `platform.billing.manage`

---

**US-B03 — Editar plano existente**

> Como super_admin, quero editar qualquer campo de um plano (inclusive preço e módulos), para ajustar condições sem precisar criar um novo plano.

**Critérios de aceite:**

- Formulário pré-preenchido com os dados atuais.
- Ao reduzir `modules`, `max_seats`, `max_integrations` ou `history_days`, exibir modal de confirmação: "Este plano tem X subscribers ativos. Escolha quando aplicar as mudanças:" com opções:
  - ⚡ "Aplicar imediatamente" (marca `apply_at_renewal: false` — propagação em até 60s)
  - 📅 "Aplicar apenas na renovação" (marca `apply_at_renewal: true` — recomendado para redução de entitlements)
- A resposta inclui `meta.affected_subscriptions` — usar esse valor no modal.
- Se mudanças **aumentam** entitlements (ex: adicionar módulo), pode aplicar imediatamente sem modal.
- Planos do sistema (`is_system: true`) podem ser editados, mas **não deletados** — desabilitar botão de exclusão com tooltip explicativo.
- Validar que `modules` sempre inclui `"core"` antes de submeter.

**API:** `PATCH /platform/billing/plans/:plan_id`
**Permissão:** `platform.billing.manage`

---

**US-B04 — Ativar e desativar plano**

> Como super_admin, quero ativar ou desativar um plano para controlar quais estão disponíveis no checkout, sem precisar deletá-los.

**Critérios de aceite:**

- Toggle de status visível na listagem e no detalhe do plano.
- Desativar plano com subscribers ativos é permitido — apenas novos não podem subscrever. Exibir aviso: "Subscribers existentes continuarão neste plano até cancelarem ou mudarem."
- Reativar plano exige apenas confirmar a ação.

**API:** `PATCH /platform/billing/plans/:plan_id` com `{ "is_active": false }`
**Permissão:** `platform.billing.manage`

---

**US-B05 — Deletar plano**

> Como super_admin, quero deletar planos customizados que não são mais necessários.

**Critérios de aceite:**

- Botão de exclusão disponível apenas quando `is_system: false`.
- Se `active_subscriptions_count > 0`, exibir mensagem de erro: "Este plano tem subscribers ativos. Desative-o primeiro ou mova os tenants para outro plano."
- Confirmar exclusão com modal antes de submeter o `DELETE`.
- Após exclusão, retornar à listagem.

**API:** `DELETE /platform/billing/plans/:plan_id`
**Permissão:** `platform.billing.manage`

---

**US-B06 — Vincular plano exclusivo a um tenant**

> Como super_admin, quero vincular um plano `is_public: false` a um tenant específico para que ele possa subscrevê-lo no checkout.

**Critérios de aceite:**

- Dentro do detalhe de um plano exclusivo, exibir seção "Tenants com acesso" com lista dos assignments.
- Campo de busca de tenant por nome ou ID para adicionar novo vínculo.
- Ao vincular, exibir confirmação: "Tenant [nome] agora pode subscrever este plano."
- Ao remover vínculo, exibir aviso: "O tenant perderá visibilidade do plano, mas subscriptions ativas não serão canceladas."

**API:** `POST /platform/billing/plans/:plan_id/assignments` e `DELETE /platform/billing/plans/:plan_id/assignments/:tenant_id`
**Permissão:** `platform.billing.manage`

---

### 8.2 Dashboard do Tenant (org_admin / manager)

---

**US-B07 — Ver plano atual e uso**

> Como org_admin ou manager, quero ver qual plano meu tenant usa atualmente, quais módulos estão ativos e quanto do limite de seats e integrações já consumimos.

**Critérios de aceite:**

- Exibir nome do plano, preço/ciclo (`billing_period`), data de renovação (`current_period_end`), status da subscription.
- Exibir gráficos ou barras de progresso para: seats usados/limite e integrações usadas/limite.
- Para limites `unlimited: true`, exibir "Ilimitado" em vez de barra de progresso.
- Exibir lista dos módulos habilitados no plano atual.
- Exibir banner de status conforme `X-Billing-Warning` (ver seção 7.4).

**APIs:** `GET /billing/subscription` + `GET /billing/usage`
**Permissão:** `billing.read`

---

**US-B08 — Ver planos disponíveis e fazer upgrade**

> Como org_admin, quero comparar os planos disponíveis e fazer upgrade para um plano pago via Stripe Checkout.

**Critérios de aceite:**

- Listar planos com destaque no plano atual (`is_current: true`).
- Exibir módulos, limites e preço de cada plano.
- Botão "Assinar" ou "Fazer upgrade" em planos não-atuais.
- Ao clicar, chamar `POST /billing/checkout` e redirecionar para `checkout_url`.
- Após retornar da Stripe com `?success=true`, fazer polling em `GET /billing/subscription` por até 15s até detectar mudança de plano. Exibir loading durante o polling.
- Se timeout do polling, exibir mensagem: "Seu pagamento foi processado. O plano pode levar alguns instantes para atualizar — recarregue a página."

**APIs:** `GET /billing/plans` + `POST /billing/checkout`
**Permissão:** `billing.manage` (para checkout; listagem é pública)

---

**US-B09 — Gerenciar cartão e ver faturas**

> Como org_admin, quero atualizar meu cartão de crédito e consultar faturas — sem que esses dados passem pela API da moasy.

**Critérios de aceite:**

- Botão "Gerenciar pagamento" que chama `POST /billing/portal` e redireciona para o Stripe Customer Portal.
- Disponível apenas para tenants com plano pago (`price_cents > 0`).
- Se tenant nunca teve plano pago (sem `provider_customer_id`), o botão não aparece ou exibe tooltip: "Disponível após assinar um plano pago."
- Ao retornar do portal (via `return_url`), recarregar `GET /billing/subscription`.

**API:** `POST /billing/portal`
**Permissão:** `billing.manage`

---

**US-B10 — Cancelar subscription**

> Como org_admin, quero cancelar minha subscription, mantendo acesso até o fim do período pago.

**Critérios de aceite:**

- Botão "Cancelar assinatura" disponível apenas para subscriptions com `status: active | trialing`.
- Modal de confirmação com: data de encerramento do acesso (`current_period_end`), aviso sobre perda de módulos.
- Após confirmar, chamar `POST /billing/cancel` e exibir: "Assinatura cancelada. Você terá acesso até [data]."
- Atualizar o banner e status na tela de plano.
- Não exibir o botão se `cancelled_at` já estiver preenchido.

**API:** `POST /billing/cancel`
**Permissão:** `billing.manage`

---

**US-B11 — Avisos de pagamento pendente (past_due)**

> Como org_admin, quero ser avisado claramente quando meu pagamento falhar e saber quanto tempo tenho antes de perder acesso aos módulos premium.

**Critérios de aceite:**

- Detectar header `X-Billing-Warning: past_due` em qualquer resposta da API.
- Exibir banner amarelo fixo no topo: "Pagamento pendente. Regularize até [past_due_since + 10 dias] para evitar rebaixamento do plano."
- Botão no banner: "Atualizar pagamento" → abre Stripe Customer Portal via `POST /billing/portal`.
- Countdown do prazo atualizado diariamente.

**Header:** `X-Billing-Warning: past_due` + `GET /billing/subscription`
**Permissão:** `billing.read` (para exibir prazo)

---

**US-B12 — Aviso de conta rebaixada (downgraded)**

> Como org_admin, quero saber que minha conta foi rebaixada para Free por inadimplência e ter clareza sobre quando meus dados serão excluídos.

**Critérios de aceite:**

- Detectar header `X-Billing-Warning: downgraded`.
- Exibir banner vermelho fixo: "Conta rebaixada para Free. Seus dados serão excluídos em [data_deletion_scheduled_at]. Reative agora para preservá-los."
- Botão "Reativar" → redireciona para listagem de planos com `POST /billing/checkout`.
- Countdown de dias até o expurgo, atualizado diariamente.
- Módulos não habilitados no Free devem ser bloqueados na sidebar/nav com ícone de cadeado e tooltip: "Disponível no Starter ou superior."

**Header:** `X-Billing-Warning: downgraded` + `GET /billing/subscription`

---

**US-B13 — Ver histórico de eventos de cobrança**

> Como org_admin, quero consultar o histórico de eventos da minha subscription para fins de auditoria.

**Critérios de aceite:**

- Lista paginada com: tipo de evento (traduzido para português), data/hora, provedor.
- Labels amigáveis por `event_type` (ex: `invoice.paid` → "Fatura paga", `subscription.downgraded` → "Plano rebaixado automaticamente").
- Paginação via cursor.

**API:** `GET /billing/events`
**Permissão:** `billing.manage`

---

## 9. Modelo de precificação

> ✅ **Decisão #1 fechada:** O modelo de preço é **inteiramente configurável por plano** — cada plano tem `price_cents`, `billing_period`, `max_seats`, `max_integrations`. O sistema suporta qualquer modelo (flat, por seat, híbrido) sem mudança de código: basta criar/editar planos no admin.

Para os planos base de partida, a sugestão é **flat-rate** (preço fixo por tier), com `max_seats` e `max_integrations` como **hard limits** (bloqueiam ao atingir) — mais simples de comunicar e suficiente para o MVP. Se quisermos cobrar por seat excedente no futuro, `SubscriptionUsage` já prevê isso.

---

## 10. Posicionamento no roadmap

O módulo de Billing não pertence explicitamente a nenhuma das fases 1–4 atuais — trata-se de uma camada **transversal de monetização**, não de uma feature de produto.

**Proposta:** Inserir como **Fase 0.5 — Monetização & Acesso** a ser implementado após estabilizar a Fase 1, antes de abrir para beta público. Isso garante que o produto já tenha a estrutura de planos operacional quando começar a crescer.

Dependências mínimas para implementar:

- Fase 1 completa (Auth, IAM, Tenants)
- Conta Stripe configurada (API keys, webhook endpoint registrado)

---

## 11. Riscos e não-decisões

| Risco                                                            | Mitigação                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe webhook fora de ordem (ex: invoice antes de subscription) | ✅ Idempotência por `provider_subscription_id` + log em `BillingEvent`                                                                                                                                  |
| Tenant em `past_due` continua usando features premium            | ✅ Grace period explícito + job periódico de enforce                                                                                                                                                    |
| Tenant reativa após D+30 e espera dado existente                 | ✅ Email de aviso explícito antes do D+30; tela de onboarding após reativação tardia. **Decisão comercial:** Reativação não gera crédito pelos dias de downgrade — Stripe não emite crédito automático. |
| Job de expurgo falha                                             | ✅ Retry com backoff exponencial (3 tentativas); DLQ para falhas persistentes; alerta `super_admin` via Slack/email                                                                                     |
| Dados de cartão tratados aqui → PCI                              | ✅ Stripe Hosted Checkout — **nenhum dado de cartão passa pela API moasy**                                                                                                                              |
| Webhook endpoint sem rate limit                                  | ✅ Rate limit de 100 req/min por IP — previne flood de HMAC inválidos                                                                                                                                   |
| Mudanças de plano afetam tenants pagantes no meio do ciclo       | ✅ Flag `apply_at_renewal` — mudanças agendadas em `pending_plan_changes` e aplicadas em `current_period_end`                                                                                           |

**Fora do escopo inicial (pós-MVP billing):**

- Cobrança baseada em uso (API calls, eventos processados)
- Multi-moeda dinâmica
- Cupons e promoções (pode ser feito no Stripe sem código extra)
- Notas fiscais BR (NF-e) — tratado separadamente se necessário

---

## 12. Checklist de aprovação

- [x] Modelo de precificação decidido — baseado nos planos criados, flat-rate por padrão (decisão #1)
- [ ] Feature gates dos planos base de seed validados comercialmente (decisão #2 — pendente revisão da tabela)
- [x] Quem pode criar planos: `super_admin` / `platform_admin` via admin da plataforma (decisão #2a)
- [x] Guard por módulo via funções standalone `requireModule`/`requireFeature` em `entitlement.ts` (decisão #3)
- [x] Trial configurável por plano via `trial_days` (decisão #4)
- [x] Downgrade voluntário ao fim do ciclo; por inadimplência após 10 dias (decisão #5)
- [x] Grace period de 10 dias (decisão #6)
- [x] `billing.manage` apenas `org_admin`; `billing.read` inclui `manager` (decisão #7)
- [x] `platform_role: super_admin | platform_admin` no `PlatformAccount` (decisão #8)
- [x] Edição de plano com subscribers ativos → flag `apply_at_renewal` para aplicar na renovação (decisão #9)
- [x] `max_seats` e `max_integrations` funcionam como **hard limits** — bloqueiam adição ao atingir (decisão #10)
- [x] Módulo `core` é **obrigatório** em todos os planos — validado no PATCH (decisão #11)
- [x] `SubscriptionHistory` adicionado para auditoria temporal de planos (decisão #12)
- [x] Rate limit de 100 req/min no webhook endpoint (decisão #13)
- [x] Job de purge com retry (3x) + DLQ para falhas persistentes (decisão #14)
- [x] Após 10 dias `past_due` → downgrade para Free; dados retidos por 30 dias
- [x] Reativação automática via webhook do provedor; `downgraded` é transitório
- [x] **Plano aprovado** ✅ — pronto para abrir issue de implementação

---

## 13. Plano de Implementação

O módulo é implementado em **7 etapas sequenciais** (6 originais + Etapa 7: integração Stripe). Todas concluídas. Cada etapa é um PR independente e deployável. Nenhuma etapa quebra funcionalidade existente.

---

### Etapa 1 — Schema e `platform_role` (Prisma + Auth)

**Objetivo:** Criar as tabelas do módulo e expor `platform_role` no JWT.

#### 1.1 Migration Prisma

Criar uma nova migration com os seguintes modelos:

````prisma
// Adicionar ao enum PlatformRole (não quebra — additive)
// PlatformRole já existe; platform_role é campo novo em PlatformAccount

// Novo enum para platform_role
enum PlatformSuperRole {
  super_admin
  platform_admin
}

// Alterar PlatformAccount — adicionar campo nullable
model PlatformAccount {
  // ... campos existentes ...
  platformRole  PlatformSuperRole?   // null = usuário de tenant
}

// Novos models
model Plan {
  id               String    @id @default(uuid())
  name             String    @unique
  displayName      String
  description      String?
  priceCents       Int
  currency         String    @default("USD")
  billingPeriod    String    // "monthly" | "annual"
  stripePriceId    String?   // price_xxx — obrigatório em planos pagos para criar Checkout Session
  modules          String[]
  maxSeats         Int?
  maxIntegrations  Int?
  historyDays      Int?
  trialDays        Int       @default(0)
  features         Json      @default("{}")
  isSystem         Boolean   @default(false)
  isPublic         Boolean   @default(true)
  isActive         Boolean   @default(true)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  subscriptions       Subscription[]
  scheduledDowngrades Subscription[] @relation("ScheduledDowngrade")
  assignments         PlanTenantAssignment[]
  subscriptionHistory SubscriptionHistory[]
}

enum SubscriptionStatus {
  trialing
  active
  past_due
  downgraded
  cancelled
  expired
}

model Subscription {
  id                        String             @id @default(uuid())
  tenantId                  String             @unique  // um tenant tem UMA subscription ativa
  planId                    String
  scheduledDowngradePlanId  String?
  pendingPlanChanges        Json?              // mudanças agendadas para current_period_end
  status                    SubscriptionStatus @default(active)
  trialEndsAt               DateTime?
  currentPeriodStart        DateTime
  currentPeriodEnd          DateTime
  pastDueSince              DateTime?
  downgradedAt              DateTime?
  dataDeletionScheduledAt   DateTime?
  cancelledAt               DateTime?
  provider                  String?
  providerSubscriptionId    String?
  providerCustomerId        String?
  createdAt                 DateTime           @default(now())
  updatedAt                 DateTime           @updatedAt

  plan                      Plan               @relation(fields: [planId], references: [id])
  scheduledDowngradePlan    Plan?              @relation("ScheduledDowngrade", fields: [scheduledDowngradePlanId], references: [id])

  @@index([status])
  @@index([pastDueSince])
  @@index([dataDeletionScheduledAt])
}

model SubscriptionHistory {
  id        String   @id @default(uuid())
  tenantId  String
  planId    String
  startedAt DateTime
  endedAt   DateTime?
  status    String
  createdAt DateTime @default(now())

  plan      Plan     @relation(fields: [planId], references: [id])

  @@index([tenantId, startedAt])
  @@index([endedAt])
}

model PlanTenantAssignment {
  id        String   @id @default(uuid())
  planId    String
  tenantId  String
  createdAt DateTime @default(now())

  plan      Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([planId, tenantId])
  @@index([tenantId])
}

```prisma
model BillingEvent {
  id                String   @id @default(uuid())
  tenantId          String
  eventType         String
  provider          String?
  providerEventId   String?  @unique  // event.id do Stripe — garante idempotência
  rawPayload        Json?
  occurredAt        DateTime
  createdAt         DateTime @default(now())

  @@index([tenantId])
  @@index([occurredAt])
  @@index([providerEventId])  // índice para lookup rápido na verificação de duplicação
}
````

````

> **Nota de boundary:** `Subscription.tenantId` tem `@unique` — garante que cada tenant tem exatamente uma subscription ativa. Não usar FK para `Tenant` neste schema para manter isolamento de módulo; a integridade é verificada na camada de serviço.

#### 1.2 Alterar `plugins/auth.ts`

Adicionar `platform_role` ao tipo `JwtUser` e ao token gerado:

```typescript
// plugins/auth.ts — atualizar tipo
type JwtUser = {
  sub: string;
  tenant_id: string;
  roles: string[];
  permissions: string[];
  platform_role?: 'super_admin' | 'platform_admin' | null;  // novo
};

// Adicionar decorator requirePlatformRole
app.decorate('requirePlatformRole', (...allowedRoles: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser | undefined;
    if (!user?.platform_role || !allowedRoles.includes(user.platform_role)) {
      return reply.status(403).send(
        fail(request, 'FORBIDDEN', 'Platform role required')
      );
    }
  };
});
````

#### 1.3 Alterar `modules/auth/service.ts`

- Em `login()` e `refresh()`: incluir `platform_role` no payload do JWT.
- Em `register()`: criar `Subscription` no plano Free ao final da transação.

> **Exceção de boundary documentada:** o módulo Auth acessa diretamente as tabelas `Plan` e `Subscription` (pertencentes ao Billing) durante o register. Isso viola a regra de ownership de dados por módulo, mas é aceita como exceção pragmática no MVP pelos seguintes motivos: (1) a criação da Subscription é atômica com a criação do Tenant — separar em dois serviços exigiria compensação transacional; (2) a dependência é unidirecional (Auth → Billing; Billing nunca acessa Auth). Se esta exceção se tornar problemática, a alternativa é o Auth emitir um evento `tenant.registered` e o Billing criar a Subscription reactivamente.

```typescript
// Em login() — adicionar ao signToken payload:
platform_role: account.platformRole ?? null,

// Em register() — ao final, após criar o PlatformAccount:
const freePlan = await prisma.plan.findFirst({ where: { name: 'free', isActive: true } });
if (!freePlan) {
  // O seed de planos (Etapa 6) deve rodar antes de abrir registros para o público.
  throw new Error('Free plan not found. Run billing seed before accepting registrations.');
}
const now = new Date();
const subscription = await prisma.subscription.create({
  data: {
    tenantId: input.tenant_id,
    planId: freePlan.id,
    status: freePlan.trialDays > 0 ? 'trialing' : 'active',
    trialEndsAt: freePlan.trialDays > 0 ? new Date(now.getTime() + freePlan.trialDays * 86400000) : null,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
  }
});

// Criar primeiro registro no SubscriptionHistory
await prisma.subscriptionHistory.create({
  data: {
    tenantId: input.tenant_id,
    planId: freePlan.id,
    startedAt: now,
    endedAt: null,  // null = plano atual
    status: subscription.status
  }
});
```

**Arquivos alterados nesta etapa:**

- `prisma/schema.prisma` — novos modelos + `platformRole` em `PlatformAccount`
- `src/plugins/auth.ts` — `JwtUser` type + `requirePlatformRole` decorator
- `src/modules/auth/service.ts` — JWT payload + criação de Subscription on register

---

### Etapa 2 — `BillingEntitlementService`

**Objetivo:** Implementar o serviço de entitlement com cache em memória, sem acoplamento nos outros módulos.

#### 2.1 Criar `src/modules/billing/entitlement.ts`

```typescript
// src/modules/billing/entitlement.ts
import { prisma } from "../../lib/prisma.js";
import { fail } from "../../lib/http.js";
import type { FastifyReply, FastifyRequest } from "fastify";

type EntitlementCache = {
  modules: string[];
  features: Record<string, boolean>;
  maxSeats: number | null;
  maxIntegrations: number | null;
  historyDays: number | null;
  trialEndsAt: Date | null;
  status: string;
  expiresAt: number; // Date.now() + TTL
};

const CACHE_TTL_MS = 60_000; // 60s
const cache = new Map<string, EntitlementCache>();

async function loadEntitlement(tenantId: string): Promise<EntitlementCache> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const sub = await prisma.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  // Fallback: sem subscription = Free hardcoded (não deve ocorrer em produção)
  const entry: EntitlementCache = sub
    ? {
        modules: sub.plan.modules,
        features: (sub.plan.features as Record<string, boolean>) ?? {},
        maxSeats: sub.plan.maxSeats,
        maxIntegrations: sub.plan.maxIntegrations,
        historyDays: sub.plan.historyDays,
        trialEndsAt: sub.trialEndsAt ?? null,
        status: sub.status,
        expiresAt: Date.now() + CACHE_TTL_MS,
      }
    : {
        modules: ["core"],
        features: {},
        maxSeats: 2,
        maxIntegrations: 1,
        historyDays: 30,
        trialEndsAt: null,
        status: "active",
        expiresAt: Date.now() + CACHE_TTL_MS,
      };

  cache.set(tenantId, entry);
  return entry;
}

export function invalidateEntitlementCache(tenantId: string) {
  cache.delete(tenantId);
}

// Exportar guards para uso nos módulos
export function requireModule(moduleName: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const ent = await loadEntitlement(tenantId);

    // Subscriptions downgraded ou expired bloqueiam módulos premium
    const blockedStatuses = ["expired"];
    if (
      blockedStatuses.includes(ent.status) ||
      !ent.modules.includes(moduleName)
    ) {
      return reply.status(402).send(
        fail(
          request,
          "UPGRADE_REQUIRED",
          `Module "${moduleName}" requires a higher plan.`,
          {
            module_required: moduleName,
            current_plan_modules: ent.modules,
            upgrade_url: "https://moasy.tech/billing/upgrade",
          },
        ),
      );
    }
  };
}

export function requireFeature(featureName: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const ent = await loadEntitlement(tenantId);

    if (!ent.features[featureName]) {
      return reply
        .status(402)
        .send(
          fail(
            request,
            "UPGRADE_REQUIRED",
            `Feature "${featureName}" requires a higher plan.`,
          ),
        );
    }
  };
}

export { loadEntitlement };
```

#### 2.2 Adicionar header `X-Billing-Warning` ao hook global

Em `src/app.ts`, adicionar um `onSend` hook para injetar o header:

```typescript
// src/app.ts — adicionar no topo do arquivo:
import { loadEntitlement } from "./modules/billing/entitlement.js";

// Adicionar ao registrar os plugins:
app.addHook("onSend", async (request, reply) => {
  const user = request.user as { tenant_id?: string } | undefined;
  if (!user?.tenant_id) return;

  const ent = await loadEntitlement(user.tenant_id).catch(() => null);
  if (!ent) return;

  if (ent.status === "past_due") {
    reply.header("X-Billing-Warning", "past_due");
  } else if (ent.status === "downgraded") {
    reply.header("X-Billing-Warning", "downgraded");
  } else if (ent.status === "trialing" && ent.trialEndsAt) {
    const daysLeft = Math.ceil(
      (ent.trialEndsAt.getTime() - Date.now()) / 86_400_000,
    );
    if (daysLeft <= 3) reply.header("X-Billing-Warning", "trial_ending");
  } else if (ent.status === "cancelled") {
    reply.header("X-Billing-Warning", "cancellation_scheduled");
  }
});
```

**Arquivos alterados nesta etapa:**

- `src/modules/billing/entitlement.ts` — novo arquivo
- `src/app.ts` — hook `onSend` para `X-Billing-Warning`

---

### Etapa 3 — Guards nos módulos existentes

**Objetivo:** Proteger rotas dos módulos SLA, COGS, Intel e DORA com `requireModule`.

#### 3.1 Padrão de uso nos módulos

Cada módulo adiciona o guard como `preHandler` nas rotas relevantes:

```typescript
// Exemplo em src/modules/sla/routes.ts
import { requireModule } from "../billing/entitlement.js";

// Nas rotas que exigem o módulo SLA:
app.get(
  "/sla/templates",
  {
    preHandler: [app.authenticate, requireModule("sla")],
  },
  handler,
);
```

#### 3.2 Mapeamento de módulos × rotas

| Módulo  | Rota protegida                        | Guard                                   | Motivo                                                          |
| ------- | ------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `sla`   | `/sla/*`                              | `requireModule('sla')`                  | Free não tem SLA                                                |
| `cogs`  | `/cogs/*`                             | `requireModule('cogs')`                 | Free e Starter não têm COGS                                     |
| `intel` | `/intel/*`                            | `requireModule('intel')`                | Somente Enterprise                                              |
| `dora`  | `/dora/scorecard` e rotas de MTTR/CFR | `requireFeature('dora_full_scorecard')` | Free tem `dora` em `modules[]` mas `dora_full_scorecard: false` |
| `comms` | `/comms/*` (alertas)                  | `requireFeature('alerts')`              | Free não tem alertas                                            |

> `/dora/deploys`, `/dora/lead-time` e `/dora/history/*` ficam **sem guard de 402** — ingestão e histórico funcionam no Free. O limite `historyDays` é aplicado filtrando o intervalo de datas na query (não via 402).

**Arquivos alterados nesta etapa:**

- `src/modules/sla/routes.ts`
- `src/modules/cogs/routes.ts`
- `src/modules/intel/routes.ts`
- `src/modules/dora/routes.ts`
- `src/modules/comms/routes.ts`

---

### Etapa 4 — Módulo Billing (CRUD + endpoints de tenant)

**Objetivo:** Implementar todas as rotas documentadas na seção 7.

#### Estrutura de arquivos

```
src/modules/billing/
  schema.ts          ← validação Zod de todos os inputs
  service.ts         ← lógica de negócio (planos, subscriptions, Stripe)
  routes.ts          ← rotas /billing/* do tenant
  platform-routes.ts ← rotas /platform/billing/* do super_admin
  entitlement.ts     ← já criado na Etapa 2
  stripe.ts          ← wrapper Stripe SDK
```

#### 4.1 `billing/stripe.ts`

```typescript
// src/modules/billing/stripe.ts
import Stripe from "stripe";

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) throw new Error("STRIPE_SECRET_KEY env var is required");

if (!process.env.STRIPE_WEBHOOK_SECRET)
  throw new Error("STRIPE_WEBHOOK_SECRET env var is required");
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });
```

> **Variáveis de ambiente novas:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

#### 4.2 `billing/service.ts` — funções principais

| Função                                          | Descrição                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `listPlansForTenant(tenantId)`                  | Planos `is_public + is_active` + exclusivos do tenant                    |
| `listAllPlans(filters)`                         | Todos os planos (super_admin)                                            |
| `createPlan(input)`                             | Cria plano, valida módulos e stripe_price_id                             |
| `updatePlan(planId, input)`                     | Atualiza, retorna `affected_subscriptions`                               |
| `deletePlan(planId)`                            | Valida `is_system` e sem subscribers                                     |
| `createAssignment(planId, tenantId)`            | Vincula plano exclusivo                                                  |
| `deleteAssignment(planId, tenantId)`            | Remove vínculo                                                           |
| `getSubscription(tenantId)`                     | Busca subscription com plano                                             |
| `createCheckoutSession(tenantId, planId, urls)` | Cria Stripe Checkout Session                                             |
| `createPortalSession(tenantId, returnUrl)`      | Cria Stripe Customer Portal                                              |
| `cancelSubscription(tenantId)`                  | Agenda cancelamento via Stripe                                           |
| `getUsage(tenantId)`                            | Calcula seats e integrações usados                                       |
| `listBillingEvents(tenantId, query)`            | Lista eventos paginados                                                  |
| `handleStripeWebhook(rawBody, signature)`       | Processa eventos Stripe, cria SubscriptionHistory em upgrades/downgrades |

**Implementação da idempotência do webhook handler:**

```typescript
// Em handleStripeWebhook()
export async function handleStripeWebhook(rawBody: string, signature: string) {
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    WEBHOOK_SECRET,
  );

  // ✅ IDEMPOTÊNCIA: Verificar se evento já foi processado
  const existing = await prisma.billingEvent.findUnique({
    where: { providerEventId: event.id },
  });

  if (existing) {
    // Evento duplicado — retornar sucesso sem reprocessar
    return { processed: false, reason: "duplicate" };
  }

  // Processar evento conforme tipo
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object);
      break;
    case "invoice.payment_failed":
      await handlePaymentFailed(event.data.object);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object);
      break;
  }

  // Registrar evento como processado
  await prisma.billingEvent.create({
    data: {
      tenantId: extractTenantId(event),
      eventType: event.type,
      provider: "stripe",
      providerEventId: event.id, // ✅ Garante idempotência
      rawPayload: event,
      occurredAt: new Date(event.created * 1000),
    },
  });

  return { processed: true };
}
```

**Validações obrigatórias em `createPlan`:**

```typescript
// Validar que planos pagos têm stripe_price_id
if (input.price_cents > 0 && !input.stripe_price_id) {
  throw new Error("stripe_price_id is required for paid plans");
}

// Validar core obrigatório
if (!input.modules?.includes("core")) {
  throw new Error('Module "core" is required in all plans');
}
```

#### 4.3 `billing/routes.ts` — rotas do tenant

```typescript
export async function billingRoutes(app: FastifyInstance) {
  // GET /billing/plans — público, mas tenant_id opcional via JWT
  app.get("/billing/plans", handler);

  // Rotas autenticadas
  app.get(
    "/billing/subscription",
    { preHandler: [app.authenticate, app.requirePermission("billing.read")] },
    handler,
  );
  app.get(
    "/billing/usage",
    { preHandler: [app.authenticate, app.requirePermission("billing.read")] },
    handler,
  );
  app.get(
    "/billing/events",
    { preHandler: [app.authenticate, app.requirePermission("billing.manage")] },
    handler,
  );
  app.post(
    "/billing/checkout",
    { preHandler: [app.authenticate, app.requirePermission("billing.manage")] },
    handler,
  );
  app.post(
    "/billing/portal",
    { preHandler: [app.authenticate, app.requirePermission("billing.manage")] },
    handler,
  );
  app.post(
    "/billing/cancel",
    { preHandler: [app.authenticate, app.requirePermission("billing.manage")] },
    handler,
  );

  // Webhook Stripe — sem JWT, com HMAC + rate limit
  app.post(
    "/billing/webhooks/stripe",
    {
      config: {
        rawBody: true,
        rateLimit: {
          max: 100,
          timeWindow: "1 minute",
          keyGenerator: (req) => req.ip, // rate limit por IP
        },
      },
    },
    handler,
  );
}
```

#### 4.4 `billing/platform-routes.ts` — rotas do super_admin

```typescript
export async function platformBillingRoutes(app: FastifyInstance) {
  const guard = [
    app.authenticate,
    app.requirePlatformRole("super_admin", "platform_admin"),
  ];

  app.get("/platform/billing/plans", { preHandler: guard }, handler);
  app.post("/platform/billing/plans", { preHandler: guard }, handler);
  app.get("/platform/billing/plans/:plan_id", { preHandler: guard }, handler);
  app.patch("/platform/billing/plans/:plan_id", { preHandler: guard }, handler);
  app.delete(
    "/platform/billing/plans/:plan_id",
    { preHandler: guard },
    handler,
  );
  app.post(
    "/platform/billing/plans/:plan_id/assignments",
    { preHandler: guard },
    handler,
  );
  app.delete(
    "/platform/billing/plans/:plan_id/assignments/:tenant_id",
    { preHandler: guard },
    handler,
  );
}
```

#### 4.5 Validações obrigatórias no `billing/service.ts`

**Validação de `core` obrigatório:**

```typescript
// Em createPlan() e updatePlan()
if (!input.modules?.includes("core")) {
  throw new Error('Module "core" is required in all plans');
}
```

**Aplicação de mudanças agendadas com `apply_at_renewal`:**

```typescript
// Em updatePlan() quando apply_at_renewal: true e há subscribers ativos
if (input.apply_at_renewal && affectedSubscriptions > 0) {
  // Verificar se são mudanças que reduzem entitlements
  const isReduction = /* lógica para detectar redução em modules, max_seats, etc. */;

  if (isReduction) {
    // Armazenar mudanças em cada subscription.pendingPlanChanges
    const changes = pick(input, ['modules', 'maxSeats', 'maxIntegrations', 'historyDays', 'features']);

    await prisma.subscription.updateMany({
      where: { planId, status: { in: ['active', 'trialing'] } },
      data: { pendingPlanChanges: changes }
    });

    // NÃO aplicar mudanças no Plan imediatamente
    // Serão aplicadas pelo job billing-apply-pending-changes em current_period_end
    return { /* resposta com mudanças agendadas */ };
  }
}

// Se apply_at_renewal: false OU não há redução, aplicar imediatamente
await prisma.plan.update({ where: { id: planId }, data: input });
```

> **Importante para o admin da plataforma:** A UI do admin deve exibir um toggle "Aplicar apenas na renovação" ao editar planos com subscribers ativos. Esse toggle só deve aparecer quando detectar reduções em `modules`, `max_seats`, `max_integrations`, `history_days` ou `features`. Aumentos de entitlements podem ser aplicados imediatamente sem risco.

#### 4.6 Registro no `app.ts`

```typescript
// src/app.ts
import { billingRoutes } from "./modules/billing/routes.js";
import { platformBillingRoutes } from "./modules/billing/platform-routes.js";

app.register(billingRoutes, { prefix: "/api/v1" });
app.register(platformBillingRoutes, { prefix: "/api/v1" });
```

#### 4.7 Adicionar permissões no `auth/service.ts`

```typescript
// ROLE_PERMISSIONS — adicionar billing ao manager e org_admin
org_admin: ['*'],
manager: [
  // ... existentes ...
  'billing.read'       // manager vê a subscription
],
// billing.manage fica no wildcard do org_admin
```

**Arquivos criados/alterados:**

- `src/modules/billing/schema.ts` — novo
- `src/modules/billing/service.ts` — novo
- `src/modules/billing/routes.ts` — novo
- `src/modules/billing/platform-routes.ts` — novo
- `src/modules/billing/stripe.ts` — novo
- `src/app.ts` — registrar rotas e hook `onSend`
- `src/modules/auth/service.ts` — ROLE_PERMISSIONS

---

### Etapa 5 — Jobs de enforcement

**Objetivo:** Implementar os três jobs que mantêm a integridade do ciclo de vida das subscriptions.

#### 5.1 Job `billing-apply-pending-changes` (roda a cada 6 horas)

```typescript
// src/modules/billing/jobs/apply-pending-changes.ts

export async function applyPendingChanges() {
  const due = await prisma.subscription.findMany({
    where: {
      pendingPlanChanges: { not: null },
      currentPeriodEnd: { lte: new Date() },
    },
    include: { plan: true },
  });

  for (const sub of due) {
    const changes = sub.pendingPlanChanges as Record<string, any>;

    // ⚠️ IMPORTANTE: As mudanças são aplicadas RECRIANDO o Plan personalizado para este tenant,
    // NÃO alterando o Plan original que outros tenants podem estar usando.
    // Isso requer criar um novo Plan com os parâmetros ajustados.

    // Se o plano original era público e shared, criar um plano exclusivo para este tenant
    const newPlan = await prisma.plan.create({
      data: {
        name: `${sub.plan.name}-custom-${sub.tenantId.slice(0, 8)}`,
        displayName: sub.plan.displayName,
        description: `Custom plan for tenant ${sub.tenantId}`,
        priceCents: sub.plan.priceCents,
        currency: sub.plan.currency,
        billingPeriod: sub.plan.billingPeriod,
        stripePriceId: sub.plan.stripePriceId,
        // Aplicar as mudanças pendentes
        modules: changes.modules ?? sub.plan.modules,
        maxSeats: changes.maxSeats ?? sub.plan.maxSeats,
        maxIntegrations: changes.maxIntegrations ?? sub.plan.maxIntegrations,
        historyDays: changes.historyDays ?? sub.plan.historyDays,
        trialDays: sub.plan.trialDays,
        features: changes.features ?? sub.plan.features,
        isSystem: false,
        isPublic: false,
        isActive: true,
      },
    });

    await prisma.$transaction([
      // Atualizar subscription para usar o novo plano customizado
      prisma.subscription.update({
        where: { id: sub.id },
        data: {
          planId: newPlan.id,
          pendingPlanChanges: null,
        },
      }),
      // Criar assignment exclusivo
      prisma.planTenantAssignment.create({
        data: {
          planId: newPlan.id,
          tenantId: sub.tenantId,
        },
      }),
      // Log
      prisma.billingEvent.create({
        data: {
          tenantId: sub.tenantId,
          eventType: "plan.changes_applied",
          occurredAt: new Date(),
        },
      }),
    ]);

    invalidateEntitlementCache(sub.tenantId);
  }
}
```

> ⚠️ **NOTA IMPORTANTE**: Ao aplicar mudanças agendadas, o job CRIA UM NOVO PLANO EXCLUSIVO para o tenant ao invés de modificar o Plan original. Isso previne que mudanças agendadas de múltiplos tenants no mesmo plano se sobrescrevam. Planos criados dessa forma são marcados como `is_public: false` e vinculados ao tenant via `PlanTenantAssignment`.

````

#### 5.2 Job `billing-enforce` (roda a cada hora)

```typescript
// src/modules/billing/jobs/enforce-past-due.ts

export async function enforcePastDue() {
  const threshold = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // D-10

  const overdue = await prisma.subscription.findMany({
    where: {
      status: 'past_due',
      pastDueSince: { lte: threshold }
    },
    include: { plan: true }
  });

  const freePlan = await prisma.plan.findFirst({ where: { name: 'free' } });
  if (!freePlan) return;

  const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // D+30

  for (const sub of overdue) {
    const previousPlan = sub.plan;  // Guardar referência para SubscriptionHistory

    await prisma.$transaction([
      // Encerrar registro anterior no SubscriptionHistory
      prisma.subscriptionHistory.updateMany({
        where: {
          tenantId: sub.tenantId,
          endedAt: null
        },
        data: {
          endedAt: new Date()
        }
      }),
      // Criar novo registro para o Free
      prisma.subscriptionHistory.create({
        data: {
          tenantId: sub.tenantId,
          planId: freePlan.id,
          startedAt: new Date(),
          endedAt: null,
          status: 'downgraded'
        }
      }),
      // Atualizar subscription
      prisma.subscription.update({
        where: { id: sub.id },
        data: {
          planId: freePlan.id,
          status: 'downgraded',
          downgradedAt: new Date(),
          dataDeletionScheduledAt: deletionDate,
          pastDueSince: null
        }
      }),
      prisma.billingEvent.create({
        data: {
          tenantId: sub.tenantId,
          eventType: 'subscription.downgraded',
          occurredAt: new Date()
        }
      }),
      prisma.billingEvent.create({
        data: {
          tenantId: sub.tenantId,
          eventType: 'data_purge_scheduled',
          occurredAt: new Date()
        }
      })
    ]);

    invalidateEntitlementCache(sub.tenantId);
    // Enfileirar email de aviso ao org_admin via comms module
  }
}
````

#### 5.3 Job `billing-purge` (roda diariamente)

```typescript
// src/modules/billing/jobs/purge-tenant-data.ts

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000]; // backoff exponencial

export async function purgeTenantData() {
  const due = await prisma.subscription.findMany({
    where: {
      status: "downgraded",
      dataDeletionScheduledAt: { lte: new Date() },
    },
  });

  for (const sub of due) {
    let attempt = 0;
    let success = false;

    while (attempt < MAX_RETRIES && !success) {
      try {
        // Expurgar dados do tenant — ordem de deleção respeita FKs
        await prisma.$transaction([
          prisma.task.deleteMany({ where: { tenantId: sub.tenantId } }),
          prisma.epic.deleteMany({ where: { tenantId: sub.tenantId } }),
          prisma.project.deleteMany({ where: { tenantId: sub.tenantId } }),
          // ... outros modelos de tenant
          prisma.subscription.update({
            where: { id: sub.id },
            data: { status: "expired", dataDeletionScheduledAt: null },
          }),
          prisma.billingEvent.create({
            data: {
              tenantId: sub.tenantId,
              eventType: "data_purge_completed",
              occurredAt: new Date(),
            },
          }),
        ]);
        success = true;
      } catch (error) {
        attempt++;
        if (attempt === MAX_RETRIES) {
          // Após 3 tentativas, enfileirar em DLQ
          await prisma.purgeFailureQueue.create({
            data: {
              tenantId: sub.tenantId,
              subscriptionId: sub.id,
              error: error.message,
              attempts: MAX_RETRIES,
              createdAt: new Date(),
            },
          });
          await prisma.billingEvent.create({
            data: {
              tenantId: sub.tenantId,
              eventType: "data_purge_failed",
              rawPayload: { error: error.message, attempts: MAX_RETRIES },
              occurredAt: new Date(),
            },
          });
          // Alertar super_admin via Slack/email
          // TODO: integrar com módulo comms para enviar alerta
        } else {
          // Aguardar antes de tentar novamente
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_DELAYS[attempt - 1]),
          );
        }
      }
    }
  }
}
```

#### 5.4 Novo modelo `PurgeFailureQueue` no schema

```prisma
model PurgeFailureQueue {
  id             String   @id @default(uuid())
  tenantId       String
  subscriptionId String
  error          String
  attempts       Int
  createdAt      DateTime @default(now())
  resolvedAt     DateTime?

  @@index([tenantId])
  @@index([createdAt])
}
```

> Super_admin pode consultar essa tabela via admin da plataforma e resolver manualmente (investigar FK constraint, corrigir dados órfãos, re-executar purge).

#### 5.5 Integração no scheduler existente

Os jobs são registrados no scheduler interno (jobs table / worker loop que já existe na Fase 1):

```typescript
// src/lib/scheduler.ts — adicionar
schedule("billing-apply-pending", "0 */6 * * *", applyPendingChanges); // a cada 6h
schedule("billing-enforce", "0 * * * *", enforcePastDue); // a cada hora
schedule("billing-purge", "0 3 * * *", purgeTenantData); // 3h da manhã
```

**Arquivos criados/alterados:**

- `src/modules/billing/jobs/apply-pending-changes.ts` — novo
- `src/modules/billing/jobs/enforce-past-due.ts` — novo
- `src/modules/billing/jobs/purge-tenant-data.ts` — novo (com retry + DLQ)
- `prisma/schema.prisma` — adicionar `PurgeFailureQueue`
- `src/lib/scheduler.ts` — registrar 3 jobs

---

### Etapa 6 — Seed e documentação

**Objetivo:** Popular o banco com os planos base e atualizar documentação técnica.

#### 6.1 Seed de planos

```typescript
// prisma/seed-billing.ts (ou adicionar ao seed principal)

const PLANS = [
  {
    name: "free",
    displayName: "Free",
    priceCents: 0,
    billingPeriod: "monthly",
    modules: ["core", "integrations", "dora"],
    maxSeats: 2,
    maxIntegrations: 1,
    historyDays: 30,
    trialDays: 0,
    features: {
      alerts: false,
      api_webhooks: false,
      dora_full_scorecard: false,
    },
    isSystem: true,
    isPublic: true,
    isActive: true,
  },
  {
    name: "starter",
    displayName: "Starter",
    priceCents: 4900,
    billingPeriod: "monthly",
    stripePriceId: null, // preencher com price_xxx após criar no Stripe Dashboard
    modules: ["core", "integrations", "dora", "sla", "comms"],
    maxSeats: 5,
    maxIntegrations: 2,
    historyDays: 90,
    trialDays: 0,
    features: { alerts: true, api_webhooks: false, dora_full_scorecard: true },
    isSystem: true,
    isPublic: true,
    isActive: true,
  },
  {
    name: "pro",
    displayName: "Pro",
    priceCents: 14900,
    billingPeriod: "monthly",
    stripePriceId: null, // preencher com price_xxx após criar no Stripe Dashboard
    modules: ["core", "integrations", "dora", "sla", "cogs", "comms"],
    maxSeats: 15,
    maxIntegrations: null,
    historyDays: 365,
    trialDays: 14,
    features: { alerts: true, api_webhooks: true, dora_full_scorecard: true },
    isSystem: true,
    isPublic: true,
    isActive: true,
  },
  {
    name: "enterprise",
    displayName: "Enterprise",
    priceCents: 0,
    billingPeriod: "monthly",
    modules: ["core", "integrations", "dora", "sla", "cogs", "intel", "comms"],
    maxSeats: null,
    maxIntegrations: null,
    historyDays: null,
    trialDays: 0,
    features: { alerts: true, api_webhooks: true, dora_full_scorecard: true },
    isSystem: true,
    isPublic: false,
    isActive: true, // exclusivo por assignment
  },
];

for (const plan of PLANS) {
  await prisma.plan.upsert({
    where: { name: plan.name },
    update: plan,
    create: plan,
  });
}

// ⚠️ IMPORTANTE: Criar Subscriptions para tenants pré-existentes (se houver)
const freePlan = await prisma.plan.findFirst({ where: { name: "free" } });
if (freePlan) {
  // Buscar tenants sem subscription
  const tenantsWithoutSub = await prisma.$queryRaw`
    SELECT t.id as tenant_id
    FROM "Tenant" t
    LEFT JOIN "Subscription" s ON s."tenantId" = t.id
    WHERE s.id IS NULL
  `;

  const now = new Date();
  for (const tenant of tenantsWithoutSub) {
    const sub = await prisma.subscription.create({
      data: {
        tenantId: tenant.tenant_id,
        planId: freePlan.id,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
      },
    });

    await prisma.subscriptionHistory.create({
      data: {
        tenantId: tenant.tenant_id,
        planId: freePlan.id,
        startedAt: now,
        endedAt: null,
        status: "active",
      },
    });
  }

  console.log(
    `Created ${tenantsWithoutSub.length} subscriptions for pre-existing tenants`,
  );
}
```

> ⚠️ **IMPORTANTE**: O seed também cria Subscriptions para tenants pré-existentes (criados antes da migration de billing). Isso previne erro no entitlement cache para tenants antigos.

> **Enterprise com `priceCents: 0`** — preço real é negociado e configurado no Stripe diretamente. O campo `priceCents` neste plano é ignorado no fluxo de checkout (que usa o `price_id` do Stripe).

#### 6.2 Criar OpenAPI spec

Criar `docs/openapi/billing-v1.yaml` com todos os endpoints da seção 7, seguindo o padrão dos outros YAMLs do projeto.

#### 6.3 Atualizar `docs/architecture.md`

Adicionar:

- `Billing` à tabela de módulos com prefixo `/api/v1/billing/*` e `/api/v1/platform/billing/*`
- `platform_role` na descrição do `PlatformAccount`
- funções de entitlement (`requireModule`/`requireFeature` de `entitlement.ts`) como dependência interna dos módulos

---

### Resumo de dependências entre etapas

```
Etapa 1 (Schema + platform_role)
  └─▶ Etapa 2 (EntitlementService)
        └─▶ Etapa 3 (Guards nos módulos)  ← pode ser em paralelo com Etapa 4
        └─▶ Etapa 4 (Módulo Billing)
              └─▶ Etapa 5 (Jobs)
                    └─▶ Etapa 6 (Seed + Docs)
                          └─▶ Etapa 7 (Integração Stripe + sandbox)
```

✅ Todas as etapas concluídas (2026-04-20).

---

### Variáveis de ambiente necessárias

| Variável                | Obrigatória | Status em Sandbox | Descrição                                                                     |
| ----------------------- | ----------- | ----------------- | ----------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | ✅          | ✅ configurada    | Chave secreta da API Stripe (`sk_live_*` ou `sk_test_*`)                      |
| `STRIPE_WEBHOOK_SECRET` | ✅          | ✅ configurada    | Secret do endpoint webhook registrado no Stripe / gerado pelo `stripe listen` |

Adicionar ao `.env.example`, `fly.toml` (como secrets) e à documentação de deploy.

> **Sandbox (2026-04-20):** Stripe CLI v1.40.6 instalado (Manjaro/AUR), login feito, listener ativo. `stripe_price_id` configurado nos planos pagos via `PATCH /platform/billing/plans/:id`.

---

### Testes por etapa

| Etapa | O que testar                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Migration não-destrutiva; `platform_role` no JWT; Subscription + SubscriptionHistory criados no register                                   |
| 2     | Cache hit/miss do EntitlementService; guard 402 para módulo não habilitado; header `X-Billing-Warning`                                     |
| 3     | Rotas SLA/COGS/Intel retornam 402 sem módulo; retornam 200 com módulo; IAM bloqueia adição de user ao atingir max_seats                    |
| 4     | CRUD de planos (happy path + erros); validação de `core` obrigatório; checkout session criada; webhook idempotente; rate limit 100 req/min |
| 4     | PATCH com `apply_at_renewal: true` armazena em `pending_plan_changes`; não aplica imediatamente                                            |
| 5     | Job apply-pending: mudanças aplicadas em `current_period_end`; cache invalidado                                                            |
| 5     | Job enforce: subscription `past_due` vira `downgraded` após 10d; cache invalidado; SubscriptionHistory criado                              |
| 5     | Job purge: retry 3x com backoff; sucesso deleta dados e marca `expired`; falha enfileira em DLQ                                            |
| 6     | Seed idempotente (`upsert`); planos seed existem após migration                                                                            |
