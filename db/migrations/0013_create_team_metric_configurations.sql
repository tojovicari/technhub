-- Domain Context Engine (.spec/spec-engineering-intelligence.md, Seção 3):
-- regras semânticas configuráveis por time, com precedência
-- Time > Organização (team_id NULL) > Fallback do Sistema (hardcoded em
-- src/enrichment/system-default-rules.ts, não guardado no banco).
CREATE TABLE team_metric_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID REFERENCES teams(id), -- NULL = configuração de organização (fallback do tenant inteiro)
    rules JSONB NOT NULL,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_team_config UNIQUE (tenant_id, team_id)
);

-- A constraint acima não impede múltiplas linhas com team_id IS NULL pro
-- mesmo tenant (Postgres trata NULL como distinto em unique constraints) —
-- por isso o índice parcial garante no máximo uma configuração de
-- organização por tenant.
CREATE UNIQUE INDEX unique_tenant_org_config ON team_metric_configurations (tenant_id) WHERE team_id IS NULL;

CREATE INDEX idx_team_metric_configurations_tenant_id ON team_metric_configurations (tenant_id);

ALTER TABLE team_metric_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_metric_configurations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON team_metric_configurations
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
