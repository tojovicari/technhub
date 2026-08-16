-- Eventos manuais (desligamento, troca de versão, reorg, etc.) marcados pelo
-- usuário numa data, pro front sobrepor como marcador visual em qualquer
-- gráfico temporal (DORA history, team profile history...) — sem correlação
-- automática com métrica nenhuma, decisão deliberada (ver docs/BACKLOG.md).
-- team_id NULL = evento de organização, aparece em qualquer visão (mesma
-- convenção de team_metric_configuration_history.team_id). Sem updated_at/
-- edição de propósito: evento errado se apaga e recria, não edita (mesmo
-- espírito de platform_tenant_notes).
CREATE TABLE timeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID REFERENCES teams(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    event_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_timeline_events_lookup ON timeline_events (tenant_id, team_id, event_date);

ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON timeline_events
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
