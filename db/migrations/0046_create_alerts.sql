-- Alertas in-app (não confundir com src/notifications/ — aquele é e-mail
-- transacional outbound, hoje só convite; "alerta" aqui é o item de
-- notificação DENTRO do produto, lido pela UI de sino). Uma linha por
-- evento disparado: sync desatualizado, fim de execução de sync, integração
-- pedindo reconexão, ou problema de billing.
--
-- `read_at`: estado lido/não-lido é por TENANT, não por usuário — todo
-- ADMIN/GESTOR do tenant vê e "lê" a mesma lista (sem granularidade por
-- pessoa nesta primeira versão).
--
-- `resolved_at`: alguns tipos de alerta são efêmeros por natureza — fecham
-- sozinhos quando a causa desaparece (sync volta a rodar, integração volta
-- a ter sucesso, cobrança é regularizada). NULL = alerta aberto; preenchido
-- = já resolvido automaticamente. Nunca é apagado (mantém histórico).
--
-- `type`/`severity` só são escritos por pontos de código internos, nunca
-- por input de usuário — por isso, diferente de `subscriptions.status`
-- (VARCHAR sem CHECK), aqui seguimos o precedente mais recente de
-- `integration_run_history.run_type`/`triggered_by` (0039): enum pequeno e
-- fechado, reforçado com CHECK.
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    type VARCHAR(50) NOT NULL CHECK (type IN (
        'sync_stale',
        'sync_run_finished',
        'integration_reconnect_required',
        'billing_past_due',
        'billing_subscription_expired'
    )),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,

    -- NULL para alertas não ligados a uma integração específica (billing).
    -- ON DELETE CASCADE de propósito, mesmo espírito de
    -- integration_run_history (0039): isto é notificação operacional, não
    -- dado de negócio.
    integration_id UUID REFERENCES provider_integrations(id) ON DELETE CASCADE,

    metadata JSONB,

    read_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Lista da UI de sino: mais recentes primeiro, com filtro opcional de não-lidos.
CREATE INDEX idx_alerts_tenant_created ON alerts (tenant_id, created_at DESC);
CREATE INDEX idx_alerts_tenant_unread ON alerts (tenant_id, created_at DESC) WHERE read_at IS NULL;

-- Dedup/resolve: "já existe um alerta ABERTO deste tipo pra esta integração?"
CREATE INDEX idx_alerts_tenant_open_by_type_integration
    ON alerts (tenant_id, type, integration_id) WHERE resolved_at IS NULL;

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON alerts
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
