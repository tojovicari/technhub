-- Dois novos tipos de alerta de onboarding, além dos 5 já existentes
-- (db/migrations/0046_create_alerts.sql):
--
--   - onboarding_incomplete: tenant sem nenhum time criado e sem nenhum
--     usuário materializado além do ADMIN que criou a conta (ver
--     `isBootstrap` em users.routes.ts) — nível de tenant, `integration_id`
--     e `team_id` ficam NULL.
--   - team_without_contributors: um time específico existe mas não tem
--     nenhuma linha em `team_memberships` — precisa de `team_id` pra saber
--     QUAL time, daí a coluna nova (`integration_id` já cumpria esse papel
--     pros alertas de sync, mas não serve pra apontar um time).
--
-- `team_id`, assim como `integration_id`, é usado tanto pra dedup (índice
-- abaixo) quanto pro front linkar direto pro time em questão.
ALTER TABLE alerts
    ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE alerts DROP CONSTRAINT alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN (
    'sync_stale',
    'sync_run_finished',
    'integration_reconnect_required',
    'billing_past_due',
    'billing_subscription_expired',
    'onboarding_incomplete',
    'team_without_contributors'
));

-- Substitui o índice de dedup de 0046 (só considerava integration_id) por
-- um que também considera team_id — sem isso, todo alerta
-- team_without_contributors de qualquer time do tenant colidiria na mesma
-- chave de dedup (integration_id sempre NULL pra esse tipo).
DROP INDEX idx_alerts_tenant_open_by_type_integration;
CREATE INDEX idx_alerts_tenant_open_by_type_subject
    ON alerts (tenant_id, type, integration_id, team_id) WHERE resolved_at IS NULL;
