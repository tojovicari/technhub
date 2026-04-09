import type { IntegrationProvider, SyncMode } from '@prisma/client';

export type SyncInput = {
  tenantId: string;
  connectionId: string;
  mode: SyncMode;
  /** Decoded credentials from IntegrationSecret (provider-specific shape) */
  credentials?: Record<string, unknown>;
  /** Connection scope config (e.g. { org: "my-org" } for GitHub) */
  scope?: Record<string, unknown>;
  /** Populated for incremental syncs — only fetch items updated after this date */
  sinceDate?: Date;
};

export type SyncResult = {
  provider: IntegrationProvider;
  mode: SyncMode;
  synced_entities: number;
};

export type WebhookConfig = {
  /** Header that carries the unique delivery/event ID from the provider */
  eventIdHeader: string;
  /** Header that carries the event type (e.g. "push", "issues") */
  eventTypeHeader: string;
  /** Environment variable name that holds the expected webhook token */
  tokenEnvVar: string;
  /** Fallback token used in non-production when env var is absent */
  devToken: string;
};

export interface IntegrationConnector {
  provider: IntegrationProvider;
  webhookConfig: WebhookConfig;
  validateConfiguration(): Promise<void>;
  runSync(input: SyncInput): Promise<SyncResult>;
}
