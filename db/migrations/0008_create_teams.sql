-- Tabela de Times, conforme .spec/spec-engineering-intelligence.md, Seção 4.1.
-- Tenant-scoped: RLS habilitada e forçada, mesmo padrão da Seção 4.3.
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,

    -- Configuração de Capacidade do Time (Base Configurável por Time em Horas)
    default_monthly_capacity_hours NUMERIC(6,2) NOT NULL DEFAULT 160.00, -- ex: 168.00, 160.00, 140.00
    planning_cycle VARCHAR(50) NOT NULL DEFAULT 'MONTHLY',              -- 'MONTHLY', 'WEEKLY', 'BIWEEKLY_SPRINT'
    working_days_per_week INT NOT NULL DEFAULT 5,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_teams_tenant_id ON teams (tenant_id);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON teams
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
