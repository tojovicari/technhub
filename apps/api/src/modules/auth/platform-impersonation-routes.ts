import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ok, fail } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';

const impersonateBodySchema = z.object({
  reason: z.string().min(10).max(500),
});

const impersonationAuditQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function platformImpersonationRoutes(app: FastifyInstance) {
  const superAdminGuard = [app.authenticate, app.requirePlatformRole('super_admin')];
  const readGuard = [app.authenticate, app.requirePlatformRole('super_admin', 'platform_admin')];

  // ── POST /platform/tenants/:tenant_id/impersonate ─────────────────────────
  app.post(
    '/platform/tenants/:tenant_id/impersonate',
    { preHandler: superAdminGuard },
    async (req, reply) => {
      const { tenant_id } = req.params as { tenant_id: string };
      const parsed = impersonateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues })
        );
      }

      const admin = req.user as { sub: string };

      // Find the tenant's oldest active org_admin
      const tenant = await prisma.tenant.findUnique({ where: { id: tenant_id } });
      if (!tenant) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Tenant not found'));
      }

      const orgAdmin = await prisma.platformAccount.findFirst({
        where: { tenantId: tenant_id, role: 'org_admin', isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      if (!orgAdmin) {
        return reply.status(409).send(
          fail(req, 'CONFLICT', 'No active org_admin found for this tenant')
        );
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

      // Create audit record first to get the ID for the token payload
      const auditRecord = await prisma.impersonationAudit.create({
        data: {
          initiatedBy: admin.sub,
          tenantId: tenant_id,
          impersonatedAs: orgAdmin.id,
          reason: parsed.data.reason,
          tokenIssuedAt: now,
          tokenExpiresAt: expiresAt,
        },
      });

      const payload = {
        sub: orgAdmin.id,
        tenant_id: tenant_id,
        roles: [orgAdmin.role],
        permissions: ['*'],
        platform_role: null,
        is_impersonation: true,
        impersonated_by: admin.sub,
        impersonation_audit_id: auditRecord.id,
      };

      const accessToken = app.jwt.sign(payload, { expiresIn: '15m' });

      return reply.status(201).send(ok(req, {
        access_token: accessToken,
        expires_at: expiresAt.toISOString(),
        impersonated_tenant_id: tenant_id,
        impersonated_as_role: orgAdmin.role,
        audit_id: auditRecord.id,
      }));
    }
  );

  // ── GET /platform/tenants/:tenant_id/impersonation-audit ─────────────────
  app.get(
    '/platform/tenants/:tenant_id/impersonation-audit',
    { preHandler: readGuard },
    async (req, reply) => {
      const { tenant_id } = req.params as { tenant_id: string };
      const parsed = impersonationAuditQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(req, 'BAD_REQUEST', 'Invalid query', { issues: parsed.error.issues })
        );
      }

      const tenant = await prisma.tenant.findUnique({ where: { id: tenant_id } });
      if (!tenant) {
        return reply.status(404).send(fail(req, 'NOT_FOUND', 'Tenant not found'));
      }

      const where: any = { tenantId: tenant_id };
      if (parsed.data.cursor) where.id = { lt: parsed.data.cursor };

      const records = await prisma.impersonationAudit.findMany({
        where,
        orderBy: { tokenIssuedAt: 'desc' },
        take: parsed.data.limit + 1,
      });

      const hasMore = records.length > parsed.data.limit;
      const page = hasMore ? records.slice(0, -1) : records;

      // Enrich with initiator account info
      const initiatorIds = [...new Set(page.map((r) => r.initiatedBy))];
      const initiators = await prisma.platformAccount.findMany({
        where: { id: { in: initiatorIds } },
        select: { id: true, email: true, fullName: true },
      });
      const initiatorMap = Object.fromEntries(initiators.map((a) => [a.id, a]));

      return reply.status(200).send(ok(req, {
        records: page.map((r) => ({
          id: r.id,
          initiated_by: initiatorMap[r.initiatedBy]
            ? {
                id: r.initiatedBy,
                email: initiatorMap[r.initiatedBy].email,
                full_name: initiatorMap[r.initiatedBy].fullName,
              }
            : { id: r.initiatedBy, email: null, full_name: null },
          impersonated_as: r.impersonatedAs,
          reason: r.reason,
          token_issued_at: r.tokenIssuedAt.toISOString(),
          token_expires_at: r.tokenExpiresAt.toISOString(),
          first_used_at: r.firstUsedAt?.toISOString() ?? null,
        })),
        next_cursor: hasMore ? page[page.length - 1].id : null,
      }));
    }
  );
}
