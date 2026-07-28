-- Assinatura de um tenant — 1:1 (unique em tenant_id), diferente do
-- sistema de billing antigo que não tinha FK real pra tenant nem RLS aqui.
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id),
    plan_id UUID NOT NULL REFERENCES plans(id),

    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    past_due_since TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,

    provider VARCHAR(20),                 -- 'stripe' | NULL (plano gratuito/gerenciado manualmente)
    provider_customer_id VARCHAR(255),
    provider_subscription_id VARCHAR(255),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions (tenant_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON subscriptions
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
