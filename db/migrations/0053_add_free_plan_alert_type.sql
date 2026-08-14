-- Novo tipo de alerta pro caminho de atribuição direta de plano sem
-- cobrança (BillingService.assignFreePlan) — nível de tenant, mesmo
-- espírito dos demais alertas de billing: integration_id/team_id sempre NULL.
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
    'billing_plan_changed_to_free'
));
