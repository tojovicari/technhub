import { prisma } from '../../../lib/prisma.js';
import type { IntegrationConnector, SyncInput, SyncResult, WebhookConfig } from './base.js';
import {
  resolveFieldMapping,
  mapSeverityToPriority,
  isProductionIncident,
  extractAffectedServices,
  type FieldMapping,
} from './field-mapping.js';

// ── Types ──────────────────────────────────────────────────────────────────────

type OpsGenieCredentials = {
  auth_type: 'api_key';
  api_key: string;
  /** Defaults to 'us'; EU customers use 'eu'. */
  region?: 'us' | 'eu';
};

type OpsGenieScope = {
  /**
   * true  → use Incident API (requires OpsGenie Standard or Enterprise plan)
   * false → use Alert API (works on Essentials, lower fidelity for MTTR)
   */
  use_incident_api: boolean;
  field_mapping: FieldMapping;
};

// ── HTTP client ────────────────────────────────────────────────────────────────

class OpsGenieClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(creds: OpsGenieCredentials) {
    const region = creds.region ?? 'us';
    this.baseUrl = process.env['OPSGENIE_API_URL']
      ?? (region === 'eu' ? 'https://api.eu.opsgenie.com' : 'https://api.opsgenie.com');
    this.authHeader = `GenieKey ${creds.api_key}`;
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`OpsGenie API error ${res.status} on GET ${path}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Offset-based list pagination for OpsGenie (used by Alert API).
   * Wraps around the `data` array + `paging.next` link in the response.
   */
  async paginateAlerts<T>(
    path: string,
    params?: Record<string, string | number>,
  ): Promise<T[]> {
    const results: T[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const queryParams = { ...params, limit, offset };
      const page = await this.get<{ data: T[]; paging?: { next?: string } }>(path, queryParams);
      const items = page.data ?? [];
      results.push(...items);
      if (!page.paging?.next || items.length < limit) break;
      offset += items.length;
    }

    return results;
  }

  /**
   * Offset-based list pagination for the OpsGenie Incident API.
   * Response shape uses `data` array + `paging.next`.
   */
  async paginateIncidents<T>(
    path: string,
    params?: Record<string, string | number>,
  ): Promise<T[]> {
    return this.paginateAlerts<T>(path, params);
  }
}

// ── Provider payload shapes (partial — only fields we consume) ─────────────────

/** OpsGenie Incident API payload (Standard/Enterprise plans). */
type OpsGenieIncident = {
  id: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'closed';
  priority: string; // "P1" .. "P5" — already canonical in OpsGenie
  impactStartDate?: string;
  createdAt: string;
  responders?: Array<{ id: string; type: string }>;
  impactedServices?: string[];
  tags?: string[];
  [key: string]: unknown;
};

/** OpsGenie Alert API payload (Essentials plan fallback). */
type OpsGenieAlert = {
  id: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'closed';
  priority: string; // "P1" .. "P5"
  createdAt: string;
  updatedAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  responders?: Array<{ id: string; type: string }>;
  tags?: string[];
  [key: string]: unknown;
};

// ── Status normalisation ───────────────────────────────────────────────────────

function resolveAlertStatus(
  raw: string,
): 'open' | 'acknowledged' | 'resolved' | 'closed' {
  switch (raw) {
    case 'open': return 'open';
    case 'acknowledged': return 'acknowledged';
    case 'resolved': return 'resolved';
    case 'closed': return 'closed';
    default: return 'open';
  }
}

// ── Sync — Incident API ────────────────────────────────────────────────────────

async function syncViaIncidentApi(
  client: OpsGenieClient,
  tenantId: string,
  connectionId: string,
  mapping: ReturnType<typeof resolveFieldMapping>,
  sinceDate?: Date,
): Promise<number> {
  const params: Record<string, string | number> = { sort: 'createdAt', order: 'desc' };
  if (sinceDate) params['query'] = `createdAt > ${sinceDate.getTime()}`;

  const incidents = await client.paginateIncidents<OpsGenieIncident>('/v1/incidents', params);
  let count = 0;

  for (const incident of incidents) {
    const rawPriority = incident.priority; // already "P1"–"P5" in OpsGenie
    // Still apply mapping if tenant wants to remap OpsGenie P-levels to our canonical scale.
    const priority = mapSeverityToPriority(rawPriority, mapping) ?? rawPriority;
    const tags = incident.tags ?? [];

    if (!isProductionIncident(tags, mapping)) continue;

    const openedAt = new Date(incident.impactStartDate ?? incident.createdAt);
    const status = resolveAlertStatus(incident.status);
    const acknowledgedAt = status === 'acknowledged' || status === 'resolved' || status === 'closed'
      ? undefined  // OpsGenie Incident API does not expose acknowledgedAt directly
      : undefined;
    const closedAt = status === 'closed' ? new Date() : null; // OpsGenie doesn't expose closedAt
    const resolvedAt = status === 'resolved' || status === 'closed' ? new Date() : null; // same

    const responderIds = (incident.responders ?? []).map((r) => r.id).filter((id): id is string => id !== undefined && id !== null);
    const affectedServices = extractAffectedServices(incident as unknown as Record<string, unknown>, mapping);

    await prisma.incidentEvent.upsert({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: 'opsgenie',
          externalId: incident.id,
        },
      },
      create: {
        tenantId,
        connectionId,
        provider: 'opsgenie',
        externalId: incident.id,
        openedAt,
        acknowledgedAt: acknowledgedAt ?? null,
        resolvedAt,
        closedAt,
        priority,
        severity: rawPriority,
        status,
        title: incident.message,
        affectedServices,
        responderIds,
        tags,
        rawPayload: incident as object,
        syncedAt: new Date(),
      },
      update: {
        acknowledgedAt: acknowledgedAt ?? null,
        resolvedAt,
        closedAt,
        priority,
        severity: rawPriority,
        status,
        title: incident.message,
        affectedServices,
        responderIds,
        tags,
        rawPayload: incident as object,
        syncedAt: new Date(),
      },
    });

    count++;
  }

  return count;
}

// ── Sync — Alert API (Essentials plan fallback) ────────────────────────────────

async function syncViaAlertApi(
  client: OpsGenieClient,
  tenantId: string,
  connectionId: string,
  mapping: ReturnType<typeof resolveFieldMapping>,
  sinceDate?: Date,
): Promise<number> {
  const params: Record<string, string | number> = { sort: 'createdAt', order: 'desc' };
  if (sinceDate) params['query'] = `createdAt > ${sinceDate.getTime()}`;

  const alerts = await client.paginateAlerts<OpsGenieAlert>('/v2/alerts', params);
  let count = 0;

  for (const alert of alerts) {
    const rawPriority = alert.priority;
    const priority = mapSeverityToPriority(rawPriority, mapping) ?? rawPriority;
    const tags = alert.tags ?? [];

    if (!isProductionIncident(tags, mapping)) continue;

    const openedAt = new Date(alert.createdAt);
    const acknowledgedAt = alert.acknowledgedAt ? new Date(alert.acknowledgedAt) : null;
    const resolvedAt = alert.resolvedAt ? new Date(alert.resolvedAt) : null;
    const status = resolveAlertStatus(alert.status);

    const responderIds = (alert.responders ?? []).map((r) => r.id).filter((id): id is string => id !== undefined && id !== null);
    const affectedServices = extractAffectedServices(alert as unknown as Record<string, unknown>, mapping);

    await prisma.incidentEvent.upsert({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: 'opsgenie',
          externalId: alert.id,
        },
      },
      create: {
        tenantId,
        connectionId,
        provider: 'opsgenie',
        externalId: alert.id,
        openedAt,
        acknowledgedAt,
        resolvedAt,
        closedAt: null,
        priority,
        severity: rawPriority,
        status,
        title: alert.message,
        affectedServices,
        responderIds,
        tags,
        rawPayload: alert as object,
        syncedAt: new Date(),
      },
      update: {
        acknowledgedAt,
        resolvedAt,
        priority,
        severity: rawPriority,
        status,
        title: alert.message,
        affectedServices,
        responderIds,
        tags,
        rawPayload: alert as object,
        syncedAt: new Date(),
      },
    });

    count++;
  }

  return count;
}

// ── Connector ─────────────────────────────────────────────────────────────────

export class OpsGenieConnector implements IntegrationConnector {
  readonly provider = 'opsgenie' as const;

  readonly webhookConfig: WebhookConfig = {
    eventIdHeader: 'x-og-delivery-id',
    eventTypeHeader: 'x-og-event-type',
    tokenEnvVar: 'OPSGENIE_WEBHOOK_TOKEN',
    devToken: 'dev-opsgenie-token',
  };

  async validateConfiguration(input?: { credentials?: Record<string, unknown> }): Promise<void> {
    if (!input?.credentials) {
      throw new Error('Missing credentials for OpsGenie connector validation');
    }
    const creds = input.credentials as OpsGenieCredentials;
    if (!creds.api_key) throw new Error('OpsGenie credentials must include api_key');

    const client = new OpsGenieClient(creds);
    // Lightweight probe — list 1 alert to confirm key validity
    await client.get('/v2/alerts', { limit: 1 });
  }

  async runSync(input: SyncInput): Promise<SyncResult> {
    const creds = (input.credentials ?? {}) as OpsGenieCredentials;
    const scope = (input.scope ?? {}) as OpsGenieScope;

    if (!creds.api_key) {
      throw new Error('OpsGenie sync requires credentials.api_key');
    }

    const mapping = resolveFieldMapping(scope as unknown as Record<string, unknown>);
    const client = new OpsGenieClient(creds);

    const useIncidentApi = scope.use_incident_api ?? false;
    const synced = useIncidentApi
      ? await syncViaIncidentApi(client, input.tenantId, input.connectionId, mapping, input.sinceDate)
      : await syncViaAlertApi(client, input.tenantId, input.connectionId, mapping, input.sinceDate);

    return {
      provider: 'opsgenie',
      mode: input.mode,
      synced_entities: synced,
      summary: { incidents: synced },
    };
  }
}
