import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  createSlaTemplateSchema,
  updateSlaTemplateSchema,
  listSlaTemplatesQuerySchema,
  listSlaInstancesQuerySchema,
  slaSummaryQuerySchema,
  slaTaskEventSchema
} from './schema.js';
import {
  createSlaTemplate,
  deleteSlaTemplate,
  evaluateTaskSla,
  getSlaTemplate,
  getSlaSummary,
  getSlaSummaryByTemplate,
  listSlaInstances,
  listSlaTemplates,
  updateSlaTemplate
} from './service.js';

function mapTemplate(t: {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  condition: unknown;
  priority: number;
  appliesTo: string[];
  rules: unknown;
  escalationRule: unknown;
  projectIds: string[];
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    tenant_id: t.tenantId,
    name: t.name,
    description: t.description,
    condition: t.condition,
    priority: t.priority,
    applies_to: t.appliesTo,
    rules: t.rules,
    escalation_rule: t.escalationRule ?? null,
    project_ids: t.projectIds,
    is_default: t.isDefault,
    is_active: t.isActive,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString()
  };
}

function mapInstance(inst: {
  id: string;
  taskId: string;
  slaTemplateId: string;
  tenantId: string;
  targetMinutes: number;
  startedAt: Date;
  deadlineAt: Date;
  completedAt: Date | null;
  status: string;
  actualMinutes: number | null;
  breachMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
  template?: { id: string; name: string } | null;
  task_snapshot?: { title: string; assigneeId: string | null; priority: string; projectId: string } | null;
}) {
  return {
    id: inst.id,
    task_id: inst.taskId,
    sla_template_id: inst.slaTemplateId,
    tenant_id: inst.tenantId,
    target_minutes: inst.targetMinutes,
    started_at: inst.startedAt.toISOString(),
    deadline_at: inst.deadlineAt.toISOString(),
    completed_at: inst.completedAt?.toISOString() ?? null,
    status: inst.status,
    actual_minutes: inst.actualMinutes,
    breach_minutes: inst.breachMinutes,
    created_at: inst.createdAt.toISOString(),
    updated_at: inst.updatedAt.toISOString(),
    template: inst.template ?? null,
    task_snapshot: inst.task_snapshot
      ? {
          title: inst.task_snapshot.title,
          assignee_id: inst.task_snapshot.assigneeId,
          priority: inst.task_snapshot.priority,
          project_id: inst.task_snapshot.projectId
        }
      : null
  };
}

export async function slaRoutes(app: FastifyInstance) {
  // ── POST /sla/templates ──────────────────────────────────────────────────────
  app.post(
    '/sla/templates',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.manage')] },
    async (req, reply) => {
      const parsed = createSlaTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const template = await createSlaTemplate(tenantId, parsed.data);
      return reply.status(201).send(ok(req, mapTemplate(template)));
    }
  );

  // ── GET /sla/templates ───────────────────────────────────────────────────────
  app.get(
    '/sla/templates',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const parsed = listSlaTemplatesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const result = await listSlaTemplates(tenantId, parsed.data);
      return reply.status(200).send(ok(req, {
        data: result.data.map(mapTemplate),
        next_cursor: result.next_cursor
      }));
    }
  );

  // ── GET /sla/templates/:id ───────────────────────────────────────────────────
  app.get(
    '/sla/templates/:id',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const template = await getSlaTemplate(id, tenantId);

      if (!template) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'SLA template not found'));
      }

      return reply.status(200).send(ok(req, mapTemplate(template)));
    }
  );

  // ── PATCH /sla/templates/:id ─────────────────────────────────────────────────
  app.patch(
    '/sla/templates/:id',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.manage')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateSlaTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const template = await updateSlaTemplate(id, tenantId, parsed.data);

      if (!template) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'SLA template not found'));
      }

      return reply.status(200).send(ok(req, mapTemplate(template)));
    }
  );

  // ── DELETE /sla/templates/:id ────────────────────────────────────────────────
  app.delete(
    '/sla/templates/:id',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.manage')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const result = await deleteSlaTemplate(id, tenantId);

      if (!result) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'SLA template not found'));
      }

      return reply.status(204).send();
    }
  );

  // ── POST /sla/evaluate ───────────────────────────────────────────────────────
  app.post(
    '/sla/evaluate',
    { preHandler: [app.authenticate, app.requirePermission('sla.evaluate')] },
    async (req, reply) => {
      const parsed = slaTaskEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid task event', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;

      const scopeError = ensureTenantScope(req, reply, parsed.data.tenant_id);
      if (scopeError) return scopeError;

      if (parsed.data.tenant_id !== tenantId) {
        return reply.status(403).send(fail(req, 'FORBIDDEN', 'Tenant mismatch'));
      }

      const result = await evaluateTaskSla(parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /sla/instances ───────────────────────────────────────────────────────
  app.get(
    '/sla/instances',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const parsed = listSlaInstancesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const result = await listSlaInstances(tenantId, parsed.data);
      return reply.status(200).send(ok(req, {
        data: result.data.map(mapInstance),
        next_cursor: result.next_cursor
      }));
    }
  );

  // ── GET /sla/summary ─────────────────────────────────────────────────────────
  app.get(
    '/sla/summary',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const parsed = slaSummaryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const summary = await getSlaSummary(tenantId, {
        projectId: parsed.data.project_id,
        from: parsed.data.from,
        to: parsed.data.to
      });
      return reply.status(200).send(ok(req, summary));
    }
  );

  // ── GET /sla/summary/by-template ─────────────────────────────────────────────
  app.get(
    '/sla/summary/by-template',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const parsed = slaSummaryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const rows = await getSlaSummaryByTemplate(tenantId, {
        projectId: parsed.data.project_id,
        from: parsed.data.from,
        to: parsed.data.to
      });
      return reply.status(200).send(ok(req, rows));
    }
  );
}
