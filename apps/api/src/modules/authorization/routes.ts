import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { policyEvaluationRequestSchema, listBindingsQuerySchema } from './schema.js';
import { evaluatePolicy, listRouteBindings } from './service.js';

export async function authorizationRoutes(app: FastifyInstance) {
  // ── POST /authorization/policies/evaluate ────────────────────────────────
  app.post(
    '/authorization/policies/evaluate',
    { preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.read')] },
    async (req, reply) => {
      const parsed = policyEvaluationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid request'));
      }

      const result = await evaluatePolicy(prisma, parsed.data);
      return reply.status(200).send(ok(req, result));
    }
  );

  // ── GET /authorization/routes/bindings ────────────────────────────────────
  app.get(
    '/authorization/routes/bindings',
    { preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.read')] },
    async (req, reply) => {
      const parsed = listBindingsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(fail(req, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid query'));
      }

      const bindings = listRouteBindings(parsed.data.module);
      return reply.status(200).send(ok(req, bindings));
    }
  );
}
