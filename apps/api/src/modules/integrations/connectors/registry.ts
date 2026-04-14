import type { IntegrationProvider } from '@prisma/client';
import type { IntegrationConnector } from './base.js';
import { GithubConnector } from './github.js';
import { IncidentIoConnector } from './incident_io.js';
import { JiraConnector } from './jira.js';
import { OpsGenieConnector } from './opsgenie.js';

/**
 * Central registry of all available integration connectors.
 * To add a new provider (e.g. Linear, Bitbucket):
 *   1. Create connectors/<provider>.ts implementing IntegrationConnector
 *   2. Add it here: ['linear', () => new LinearConnector()]
 *   3. Add the provider value to the IntegrationProvider enum in schema.prisma + migration
 */
const connectorFactories = new Map<IntegrationProvider, () => IntegrationConnector>([
  ['github', () => new GithubConnector()],
  ['incident_io', () => new IncidentIoConnector()],
  ['jira', () => new JiraConnector()],
  ['opsgenie', () => new OpsGenieConnector()],
]);

export function getConnector(provider: IntegrationProvider): IntegrationConnector {
  const factory = connectorFactories.get(provider);
  if (!factory) {
    throw new Error(`No connector registered for provider: ${provider}`);
  }
  return factory();
}

export function getSupportedProviders(): IntegrationProvider[] {
  return Array.from(connectorFactories.keys());
}

export function isValidProvider(provider: string): provider is IntegrationProvider {
  return connectorFactories.has(provider as IntegrationProvider);
}
