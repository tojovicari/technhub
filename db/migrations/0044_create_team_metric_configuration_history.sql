-- Auditoria de "quem mudou a configuração de métrica, e quando" — cobre as
-- duas colunas de team_metric_configurations (rules = regras de
-- classificação, Seção 3; metric_triggers = gatilhos de DORA, Seção 6),
-- discriminadas por config_type. Snapshot completo depois da mudança, não
-- diff — mesmo espírito de integration_run_history/subscription_history,
-- mais simples que reconstruir um diff campo a campo de JSONB.
--
-- FK de changed_by_user_id SEM "ON DELETE" (= RESTRICT): diferente de
-- integration_run_history (log operacional, CASCADE de propósito), isto é
-- uma trilha de auditoria de verdade — não faz sentido permitir que o
-- histórico de "quem mudou o quê" desapareça junto com o usuário.
CREATE TABLE team_metric_configuration_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    team_id UUID REFERENCES teams(id), -- NULL = mudança na configuração de organização
    config_type VARCHAR(20) NOT NULL CHECK (config_type IN ('mapping_rules', 'metric_triggers')),
    snapshot JSONB NOT NULL,
    changed_by_user_id UUID NOT NULL REFERENCES users(id),
    changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_team_metric_configuration_history_lookup
    ON team_metric_configuration_history (tenant_id, team_id, changed_at DESC);

ALTER TABLE team_metric_configuration_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_metric_configuration_history FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON team_metric_configuration_history
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
