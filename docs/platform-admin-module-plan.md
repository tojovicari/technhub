# Platform Admin Module — Plano de Expansão (SaaS Management)

> **Status:** 📋 planejado — aguardando implementação  
> **Data do plano:** 2026-04-22  
> **Fase:** Gestão operacional do SaaS (post-billing-v1)

---

## 1. Contexto

O módulo admin existente é **plan-centric**: você gerencia o catálogo de planos, mas não enxerga seus clientes. Para operar um SaaS no dia a dia você precisa de visibilidade sobre tenants, controle manual de subscriptions e métricas de receita.

### O que existe hoje

| Endpoint                                                    | O que faz                                  |
| ----------------------------------------------------------- | ------------------------------------------ |
| `GET /platform/billing/plans`                               | Lista planos com contagem de subscriptions |
| `POST /platform/billing/plans`                              | Cria novo plano                            |
| `GET /platform/billing/plans/:id`                           | Detalhe de um plano                        |
| `PATCH /platform/billing/plans/:id`                         | Edita plano                                |
| `DELETE /platform/billing/plans/:id`                        | Remove plano                               |
| `POST /platform/billing/plans/:id/assignments`              | Vincula plano exclusivo a tenant           |
| `DELETE /platform/billing/plans/:id/assignments/:tenant_id` | Remove vinculação                          |

### Gap identificado

O admin é completamente plan-centric. Não existe:

- Listagem de tenants com status de subscription
- Detalhe de um tenant (quem são, quanto usam, qual plano)
- Force-assign de plano sem Stripe (para Enterprise / fatura manual)
- Ações manuais sobre subscriptions (extend grace, reativar, cancelar)
- Métricas de receita (MRR, churn, conversões)
- Listar tenants por plano (só vemos a contagem, não quem são)
- Impersonation para suporte técnico

---

## 2. Módulos planejados

### Módulo A — Gestão de Tenants

**Prioridade:** 🔴 Alta

Visibilidade sobre a base de clientes. Sem isso você não sabe quem são seus tenants nem o status de cada um.

**Novos endpoints:**

- `GET /platform/tenants` — lista todos os tenants com subscription + usage
- `GET /platform/tenants/:tenant_id` — detalhe completo: subscription, usuários, integraçoes, eventos recentes
- `GET /platform/tenants/:tenant_id/subscription-history` — histórico cronológico de planos
- `GET /platform/billing/plans/:plan_id/tenants` — quais tenants estão em um plano específico

**Docs:** [platform-admin-tenants-api.md](./frontend/platform-admin-tenants-api.md)

---

### Módulo B — Override de Subscriptions

**Prioridade:** 🔴 Alta

Capacidade de atribuir ou modificar subscriptions manualmente, sem fluxo Stripe. Essencial para clientes Enterprise que pagam por fora (wire transfer, nota fiscal).

**Novos endpoints:**

- `PUT /platform/tenants/:tenant_id/subscription` — force-assign de plano (sem Stripe, provider=null)
- `PATCH /platform/tenants/:tenant_id/subscription` — ações manuais: `extend_grace` / `reactivate` / `cancel`

**Permissão:** apenas `super_admin` (não `platform_admin`) — risco financeiro direto.

**Docs:** [platform-admin-subscriptions-api.md](./frontend/platform-admin-subscriptions-api.md)

---

### Módulo C — Métricas de Receita

**Prioridade:** 🔴 Alta (solicitado como prioridade)

Dashboard financeiro da plataforma: MRR, churn, conversões por período.

**Novos endpoints:**

- `GET /platform/billing/metrics` — MRR, ARR, breakdown por plano e status

**Docs:** [platform-admin-metrics-api.md](./frontend/platform-admin-metrics-api.md)

---

### Módulo D — Impersonation

**Prioridade:** 🟡 Média

Gerar token de curta duração para agir como `org_admin` de um tenant sem saber a senha. Útil para suporte técnico e debugging.

**Novos endpoints:**

- `POST /platform/tenants/:tenant_id/impersonate` — gera token de impersonação (TTL: 15min)

**Permissão:** apenas `super_admin`. Toda ação gera registro de auditoria.

**Docs:** [platform-admin-impersonation-api.md](./frontend/platform-admin-impersonation-api.md)

---

## 3. Sequência de implementação recomendada

```
Semana 1
├── Módulo A: GET /platform/tenants (listagem básica)
├── Módulo A: GET /platform/tenants/:id (detalhe)
└── Módulo A: GET /platform/billing/plans/:id/tenants

Semana 2
├── Módulo B: PUT /platform/tenants/:id/subscription (force-assign)
└── Módulo B: PATCH /platform/tenants/:id/subscription (extend_grace, reactivate, cancel)

Semana 3
├── Módulo C: GET /platform/billing/metrics (MRR/churn)
└── Módulo A: GET /platform/tenants/:id/subscription-history

Semana 4 (opcional)
└── Módulo D: POST /platform/tenants/:id/impersonate
```

---

## 4. Impacto no schema Prisma

Nenhuma migration necessária para os Módulos A, B e C — os dados já existem nas tabelas `Tenant`, `Subscription`, `SubscriptionHistory`, `PlatformAccount` e `IntegrationConnection`.

Para o **Módulo D (Impersonation)**, é necessário:

```prisma
model ImpersonationAudit {
  id               String    @id @default(uuid())
  initiatedBy      String    // platform account id (super_admin)
  tenantId         String
  impersonatedAs   String    // platform account id do org_admin usado como subject
  reason           String
  tokenIssuedAt    DateTime  @default(now())
  tokenExpiresAt   DateTime
  firstUsedAt      DateTime?
  createdAt        DateTime  @default(now())

  @@index([initiatedBy])
  @@index([tenantId])
  @@index([tokenIssuedAt])
}
```

---

## 5. Segurança

### Force-assign (Módulo B)

- Somente `super_admin` pode executar — `platform_admin` é bloqueado
- Todo force-assign cria entrada em `SubscriptionHistory` com `reason` obrigatório
- Campo `provider` fica `null` nas subscriptions manuais (sem Stripe)
- Cache de entitlement invalidado imediatamente após o write

### Impersonation (Módulo D)

- JWT de impersonação inclui `is_impersonation: true` e `impersonated_by: <account_id>`
- TTL máximo: 15 minutos (não renovável)
- Todo uso registrado em `ImpersonationAudit`
- Token não permite: alterar billing, criar outros tokens de impersonação, deletar tenant
- Rejeitar token de impersonação em endpoints `/platform/*` (evitar escalada de privilégios)

### Metrics (Módulo C)

- Dados apenas agregados, sem PII de tenants
- Sem cache de longo prazo — calculado em tempo real contra `Subscription`

---

## 6. Acceptance Criteria

### Módulo A — Tenants

- [ ] `GET /platform/tenants` retorna lista paginada com subscription + usage por tenant
- [ ] `GET /platform/tenants` filtra por `status`, `plan_id`, `search`
- [ ] `GET /platform/tenants/:id` retorna detalhe completo com contas e eventos recentes
- [ ] `GET /platform/tenants/:id/subscription-history` retorna histórico cronológico
- [ ] `GET /platform/billing/plans/:id/tenants` retorna tenants no plano

### Módulo B — Override

- [ ] `PUT /platform/tenants/:id/subscription` atribui plano sem Stripe
- [ ] Force-assign cria `SubscriptionHistory` com reason auditável
- [ ] `PATCH /platform/tenants/:id/subscription` executa `extend_grace` + `reactivate` + `cancel`
- [ ] Platform_admin recebe 403 em endpoints de write do Módulo B
- [ ] Cache de entitlement invalidado após toda mutação

### Módulo C — Metrics

- [ ] `GET /platform/billing/metrics` retorna MRR, ARR, breakdown por plano e status
- [ ] Parâmetro `period` suporta `last_30d`, `last_90d`, `last_12m`, `mtd`, `ytd`
- [ ] MRR é calculado a partir das subscriptions `active + trialing + past_due` com `price_cents`

### Módulo D — Impersonation

- [ ] `POST /platform/tenants/:id/impersonate` gera JWT com TTL 15min
- [ ] Token registrado em `ImpersonationAudit` (criado antes de emitir o token)
- [ ] Token rejeitado com 403 em qualquer `/platform/*`
- [ ] Somente `super_admin` pode impersonar — `platform_admin` recebe 403
- [ ] 404 quando tenant não existe; 409 quando não há `org_admin` ativo
- [ ] `firstUsedAt` atualizado na primeira validação do token (idempotente via `updateMany`)
- [ ] `GET /platform/tenants/:id/impersonation-audit` lista histórico paginado com dados do iniciador
- [ ] Rotas sensíveis (change-password, PATCH /iam/accounts) bloqueiam token de impersonação com 403

---

## 7. Riscos

| Risco                                                   | Mitigação                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Force-assign sem Stripe dessincroniza estado financeiro | Campo `provider` null sinaliza subscrição manual; dashboard distingue as duas                               |
| Impersonation expõe dados sensíveis do tenant           | TTL curto + audit log obrigatório + bloqueio em `/platform/*`                                               |
| Metrics MRR incorreto para planos anuais                | Normalizar priceCents para mensal: `Math.round(annual ÷ 12)` (arredondamento padrão JS)                     |
| Listagem de tenants lenta com muitos registros          | Índice em `Subscription.status` já existe; adicionar índice composto em `Tenant.createdAt` se > 10k tenants |
