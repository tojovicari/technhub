-- Associação e Alocação de Membros em Times, conforme
-- .spec/spec-engineering-intelligence.md, Seção 4.1 — com o mesmo fix de
-- isolamento multi-tenant aplicado em 0009 (tenant_id denormalizado de
-- teams.tenant_id, necessário pra policy de RLS sem JOIN).
CREATE TABLE team_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    role_in_team VARCHAR(50) DEFAULT 'DEVELOPER',

    -- Dedicação Individual e Sobrescrita
    capacity_allocation_percent NUMERIC(5,2) DEFAULT 100.00,
    custom_monthly_capacity_hours NUMERIC(6,2) NULL,

    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_user_team UNIQUE (user_id, team_id)
);

CREATE INDEX idx_team_memberships_tenant_id ON team_memberships (tenant_id);

ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON team_memberships
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
