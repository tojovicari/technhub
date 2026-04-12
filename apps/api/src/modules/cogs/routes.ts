import type { FastifyInstance } from 'fastify';
import { ok, fail } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  createCogsEntrySchema,
  listCogsEntriesQuerySchema,
  listCogsEntriesAuditQuerySchema,
  cogsRollupQuerySchema,
  createCogsBudgetSchema,
  updateCogsBudgetSchema,
  budgetParamsSchema,
  burnRateQuerySchema,
  estimateFromSpSchema,
  initiativeParamsSchema,
  initiativeGenerateBodySchema
} from './schema.js';
import {
  createCogsEntry,
  createCogsEntryFromStoryPoints,
  listCogsEntries,
  computeCogsRollup,
  createCogsBudget,
  listCogsBudgets,
  updateCogsBudget,
  deleteCogsBudget,
  getBurnRate,
  getEpicCogsAnalysis,
  generateInitiativeCogs,
  getInitiativeCogsSummary
} from './service.js';
import { z } from 'zod';

const epicAnalysisParamsSchema = z.object({ epic_id: z.string().uuid() });

const budgetListQuerySchema = z.object({
  project_id: z.string().uuid().optional(),
  team_id: z.string().uuid().optional(),
  period: z.string().optional()
});

export async function cogsRoutes(app: FastifyInstance) {
  // ── POST /cogs/entries — create a cost entry ────────────────────────────────
  app.post(
    '/cogs/entries',
    { preHandler: [app.authenticate, app.requirePermission('cogs.write')] },
    async (req, reply) => {
      const parsed = createCogsEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const entry = await createCogsEntry(tenantId, parsed.data);
      return reply.status(201).send(ok(req, entry));
    }
  );

  // ── POST /cogs/entries/estimate — estimate cost from story points ───────────
  app.post(
    '/cogs/entries/estimate',
    { preHandler: [app.authenticate, app.requirePermission('cogs.write')] },
    async (req, reply) => {
      const parsed = estimateFromSpSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      try {
        const entry = await createCogsEntryFromStoryPoints(tenantId, parsed.data);
        return reply.status(201).send(ok(req, entry));
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'USER_NOT_FOUND') {
          return reply.status(404).send(fail(req, 'NOT_FOUND', 'User not found'));
        }
        throw err;
      }
    }
  );

  // ── GET /cogs/entries — list entries (with filters + superseded audit) ────────
  app.get(
    '/cogs/entries',
    { preHandler: [app.authenticate, app.requirePermission('cogs.read')] },
    async (req, reply) => {
      const parsed = listCogsEntriesAuditQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const result = await listCogsEntries(tenantId, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /cogs/rollup — aggregated cost with group_by ───────────────────────
  app.get(
    '/cogs/rollup',
    { preHandler: [app.authenticate, app.requirePermission('cogs.read')] },
    async (req, reply) => {
      const parsed = cogsRollupQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const rollup = await computeCogsRollup(tenantId, parsed.data);
      return reply.status(200).send(ok(req, rollup));
    }
  );

  // ── GET /cogs/epics/:epic_id — epic cost analysis + ROI ────────────────────
  app.get(
    '/cogs/epics/:epic_id',
    { preHandler: [app.authenticate, app.requirePermission('cogs.read')] },
    async (req, reply) => {
      const paramsParsed = epicAnalysisParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid epic_id'));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const analysis = await getEpicCogsAnalysis(tenantId, paramsParsed.data.epic_id);
      if (!analysis) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Epic not found'));
      }

      return reply.status(200).send(ok(req, analysis));
    }
  );

  // ── POST /cogs/budgets — set/update budget for a period ────────────────────
  app.post(
    '/cogs/budgets',
    { preHandler: [app.authenticate, app.requirePermission('cogs.budget.manage')] },
    async (req, reply) => {
      const parsed = createCogsBudgetSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const budget = await createCogsBudget(tenantId, parsed.data);
      return reply.status(201).send(ok(req, budget));
    }
  );

  // ── GET /cogs/budgets — list budgets ───────────────────────────────────────
  app.get(
    '/cogs/budgets',
    { preHandler: [app.authenticate, app.requirePermission('cogs.read')] },
    async (req, reply) => {
      const parsed = budgetListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const budgets = await listCogsBudgets(tenantId, parsed.data);
      return reply.status(200).send(ok(req, { data: budgets }));
    }
  );

  // ── PATCH /cogs/budgets/:id — update budget amount/notes ───────────────────
  app.patch(
    '/cogs/budgets/:id',
    { preHandler: [app.authenticate, app.requirePermission('cogs.budget.manage')] },
    async (req, reply) => {
      const paramsParsed = budgetParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid id'));
      }
      const bodyParsed = updateCogsBudgetSchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: bodyParsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const updated = await updateCogsBudget(tenantId, paramsParsed.data.id, bodyParsed.data);
      if (!updated) return reply.status(404).send(fail(req, 'NOT_FOUND', 'Budget not found'));
      return reply.status(200).send(ok(req, updated));
    }
  );

  // ── DELETE /cogs/budgets/:id — remove a budget ─────────────────────────────
  app.delete(
    '/cogs/budgets/:id',
    { preHandler: [app.authenticate, app.requirePermission('cogs.budget.manage')] },
    async (req, reply) => {
      const paramsParsed = budgetParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid id'));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const deleted = await deleteCogsBudget(tenantId, paramsParsed.data.id);
      if (!deleted) return reply.status(404).send(fail(req, 'NOT_FOUND', 'Budget not found'));
      return reply.status(204).send();
    }
  );

  // ── POST /cogs/initiatives/:project_id/generate — derive COGS from tasks ────
  app.post(
    '/cogs/initiatives/:project_id/generate',
    { preHandler: [app.authenticate, app.requirePermission('cogs.write')] },
    async (req, reply) => {
      const paramsParsed = initiativeParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid project_id'));
      }
      const bodyParsed = initiativeGenerateBodySchema.safeParse(req.body ?? {});
      if (!bodyParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid body', { issues: bodyParsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      try {
        const result = await generateInitiativeCogs(
          tenantId,
          paramsParsed.data.project_id,
          bodyParsed.data.overhead_rate
        );
        return reply.status(200).send(ok(req, result));
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'INITIATIVE_NOT_FOUND') {
          return reply.status(404).send(fail(req, 'NOT_FOUND', 'Initiative not found or project is not an initiative'));
        }
        throw err;
      }
    }
  );

  // ── GET /cogs/initiatives/:project_id/summary — cost summary ─────────────────
  app.get(
    '/cogs/initiatives/:project_id/summary',
    { preHandler: [app.authenticate, app.requirePermission('cogs.read')] },
    async (req, reply) => {
      const paramsParsed = initiativeParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid project_id'));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      const summary = await getInitiativeCogsSummary(tenantId, paramsParsed.data.project_id);
      if (!summary) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Initiative not found or project is not an initiative'));
      }
      return reply.status(200).send(ok(req, summary));
    }
  );

  // ── GET /cogs/burn-rate — burn rate vs configured budget ───────────────────
  app.get(
    '/cogs/burn-rate',
    { preHandler: [app.authenticate, app.requirePermission('cogs.read')] },
    async (req, reply) => {
      const parsed = burnRateQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues }));
      }

      const tenantId = (req.user as { tenant_id: string }).tenant_id;
      const scopeError = ensureTenantScope(req, reply, tenantId);
      if (scopeError) return scopeError;

      try {
        const burnRate = await getBurnRate(tenantId, parsed.data);
        return reply.status(200).send(ok(req, burnRate));
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'INVALID_PERIOD') {
          return reply.status(400).send(fail(req, 'BAD_REQUEST', 'Invalid period format'));
        }
        throw err;
      }
    }
  );
}
