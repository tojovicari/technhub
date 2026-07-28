-- Camada Canônica: Incidentes (Waroom, PagerDuty), conforme
-- .spec/spec-engineering-intelligence.md, Seção 5. Primeiro conector desta
-- categoria — já nasce com tenant_id/RLS desde o início (lição das rodadas
-- anteriores com canonical_pull_requests/user_provider_aliases), sem
-- precisar de uma segunda migration de correção depois.
CREATE TABLE canonical_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    provider VARCHAR(50) NOT NULL,        -- 'waroom', 'pagerduty'
    external_id VARCHAR(255) NOT NULL,    -- ex: 'INC-2026-0042'
    title TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL,        -- 'SEV1'..'SEV4', 'UNKNOWN'
    status VARCHAR(20) NOT NULL,          -- 'TRIGGERED', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'CANCELED'

    service_name VARCHAR(255),
    assignee_external_id VARCHAR(255),

    triggered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,

    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_tenant_provider_incident UNIQUE (tenant_id, provider, external_id)
);

CREATE INDEX idx_canonical_incidents_tenant_id ON canonical_incidents (tenant_id);
CREATE INDEX idx_canonical_incidents_triggered_at ON canonical_incidents (triggered_at);

ALTER TABLE canonical_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_incidents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON canonical_incidents
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
