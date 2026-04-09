import type { IntegrationConnector, SyncInput, SyncResult } from './base.js';

export class JiraConnector implements IntegrationConnector {
  provider = 'jira' as const;

  async validateConfiguration(): Promise<void> {
    // Stub initial for Phase 1: implement provider auth validation in the next step.
    return;
  }

  async runSync(input: SyncInput): Promise<SyncResult> {
    return {
      provider: this.provider,
      mode: input.mode,
      synced_entities: input.mode === 'full' ? 120 : 24
    };
  }
}
