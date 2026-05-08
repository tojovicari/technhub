import { randomUUID } from 'crypto';
import type { IntegrationConnection, IntegrationProvider, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getConnector } from './connectors/registry.js';
import {
  resolveFieldMapping,
  mapSeverityToPriority,
  isProductionIncident,
  extractAffectedServices,
} from './connectors/field-mapping.js';
import { createSyncJob } from './service.js';

type EnqueueInput = {
  tenantId: string;
  provider: IntegrationProvider;
  externalId: string;
  eventType: string;
  payload: unknown;
};

export async function enqueueWebhookEvent(input: EnqueueInput) {
  const existing = await prisma.integrationWebhookEvent.findUnique({
    where: {
      provider_externalId: {
        provider: input.provider,
        externalId: input.externalId
      }
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.integrationWebhookEvent.create({
    data: {
      tenantId: input.tenantId,
      provider: input.provider,
      externalId: input.externalId,
      eventType: input.eventType,
      payload: input.payload as object
    }
  });
}

export function resolveExternalEventId(
  provider: IntegrationProvider,
  headers: Record<string, string | string[] | undefined>
) {
  const { eventIdHeader } = getConnector(provider).webhookConfig;
  const value = headers[eventIdHeader];
  return (Array.isArray(value) ? value[0] : value) ?? randomUUID();
}

export function resolveWebhookEventType(
  provider: IntegrationProvider,
  headers: Record<string, string | string[] | undefined>
) {
  const { eventTypeHeader } = getConnector(provider).webhookConfig;
  const value = headers[eventTypeHeader];
  return (Array.isArray(value) ? value[0] : value) ?? 'unknown';
}

export function verifyWebhookToken(
  provider: IntegrationProvider,
  headers: Record<string, string | string[] | undefined>
) {
  const { tokenEnvVar, devToken } = getConnector(provider).webhookConfig;
  const expected = process.env[tokenEnvVar] ||
    (process.env.NODE_ENV !== 'production' ? devToken : undefined);

  // Local fallback: if no token configured, accept only when AUTH_BYPASS=true.
  if (!expected) {
    return process.env.AUTH_BYPASS === 'true';
  }

  const headerValue = headers['x-webhook-token'];
  const token = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return token === expected;
}

// ── Incident provider inline webhook processors ───────────────────────────────
//
// Rather than triggering a full incremental sync for every incident lifecycle
// event, we upsert the IncidentEvent directly from the webhook payload.
// This gives near-real-time MTTR/MTTA accuracy without polling delay.
// Both functions are best-effort: if field_mapping is missing we skip inline
// processing and let the next scheduled incremental sync pick up the change.

type IncidentIoStatusCategory = 'triage' | 'investigating' | 'fixing' | 'monitoring' | 'resolved' | 'declined';

function resolveIncidentIoStatus(cat: string): 'open' | 'acknowledged' | 'resolved' | 'closed' {
  switch (cat as IncidentIoStatusCategory) {
    case 'triage': case 'investigating': return 'open';
    case 'fixing': case 'monitoring': return 'acknowledged';
    case 'resolved': return 'resolved';
    case 'declined': return 'closed';
    default: return 'open';
  }
}

async function processIncidentIoWebhook(
  payload: Record<string, unknown>,
  connection: IntegrationConnection,
): Promise<void> {
  const incident = payload['incident'] as Record<string, unknown> | undefined;
  if (!incident || typeof incident['id'] !== 'string') return;

  const scope = (connection.scope as Record<string, unknown> | null) ?? {};
  let mapping: ReturnType<typeof resolveFieldMapping>;
  try {
    mapping = resolveFieldMapping(scope);
  } catch {
    return; // field_mapping not configured — fall back to scheduled sync
  }

  const rawSeverity = (incident['severity'] as Record<string, unknown> | undefined)?.['name'] as string | undefined;
  const priority = rawSeverity ? (mapSeverityToPriority(rawSeverity, mapping) ?? null) : null;
  const tags: string[] = Array.isArray(incident['tags']) ? incident['tags'].map(String) : [];
  if (!isProductionIncident(tags, mapping)) return;

  const statusCat = ((incident['status'] as Record<string, unknown> | undefined)?.['category'] as string | undefined) ?? 'triage';
  const status = resolveIncidentIoStatus(statusCat);
  const openedAt = new Date((incident[mapping.opened_at_field] as string | undefined) ?? incident['created_at'] as string);
  const acknowledgedAt = typeof incident['acknowledged_at'] === 'string' ? new Date(incident['acknowledged_at']) : null;
  const resolvedAt = typeof incident['resolved_at'] === 'string' ? new Date(incident['resolved_at']) : null;
  const responderIds = ((incident['incident_role_assignments'] as Array<Record<string, unknown>> | undefined) ?? [])
    .flatMap((a) => { const u = a['user'] as Record<string, unknown> | undefined; return typeof u?.['id'] === 'string' ? [u['id']] : []; });
  const affectedServices = extractAffectedServices(incident, mapping);
  const title = typeof incident['name'] === 'string' ? incident['name'] : 'Untitled incident';

  await prisma.incidentEvent.upsert({
    where: { tenantId_provider_externalId: { tenantId: connection.tenantId, provider: 'incident_io', externalId: incident['id'] } },
    create: {
      tenantId: connection.tenantId, connectionId: connection.id, provider: 'incident_io',
      externalId: incident['id'], openedAt, acknowledgedAt, resolvedAt,
      closedAt: status === 'closed' ? (resolvedAt ?? new Date()) : null,
      priority, severity: rawSeverity ?? null, status, title, affectedServices, responderIds, tags,
      rawPayload: incident as unknown as Prisma.InputJsonValue, syncedAt: new Date(),
    },
    update: {
      acknowledgedAt, resolvedAt,
      closedAt: status === 'closed' ? (resolvedAt ?? new Date()) : null,
      priority, severity: rawSeverity ?? null, status, title, affectedServices, responderIds, tags,
      rawPayload: incident as unknown as Prisma.InputJsonValue, syncedAt: new Date(),
    },
  });
}

async function processOpsGenieWebhook(
  payload: Record<string, unknown>,
  connection: IntegrationConnection,
): Promise<void> {
  const action = typeof payload['action'] === 'string' ? payload['action'] : '';
  const raw = (payload['incident'] ?? payload['alert']) as Record<string, unknown> | undefined;
  if (!raw) return;

  const externalId = (raw['id'] ?? raw['alertId']) as string | undefined;
  if (!externalId) return;

  const lifecycleActions = ['Create', 'Acknowledge', 'Close', 'Resolve', 'StateChange', 'Reopen'];
  if (!lifecycleActions.some((a) => action.toLowerCase().includes(a.toLowerCase()))) return;

  const scope = (connection.scope as Record<string, unknown> | null) ?? {};
  let mapping: ReturnType<typeof resolveFieldMapping>;
  try {
    mapping = resolveFieldMapping(scope);
  } catch {
    return;
  }

  const rawPriority = typeof raw['priority'] === 'string' ? raw['priority'] : null;
  const priority = rawPriority ? (mapSeverityToPriority(rawPriority, mapping) ?? rawPriority) : null;
  const tags: string[] = Array.isArray(raw['tags']) ? raw['tags'].map(String) : [];
  if (!isProductionIncident(tags, mapping)) return;

  const now = new Date();
  const reopened = action === 'Reopen';
  const openedAt = new Date((raw['impactStartDate'] ?? raw['createdAt'] ?? now) as string);
  const acknowledgedAt = action === 'Acknowledge' ? now : (typeof raw['acknowledgedAt'] === 'string' ? new Date(raw['acknowledgedAt']) : null);
  const resolvedAt = (action === 'Close' || action === 'Resolve' || action === 'StateChange')
    ? (typeof raw['impactEndDate'] === 'string' ? new Date(raw['impactEndDate']) : now)
    : (typeof raw['resolvedAt'] === 'string' ? new Date(raw['resolvedAt']) : null);
  const rawStatus = typeof raw['status'] === 'string' ? raw['status'] : 'open';
  const status = (['open', 'acknowledged', 'resolved', 'closed'] as const).includes(rawStatus as 'open')
    ? rawStatus as 'open' | 'acknowledged' | 'resolved' | 'closed' : 'open';
  const title = String(raw['message'] ?? raw['name'] ?? 'Untitled OpsGenie incident');
  const responderIds = ((raw['responders'] as Array<Record<string, unknown>> | undefined) ?? [])
    .flatMap((r) => typeof r['id'] === 'string' ? [r['id']] : []);
  const affectedServices = extractAffectedServices(raw, mapping);

  await prisma.incidentEvent.upsert({
    where: { tenantId_provider_externalId: { tenantId: connection.tenantId, provider: 'opsgenie', externalId } },
    create: {
      tenantId: connection.tenantId, connectionId: connection.id, provider: 'opsgenie',
      externalId, openedAt, acknowledgedAt, resolvedAt,
      closedAt: status === 'closed' ? (resolvedAt ?? now) : null,
      priority, severity: rawPriority, status, title, affectedServices, responderIds, tags,
      rawPayload: raw as unknown as Prisma.InputJsonValue, syncedAt: now,
    },
    update: reopened
      ? { resolvedAt: null, closedAt: null, status: 'open', priority, severity: rawPriority, title, affectedServices, responderIds, tags, rawPayload: raw as unknown as Prisma.InputJsonValue, syncedAt: now }
      : { acknowledgedAt, resolvedAt, closedAt: status === 'closed' ? (resolvedAt ?? now) : null, status, priority, severity: rawPriority, title, affectedServices, responderIds, tags, rawPayload: raw as unknown as Prisma.InputJsonValue, syncedAt: now },
  });
}

async function processGithubWebhook(
  payload: Record<string, unknown>,
  connection: IntegrationConnection,
): Promise<void> {
  // Only process merged pull_request events for near-real-time lead time ingestion.
  // Uses pr.created_at as proxy for first_commit_at (documented as valid option).
  if (payload['action'] !== 'closed') return;

  const pr = payload['pull_request'] as Record<string, unknown> | undefined;
  if (!pr || pr['merged'] !== true) return;

  const mergedAt = typeof pr['merged_at'] === 'string' ? new Date(pr['merged_at']) : null;
  const createdAt = typeof pr['created_at'] === 'string' ? new Date(pr['created_at']) : null;
  if (!mergedAt || !createdAt) return;

  const leadTimeHours = (mergedAt.getTime() - createdAt.getTime()) / 3_600_000;
  if (leadTimeHours > 90 * 24) return; // outlier — skip silently

  const repoFullName = (payload['repository'] as Record<string, unknown> | undefined)
    ?.['full_name'] as string | undefined;
  const prNumber = pr['number'];
  const prIdentifier = repoFullName && prNumber != null
    ? `${repoFullName}#${prNumber}`
    : String(prNumber ?? '');

  // Best-effort project resolution — task may not exist yet if sync hasn't run
  let projectId: string | null = null;
  if (repoFullName && prNumber != null) {
    const sourceId = `${repoFullName}#pr#${prNumber}`;
    const task = await prisma.task.findUnique({
      where: { tenantId_source_sourceId: { tenantId: connection.tenantId, source: 'github', sourceId } },
      select: { projectId: true },
    });
    projectId = task?.projectId ?? null;
  }

  await prisma.healthMetric.create({
    data: {
      tenantId: connection.tenantId,
      projectId,
      metricName: 'lead_time_hours',
      windowDays: 1,
      value: leadTimeHours,
      unit: 'hours',
      windowStart: createdAt,
      windowEnd: mergedAt,
      metadata: { pr_id: prIdentifier } as Prisma.InputJsonValue,
    },
  });
}

async function processOneEvent(eventId: string) {
  const lock = await prisma.integrationWebhookEvent.updateMany({
    where: {
      id: eventId,
      status: 'queued'
    },
    data: {
      status: 'processing',
      attempts: {
        increment: 1
      }
    }
  });

  if (lock.count === 0) {
    return;
  }

  const event = await prisma.integrationWebhookEvent.findUnique({
    where: { id: eventId }
  });

  if (!event) {
    return;
  }

  try {
    const connection = await prisma.integrationConnection.findFirst({
      where: {
        tenantId: event.tenantId,
        provider: event.provider,
        status: 'active'
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (!connection) {
      throw new Error('No active integration connection for tenant/provider');
    }

    // Incident providers: process the webhook payload inline for near-real-time
    // MTTR/MTTA accuracy. GitHub: process lead time inline + trigger incremental
    // sync to keep Tasks updated. Other providers fall through to incremental sync.
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (event.provider === 'incident_io') {
      await processIncidentIoWebhook(payload, connection);
    } else if (event.provider === 'opsgenie') {
      await processOpsGenieWebhook(payload, connection);
    } else if (event.provider === 'github') {
      await processGithubWebhook(payload, connection);
      await createSyncJob({
        tenant_id: event.tenantId,
        connection_id: connection.id,
        mode: 'incremental'
      });
    } else {
      await createSyncJob({
        tenant_id: event.tenantId,
        connection_id: connection.id,
        mode: 'incremental'
      });
    }

    await prisma.integrationWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'processed',
        processedAt: new Date(),
        lastError: null,
        connectionId: connection.id
      }
    });
  } catch (error) {
    await prisma.integrationWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'failed',
        lastError: error instanceof Error ? error.message : 'Unknown webhook processing error'
      }
    });
  }
}

let workerRunning = false;

export async function processPendingWebhookEvents(limit = 20) {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  try {
    const pending = await prisma.integrationWebhookEvent.findMany({
      where: { status: 'queued' },
      orderBy: { receivedAt: 'asc' },
      take: limit
    });

    for (const event of pending) {
      await processOneEvent(event.id);
    }
  } finally {
    workerRunning = false;
  }
}
