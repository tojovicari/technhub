-- Enriched Layer para Incidentes (Seção 5 da spec) — mesmo padrão de
-- enriched_work_items/enriched_deployments, exceto team_id: fica nullable
-- porque o Waroom não segue o modelo "1 integração = 1 time" (decisão de
-- uma rodada anterior, ver src/enrichment/enrichment.service.ts). Sem
-- time resolvido, a precedência de regras cai pra organização/fallback.
CREATE TABLE enriched_incidents (
    id UUID PRIMARY KEY REFERENCES canonical_incidents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,

    failure_classification VARCHAR(20) NOT NULL, -- 'COUNTS_AS_FAILURE', 'INFORMATIONAL'

    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    applied_rule_version TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_enriched_incidents_tenant_id ON enriched_incidents (tenant_id);
CREATE INDEX idx_enriched_incidents_team_id ON enriched_incidents (team_id);

ALTER TABLE enriched_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE enriched_incidents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON enriched_incidents
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
