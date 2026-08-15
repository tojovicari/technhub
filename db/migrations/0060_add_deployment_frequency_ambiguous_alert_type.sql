-- Novo tipo: time tem mais de um provider de CI/CD distinto gerando deploy
-- de produção (ex: github_actions + vercel) sem ter configurado
-- deploymentFrequency.sourceProviders — Deployment Frequency pode estar
-- contando o mesmo deploy duas vezes até isso ser resolvido.
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
    'integrations_limit_approaching',
    'deployment_frequency_source_ambiguous'
));
