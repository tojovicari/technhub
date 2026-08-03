-- Rastro de ações do gestor do SaaS (platform operator) — dado da
-- plataforma, não de tenant (sem RLS de propósito, mesmo padrão de
-- `plans`/`tenants`). Pré-requisito de segurança pra impersonation: toda
-- ação de escrita do painel cross-tenant e todo início/fim de sessão
-- impersonada fica registrado aqui.
CREATE TABLE platform_operator_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_external_user_id VARCHAR(50) NOT NULL,
    operator_email VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    target_tenant_id UUID REFERENCES tenants(id),
    target_user_id UUID REFERENCES users(id),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_operator_audit_log_target_tenant_id
    ON platform_operator_audit_log (target_tenant_id);

CREATE INDEX idx_platform_operator_audit_log_created_at
    ON platform_operator_audit_log (created_at DESC);
