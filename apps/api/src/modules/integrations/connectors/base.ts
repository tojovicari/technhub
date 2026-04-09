import type { IntegrationProvider, SyncMode } from '@prisma/client';

export type SyncInput = {
  tenantId: string;
  connectionId: string;
  mode: SyncMode;
};

export type SyncResult = {
  provider: IntegrationProvider;
  mode: SyncMode;
  synced_entities: number;
};

export interface IntegrationConnector {
  provider: IntegrationProvider;
  validateConfiguration(): Promise<void>;
  runSync(input: SyncInput): Promise<SyncResult>;
}
