-- Novo tipo: 'team_archived' (aviso de que um time foi arquivado e nenhum
-- snapshot foi salvo — ver teams.routes.ts).
--
-- Também corrige um bug pré-existente descoberto ao escrever o smoke test
-- desta feature: 'billing_trial_ending_soon' foi adicionado ao tipo
-- TypeScript `AlertType` (rodada de "trial sem cartão de crédito") mas
-- nunca foi incluído nesta CHECK constraint — o INSERT sempre falhava
-- silenciosamente (AlertRepository.create() só loga o erro, não lança),
-- então o alerta de "trial acabando" nunca era gravado em produção.
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
    'billing_trial_ending_soon',
    'data_retention_purge_approaching',
    'users_limit_approaching',
    'teams_limit_approaching',
    'integrations_limit_approaching',
    'deployment_frequency_source_ambiguous',
    'team_archived'
));
