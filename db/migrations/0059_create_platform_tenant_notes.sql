-- Notas internas de atendimento, por tenant — dado da plataforma (operador),
-- não do tenant, mesmo padrão sem RLS de `platform_operator_audit_log`. Sem
-- `updated_at`/edição de propósito: nota errada se apaga e recria, não edita
-- (mesmo espírito de log, não reescrever histórico).
CREATE TABLE platform_tenant_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    operator_external_user_id VARCHAR(50) NOT NULL,
    operator_email VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_tenant_notes_tenant_id ON platform_tenant_notes (tenant_id);
