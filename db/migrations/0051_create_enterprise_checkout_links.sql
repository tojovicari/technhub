-- Rastreamento de links de checkout gerados pelo gestor do SaaS pra planos
-- enterprise/privados — o operador gera um link (Stripe Checkout Session
-- normal, mesmo mecanismo do upgrade self-service em
-- BillingService.createCheckoutSession) e manda pro contato da conta, sem
-- fluxo nenhum fora do Stripe. Esta tabela é só o rastreamento de
-- "gerado → pago/expirado" pra medir conversão, não uma fonte de verdade
-- de billing (essa continua sendo `subscriptions`).
CREATE TABLE enterprise_checkout_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),
    contact_email VARCHAR(255) NOT NULL,

    -- Chave que os webhooks (checkout.session.completed/expired) usam pra
    -- achar esta linha de volta — já é única no próprio Stripe.
    stripe_checkout_session_id VARCHAR(255) NOT NULL UNIQUE,
    checkout_url TEXT NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),

    created_by_operator_email VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_enterprise_checkout_links_tenant_created ON enterprise_checkout_links (tenant_id, created_at DESC);

ALTER TABLE enterprise_checkout_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_checkout_links FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON enterprise_checkout_links
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
