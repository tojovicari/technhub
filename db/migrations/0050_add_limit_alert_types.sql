-- Três novos tipos de alerta, além dos 7 já existentes
-- (0046_create_alerts.sql, 0048_add_onboarding_alerts.sql): disparam
-- quando um tenant atinge o teto de recursos do plano
-- (0049_add_resource_limits_to_plans.sql). Nível de tenant, mesmo espírito
-- de `onboarding_incomplete` — `integration_id`/`team_id` sempre NULL; o
-- `type` já distingue qual recurso (usuários/times/integrações), em vez
-- de um tipo genérico com discriminador em `metadata`.
ALTER TABLE alerts DROP CONSTRAINT alerts_type_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_type_check CHECK (type IN (
    'sync_stale',
    'sync_run_finished',
    'integration_reconnect_required',
    'billing_past_due',
    'billing_subscription_expired',
    'onboarding_incomplete',
    'team_without_contributors',
    'users_limit_reached',
    'teams_limit_reached',
    'integrations_limit_reached'
));
