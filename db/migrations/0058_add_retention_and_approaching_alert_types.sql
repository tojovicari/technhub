-- 4 tipos novos: aviso proativo de retenção de dados (dado cruzou o teto
-- do plano, ainda na carência antes do expurgo de verdade — ver
-- RetentionPurgeService) e avisos proativos de "chegando perto" dos 3
-- limites de recurso já existentes (hoje só alertam no momento do
-- bloqueio via evaluateResourceLimitAlert, nunca antes).
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
    'integrations_limit_reached',
    'billing_subscription_confirmed',
    'billing_subscription_cancelled',
    'billing_plan_changed_to_free',
    'data_retention_purge_approaching',
    'users_limit_approaching',
    'teams_limit_approaching',
    'integrations_limit_approaching'
));
