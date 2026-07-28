-- Log de transições de estado da assinatura — modelado como evento
-- (effective_from), não como intervalo. O sistema de billing antigo nasceu
-- com um modelo de intervalo (started_at/ended_at) e corrigiu pra evento
-- horas depois; aqui já nasce no formato certo.
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id),

    status VARCHAR(20) NOT NULL,
    effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reason VARCHAR(100),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subscription_history_tenant_id ON subscription_history (tenant_id);
CREATE INDEX idx_subscription_history_subscription_id ON subscription_history (subscription_id);

ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON subscription_history
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
