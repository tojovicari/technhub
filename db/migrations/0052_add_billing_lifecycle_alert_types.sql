-- Dois novos tipos de alerta, completando o ciclo de vida de billing que
-- hoje só cobre billing_past_due/billing_subscription_expired: confirmação
-- de assinatura (checkout concluído, self-service ou link enterprise) e
-- cancelamento (pelo próprio ADMIN via app ou "de surpresa" via Portal do
-- Stripe). Nível de tenant, mesmo espírito de billing_past_due —
-- integration_id/team_id sempre NULL.
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
    'billing_subscription_cancelled'
));
