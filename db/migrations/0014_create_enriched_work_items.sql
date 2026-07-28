-- Enriched Layer para Work Items, conforme .spec/spec-engineering-intelligence.md,
-- Seção 5 (já com tenant_id denormalizado, corrigido numa rodada anterior).
-- id compartilha a PK de canonical_work_items — 1 canonical -> no máximo 1
-- enriched, atualizado in-place a cada reprocessamento.
CREATE TABLE enriched_work_items (
    id UUID PRIMARY KEY REFERENCES canonical_work_items(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

    semantic_category VARCHAR(50) NOT NULL, -- 'BUG', 'FEATURE', 'TECHNICAL_DEBT', 'TOIL', 'RISK'
    semantic_state VARCHAR(50) NOT NULL,    -- 'BACKLOG', 'IN_PROGRESS', 'WAITING_REVIEW', 'DONE'
    is_active_work BOOLEAN NOT NULL,

    started_working_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,

    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    applied_rule_version TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_enriched_work_items_tenant_id ON enriched_work_items (tenant_id);
CREATE INDEX idx_enriched_work_items_team_id ON enriched_work_items (team_id);

ALTER TABLE enriched_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE enriched_work_items FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON enriched_work_items
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
