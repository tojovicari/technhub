import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import { createConnectionSchema, createSyncJobSchema, rotateSecretSchema, typeMappingSchema, updateConnectionSchema } from './schema.js';
import { createConnection, createSyncJob, deleteConnection, getAllOriginalTypes, getConnection, getConnectionCredentials, getOriginalTypes, getSyncJob, getTypeMapping, listConnections, rotateSecret, updateConnection, updateTypeMapping } from './service.js';

function mapConnection(connection: {
  id: string;
  tenantId: string;
  provider: 'jira' | 'github' | 'opsgenie' | 'incident_io';
  status: 'active' | 'disabled' | 'error';
  scope: unknown;
  secretStrategy: 'vault_ref' | 'db_encrypted';
  secretLastRotatedAt: Date | null;
  syncJobs?: Array<{
    id: string;
    status: 'queued' | 'running' | 'success' | 'failed';
    startedAt: Date | null;
    finishedAt: Date | null;
    errorSummary: string | null;
  }>;
}) {
  const lastSync = connection.syncJobs?.[0] ?? null;
  return {
    id: connection.id,
    tenant_id: connection.tenantId,
    provider: connection.provider,
    status: connection.status,
    scope: connection.scope ?? null,
    secret_strategy: connection.secretStrategy,
    secret_last_rotated_at: connection.secretLastRotatedAt?.toISOString() ?? null,
    last_sync: lastSync
      ? {
          id: lastSync.id,
          status: lastSync.status,
          started_at: lastSync.startedAt?.toISOString() ?? null,
          finished_at: lastSync.finishedAt?.toISOString() ?? null,
          error_summary: lastSync.errorSummary
        }
      : null
  };
}

function mapSyncJob(job: {
  id: string;
  tenantId: string;
  connectionId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorSummary: string | null;
}) {
  return {
    id: job.id,
    tenant_id: job.tenantId,
    connection_id: job.connectionId,
    status: job.status,
    created_at: job.createdAt.toISOString(),
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
    error_summary: job.errorSummary
  };
}

export async function integrationsRoutes(app: FastifyInstance) {
  app.get('/integrations/connections', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const connections = await listConnections(tenantId);
    return reply.status(200).send(ok(request, connections.map(mapConnection)));
  });

  app.get('/integrations/connections/:connection_id', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const connection = await getConnection(connectionId, tenantId);

    if (!connection) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(200).send(ok(request, mapConnection(connection)));
  });

  app.post('/integrations/connections', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.manage')]
  }, async (request, reply) => {
    const parsed = createConnectionSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', {
        issues: parsed.error.issues
      }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const connection = await createConnection(parsed.data);

    return reply.status(201).send(ok(request, mapConnection(connection)));
  });

  app.patch('/integrations/connections/:connection_id', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.manage')]
  }, async (request, reply) => {
    const parsed = updateConnectionSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', {
        issues: parsed.error.issues
      }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const { connection_id: connectionId } = request.params as { connection_id: string };
    const connection = await updateConnection(connectionId, parsed.data.tenant_id, {
      status: parsed.data.status,
      scope: parsed.data.scope
    });

    if (!connection) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(200).send(ok(request, mapConnection(connection)));
  });

  app.delete('/integrations/connections/:connection_id', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.manage')]
  }, async (request, reply) => {
    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const deleted = await deleteConnection(connectionId, tenantId);

    if (!deleted) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(204).send();
  });

  app.put('/integrations/connections/:connection_id/secrets', {
    preHandler: [app.authenticate, app.requirePermission('integrations.secret.rotate')]
  }, async (request, reply) => {
    const parsed = rotateSecretSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', {
        issues: parsed.error.issues
      }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const { connection_id: connectionId } = request.params as { connection_id: string };
    const rotated = await rotateSecret(connectionId, parsed.data);

    if (!rotated) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(204).send();
  });

  app.post('/integrations/sync-jobs', {
    preHandler: [app.authenticate, app.requirePermission('integrations.sync.trigger')]
  }, async (request, reply) => {
    const parsed = createSyncJobSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', {
        issues: parsed.error.issues
      }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) {
      return tenantScopeError;
    }

    const job = await createSyncJob(parsed.data);

    if (!job) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(202).send(ok(request, mapSyncJob(job)));
  });

  app.get('/integrations/sync-jobs/:job_id', {
    preHandler: [app.authenticate, app.requirePermission('integrations.sync.read')]
  }, async (request, reply) => {
    const { job_id: jobId } = request.params as { job_id: string };
    const authTenantId = (request.user as { tenant_id: string }).tenant_id;
    const job = await getSyncJob(jobId, authTenantId);

    if (!job) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Sync job not found'));
    }

    return reply.status(200).send(ok(request, mapSyncJob(job)));
  });

  app.get('/integrations/connections/:connection_id/original-types', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const types = await getOriginalTypes(connectionId, tenantId);

    if (!types) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(200).send(ok(request, {
      connection_id: connectionId,
      original_types: types
    }));
  });

  app.get('/integrations/original-types', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const types = await getAllOriginalTypes(tenantId);

    return reply.status(200).send(ok(request, { original_types: types }));
  });

  app.get('/integrations/connections/:connection_id/type-mapping', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const mapping = await getTypeMapping(connectionId, tenantId);

    if (mapping === null) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(200).send(ok(request, {
      connection_id: connectionId,
      mapping
    }));
  });

  app.patch('/integrations/connections/:connection_id/type-mapping', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.manage')]
  }, async (request, reply) => {
    const parsed = typeMappingSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', {
        issues: parsed.error.issues
      }));
    }

    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const mapping = await updateTypeMapping(connectionId, tenantId, parsed.data.mapping);

    if (mapping === null) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }

    return reply.status(200).send(ok(request, {
      connection_id: connectionId,
      mapping
    }));
  });

  // ── Field mapping wizard — provider metadata ──────────────────────────────
  // Fetch the available severity/priority values from the provider so the
  // frontend can render a dropdown mapping to canonical P1–P5.

  app.get('/integrations/connections/:connection_id/incident-io/severities', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;

    const conn = await getConnectionCredentials(connectionId, tenantId);
    if (!conn) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }
    if (conn.provider !== 'incident_io') {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Connection is not an incident.io connection'));
    }

    const apiKey = (conn.credentials as { api_key?: string }).api_key;
    if (!apiKey) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Connection has no credentials'));
    }

    const incidentIoBaseUrl = process.env['INCIDENTIO_API_URL'] ?? 'https://api.incident.io';
    const res = await fetch(`${incidentIoBaseUrl}/v1/severities`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!res.ok) {
      return reply.status(502).send(fail(request, 'BAD_GATEWAY', `incident.io API error: ${res.status}`));
    }

    type IncidentIoSeveritiesResponse = {
      severities: Array<{ id: string; name: string; rank: number; description?: string }>;
    };
    const data = await res.json() as IncidentIoSeveritiesResponse;

    return reply.status(200).send(ok(request, {
      connection_id: connectionId,
      severities: data.severities.map((s) => ({
        id: s.id,
        name: s.name,
        rank: s.rank,
        description: s.description ?? null,
      })),
    }));
  });

  app.get('/integrations/connections/:connection_id/opsgenie/priorities', {
    preHandler: [app.authenticate, app.requirePermission('integrations.connection.read')]
  }, async (request, reply) => {
    const { connection_id: connectionId } = request.params as { connection_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;

    const conn = await getConnectionCredentials(connectionId, tenantId);
    if (!conn) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Connection not found'));
    }
    if (conn.provider !== 'opsgenie') {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Connection is not an OpsGenie connection'));
    }

    // OpsGenie priorities are system-defined — no API call needed.
    // The mapping wizard uses these to populate the left-hand side of the
    // severity_to_priority dropdowns.
    const priorities = [
      { name: 'P1', label: 'P1 — Critical' },
      { name: 'P2', label: 'P2 — High' },
      { name: 'P3', label: 'P3 — Moderate' },
      { name: 'P4', label: 'P4 — Low' },
      { name: 'P5', label: 'P5 — Informational' },
    ];

    return reply.status(200).send(ok(request, {
      connection_id: connectionId,
      priorities,
    }));
  });
}
