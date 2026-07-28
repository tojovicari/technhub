-- Índice `providerSubscriptionId → tenant_id`, deliberadamente **sem RLS**.
--
-- Motivo: `subscriptions` tem FORCE ROW LEVEL SECURITY, então nenhuma
-- consulta funciona sem `app.tenant_id` já setado na sessão — mas a maioria
-- dos webhooks do Stripe (`invoice.paid`, `invoice.payment_failed`,
-- `customer.subscription.updated`, `customer.subscription.deleted`) só traz
-- o id da assinatura no Stripe, não o tenant. Só `checkout.session.completed`
-- carrega o tenant direto (via `metadata.tenantId`), porque é o único evento
-- que o próprio app dispara com esse metadado.
--
-- Esta tabela é só um índice, não guarda nenhum dado de negócio sensível —
-- resolve "de qual tenant é essa assinatura do Stripe" pra então abrir o
-- `withTenantContext` correto e seguir com RLS normalmente. Populada uma
-- única vez, no handler de `checkout.session.completed`.
CREATE TABLE stripe_subscription_index (
    provider_subscription_id VARCHAR(255) PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
