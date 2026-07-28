-- Log de eventos de billing — dobra como registro de auditoria e como
-- chave de idempotência de webhook do Stripe (provider_event_id único).
-- Stripe continua sendo a fonte da verdade pra fatura/forma de pagamento —
-- aqui só registramos que o evento aconteceu, não o objeto inteiro (exceto
-- em raw_payload, guardado quando útil pro handler específico).
CREATE TABLE billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    event_type VARCHAR(100) NOT NULL,
    provider VARCHAR(20),                       -- 'stripe' | NULL (evento originado internamente)
    provider_event_id VARCHAR(255) UNIQUE,       -- Stripe event.id — chave de idempotência
    raw_payload JSONB,

    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_billing_events_tenant_id ON billing_events (tenant_id);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON billing_events
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
