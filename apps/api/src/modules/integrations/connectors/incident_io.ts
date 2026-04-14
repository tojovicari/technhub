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

type IncidentIoCredentials = {
  auth_type: 'bearer';
  api_key: string;
};

type IncidentIoScope = {
  field_mapping: FieldMapping;
};

// ── HTTP client ────────────────────────────────────────────────────────────────

class IncidentIoClient {
  private readonly baseUrl = 'https://api.incident.io';
  private readonly authHeader: string;

  constructor(creds: IncidentIoCredentials) {
    this.authHeader = `Bearer ${creds.api_key}`;
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
      throw new Error(`incident.io API error ${res.status} on GET ${path}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Cursor-based pagination for incident.io list endpoints.
   * Returns all items across pages, calling itemsKey to extract the array.
   */
  async paginate<T>(
    path: string,
    itemsKey: string,
    params?: Record<string, string | number>,
  ): Promise<T[]> {
    const results: T[] = [];
    let after: string | undefined;
    const pageSize = 50; // incident.io max page_size is 250, keep conservative

    while (true) {
      const queryParams: Record<string, string | number> = { ...params, page_size: pageSize };
      if (after) queryParams['after'] = after;

      const page = await this.get<Record<string, unknown>>(path, queryParams);
      const items = (page[itemsKey] as T[]) ?? [];
      results.push(...items);

      const pagination = page['pagination_meta'] as Record<string, unknown> | undefined;
      const nextAfter = pagination?.['after'];
      if (typeof nextAfter === 'string' && nextAfter && items.length > 0) {
        after = nextAfter;
      } else {
        break;
      }
    }

    return results;
  }
}

// ── Provider payload shapes (partial — only fields we consume) ─────────────────

type IncidentIoStatus = 'triage' | 'investigating' | 'fixing' | 'monitoring' | 'resolved' | 'declined';

type IncidentIoIncident = {
  id: string;
  name: string;
  status: { category: IncidentIoStatus; name: string };
  severity?: { name: string };
  created_at: string;             // ISO 8601
  acknowledged_at?: string;
  resolved_at?: string;
  custom_fields?: Array<{ id: string; value: unknown }>;
  incident_role_assignments?: Array<{ user?: { id: string }; role: { name: string } }>;
  incident_updates?: Array<{ created_at: string; new_status?: { category: string } }>;
  external_issue_reference?: Record<string, unknown>;
  [key: string]: unknown;
};

// ── Status normalisation ───────────────────────────────────────────────────────

function resolveIncidentStatus(
  category: IncidentIoStatus,
): 'open' | 'acknowledged' | 'resolved' | 'closed' {
  switch (category) {
    case 'triage':
    case 'investigating':
      return 'open';
    case 'fixing':
    case 'monitoring':
      return 'acknowledged';
    case 'resolved':
      return 'resolved';
    case 'declined':
      return 'closed';
    default:
      return 'open';
  }
}

// ── Sync helpers ───────────────────────────────────────────────────────────────

async function upsertIncidentEvents(
  tenantId: string,
  connectionId: string,
  incidents: IncidentIoIncident[],
  mapping: ReturnType<typeof resolveFieldMapping>,
): Promise<number> {
  let count = 0;

  for (const incident of incidents) {
    const rawSeverity = incident.severity?.name;
    const priority = rawSeverity ? mapSeverityToPriority(rawSeverity, mapping) : null;

    // Extract tags from custom_fields when production_indicator is tag-based
    const tags: string[] = [];
    if (Array.isArray(incident.custom_fields)) {
      for (const cf of incident.custom_fields) {
        if (typeof cf.value === 'string') tags.push(cf.value);
      }
    }

    if (!isProductionIncident(tags, mapping)) continue;

    const openedAt = new Date(
      (incident[mapping.opened_at_field] as string | undefined) ?? incident.created_at,
    );
    const acknowledgedAt = incident.acknowledged_at ? new Date(incident.acknowledged_at) : null;
    const resolvedAt = incident.resolved_at ? new Date(incident.resolved_at) : null;
    const statusCategory = incident.status?.category ?? 'triage';
    const status = resolveIncidentStatus(statusCategory as IncidentIoStatus);

    const responderIds = (incident.incident_role_assignments ?? [])
      .flatMap((a) => (a.user?.id ? [a.user.id] : []));

    const affectedServices = extractAffectedServices(incident as unknown as Record<string, unknown>, mapping);

    await prisma.incidentEvent.upsert({
      where: {
        tenantId_provider_externalId: {
          tenantId,
          provider: 'incident_io',
          externalId: incident.id,
        },
      },
      create: {
        tenantId,
        connectionId,
        provider: 'incident_io',
        externalId: incident.id,
        openedAt,
        acknowledgedAt,
        resolvedAt,
        priority,
        severity: rawSeverity ?? null,
        status,
        title: incident.name,
        affectedServices,
        responderIds,
        tags,
        rawPayload: incident as object,
        syncedAt: new Date(),
      },
      update: {
        acknowledgedAt,
        resolvedAt,
        priority,
        severity: rawSeverity ?? null,
        status,
        title: incident.name,
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

// ── Connector ─────────────────────────────────────────────────────────────────

export class IncidentIoConnector implements IntegrationConnector {
  readonly provider = 'incident_io' as const;

  readonly webhookConfig: WebhookConfig = {
    eventIdHeader: 'x-incident-signature',
    eventTypeHeader: 'x-incident-io-event-type',
    tokenEnvVar: 'INCIDENT_IO_WEBHOOK_TOKEN',
    devToken: 'dev-incident-io-token',
  };

  async validateConfiguration(input?: { credentials?: Record<string, unknown> }): Promise<void> {
    if (!input?.credentials) {
      throw new Error('Missing credentials for incident.io connector validation');
    }
    const creds = input.credentials as IncidentIoCredentials;
    if (!creds.api_key) throw new Error('incident.io credentials must include api_key');

    const client = new IncidentIoClient(creds);
    // Lightweight probe — fetch 1 incident to verify the key works
    await client.get('/v2/incidents', { page_size: 1 });
  }

  async runSync(input: SyncInput): Promise<SyncResult> {
    const creds = (input.credentials ?? {}) as IncidentIoCredentials;
    const scope = (input.scope ?? {}) as IncidentIoScope;

    if (!creds.api_key) {
      throw new Error('incident.io sync requires credentials.api_key');
    }

    const mapping = resolveFieldMapping(scope as unknown as Record<string, unknown>);
    const client = new IncidentIoClient(creds);

    const queryParams: Record<string, string | number> = {};
    if (input.mode === 'incremental' && input.sinceDate) {
      // updated_at catches existing incidents that changed status (acknowledged/resolved)
      // within the incremental window, not just newly created ones.
      queryParams['updated_at[gte]'] = input.sinceDate.toISOString();
    }

    const incidents = await client.paginate<IncidentIoIncident>('/v2/incidents', 'incidents', queryParams);

    const synced = await upsertIncidentEvents(
      input.tenantId,
      input.connectionId,
      incidents,
      mapping,
    );

    return {
      provider: 'incident_io',
      mode: input.mode,
      synced_entities: synced,
    };
  }
}
