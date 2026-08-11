export type AlertType =
  | 'sync_stale'
  | 'sync_run_finished'
  | 'integration_reconnect_required'
  | 'billing_past_due'
  | 'billing_subscription_expired'
  | 'onboarding_incomplete'
  | 'team_without_contributors'
  | 'users_limit_reached'
  | 'teams_limit_reached'
  | 'integrations_limit_reached'
  | 'billing_subscription_confirmed'
  | 'billing_subscription_cancelled';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly type: AlertType;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly message: string;
  readonly integrationId: string | null;
  readonly teamId: string | null;
  readonly metadata: unknown;
  readonly readAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateAlertInput {
  readonly type: AlertType;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly message: string;
  readonly integrationId?: string | null;
  readonly teamId?: string | null;
  readonly metadata?: unknown;
}
