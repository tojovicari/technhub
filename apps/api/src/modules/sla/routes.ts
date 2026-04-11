import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import {
  createSlaTemplateSchema,
  updateSlaTemplateSchema,
  listSlaTemplatesQuerySchema,
  slaComplianceQuerySchema
} from './schema.js';
import {
  createSlaTemplate,
  deleteSlaTemplate,
  getSlaCompliance,
  getSlaTemplate,
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

  // ── GET /sla/compliance ──────────────────────────────────────────────────────
  app.get(
    '/sla/compliance',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const parsed = slaComplianceQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const result = await getSlaCompliance(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /sla/instances — compatibility shim (returns empty list) ─────────────
  app.get(
    '/sla/instances',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      return reply.status(200).send(ok(req, { data: [], next_cursor: null }));
    }
  );

  // ── GET /sla/summary — compatibility shim (delegates to compliance) ──────────
  app.get(
    '/sla/summary',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to = now.toISOString();
      const result = await getSlaCompliance(tenantId, { from, to });

      // Aggregate across templates
      let total = 0, met = 0, running = 0, at_risk = 0, breached = 0;
      for (const t of result.templates) {
        total += t.summary.total;
        met += t.summary.met;
        running += t.summary.running;
        at_risk += t.summary.at_risk;
        breached += t.summary.breached;
      }
      const closed = met + breached;

      return reply.status(200).send(ok(req, {
        period: result.period,
        total_instances: total,
        running,
        at_risk,
        breached,
        met,
        compliance_rate: closed > 0 ? Math.round((met / closed) * 1000) / 10 : null,
        breach_rate: closed > 0 ? Math.round((breached / closed) * 1000) / 10 : null,
        at_risk_rate: null,
        mean_resolution_minutes: null,
        breach_severity_avg_minutes: null
      }));
    }
  );

  // ── GET /sla/summary/by-template — compatibility shim ───────────────────────
  app.get(
    '/sla/summary/by-template',
    { preHandler: [app.authenticate, app.requirePermission('sla.template.read')] },
    async (req, reply) => {
      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const to = now.toISOString();
      const result = await getSlaCompliance(tenantId, { from, to });

      const rows = result.templates.map(t => ({
        template: { id: t.template_id, name: t.template_name, priority: 0 },
        running: t.summary.running,
        at_risk: t.summary.at_risk,
        breached: t.summary.breached,
        met: t.summary.met,
        total_instances: t.summary.total,
        compliance_rate: t.summary.compliance_rate,
        breach_rate: null,
        mean_resolution_minutes: null,
        breach_severity_avg_minutes: null
      }));

      return reply.status(200).send(ok(req, rows));
    }
  );
}
