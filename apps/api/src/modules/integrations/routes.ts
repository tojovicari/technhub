import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import { createConnectionSchema, createSyncJobSchema, rotateSecretSchema } from './schema.js';
import { createConnection, createSyncJob, getSyncJob, rotateSecret } from './service.js';

function mapConnection(connection: {
  id: string;
  tenantId: string;
  provider: 'jira' | 'github';
  status: 'active' | 'disabled' | 'error';
  secretStrategy: 'vault_ref' | 'db_encrypted';
  secretLastRotatedAt: Date | null;
}) {
  return {
    id: connection.id,
    tenant_id: connection.tenantId,
    provider: connection.provider,
    status: connection.status,
    secret_strategy: connection.secretStrategy,
    secret_last_rotated_at: connection.secretLastRotatedAt?.toISOString() ?? null
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
}
