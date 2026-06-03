import type { FastifyRequest } from 'fastify';

export type ResourceGroupAuditAction =
  | 'resource_group.create'
  | 'resource_group.update'
  | 'resource_group.resource.upsert'
  | 'resource_group.resource.remove'
  | 'resource_group.team.upsert'
  | 'resource_group.team.remove';

export function logAuditEvent(
  request: FastifyRequest,
  event: string,
  action: string,
  details: Record<string, unknown>
) {
  const user = request.user as { sub?: string; tenant_id?: string } | undefined;

  request.log.info(
    {
      event,
      action,
      tenant_id: user?.tenant_id ?? null,
      actor_user_id: user?.sub ?? null,
      request_id: request.id,
      details
    },
    'Audit event'
  );
}

export function logResourceGroupAudit(
  request: FastifyRequest,
  action: ResourceGroupAuditAction,
  details: Record<string, unknown>
) {
  logAuditEvent(request, 'audit.resource_group', action, details);
}
