import type { FastifyInstance } from 'fastify';
import { DashboardService } from '../../dashboard/dashboard.service';
import { requireAuth } from '../middleware/require-auth';
import { requireSameTenant } from '../middleware/require-same-tenant';

interface TenantParams {
  readonly tenantId: string;
}

interface DoraQuery {
  readonly from?: string;
  readonly to?: string;
  readonly teamId?: string;
}

interface FlowQuery {
  readonly teamId?: string;
  readonly from?: string;
  readonly to?: string;
}

interface DoraHistoryQuery {
  readonly teamId?: string;
  readonly weeks?: string;
}

const DEFAULT_RANGE_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HISTORY_WEEKS = 12;
const MAX_HISTORY_WEEKS = 52;

function parseDateOrDefault(value: string | undefined, fallback: Date): Date | null {
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Registra os endpoints de dashboard (Seção 6 da spec) — sem `requireRole`
 * de propósito: os 3 papéis podem visualizar dashboards (CLAUDE.md,
 * USUARIO: "Visualização... dashboards das squads que pertence").
 */
export function registerDashboardRoutes(
  server: FastifyInstance,
  dashboardService: DashboardService = new DashboardService(),
): void {
  server.get<{ Params: TenantParams; Querystring: DoraQuery }>(
    '/tenants/:tenantId/dashboard/dora',
    { preHandler: [requireAuth, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - DEFAULT_RANGE_DAYS * ONE_DAY_MS);

      const to = parseDateOrDefault(request.query.to, now);
      const from = parseDateOrDefault(request.query.from, defaultFrom);

      if (!to || !from) {
        return reply.status(400).send({ error: '"from"/"to" precisam ser datas ISO 8601 válidas.' });
      }

      const metrics = await dashboardService.getDoraMetrics(tenantId, from, to, request.query.teamId);
      return reply.status(200).send(metrics);
    },
  );

  /**
   * `deploymentFrequency`/`changeFailureRate` (o par que forma o quadrante
   * DORA) por semana, não cumulativo — mesmo espírito de
   * `.../teams/:teamId/profile/history`. Mesmo RBAC do `/dashboard/dora`.
   */
  server.get<{ Params: TenantParams; Querystring: DoraHistoryQuery }>(
    '/tenants/:tenantId/dashboard/dora/history',
    { preHandler: [requireAuth, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const parsedWeeks = request.query.weeks ? Number(request.query.weeks) : DEFAULT_HISTORY_WEEKS;

      if (!Number.isInteger(parsedWeeks) || parsedWeeks < 1 || parsedWeeks > MAX_HISTORY_WEEKS) {
        return reply
          .status(400)
          .send({ error: `"weeks" precisa ser um inteiro entre 1 e ${MAX_HISTORY_WEEKS}.` });
      }

      const history = await dashboardService.getDoraHistory(tenantId, request.query.teamId, parsedWeeks);
      return reply.status(200).send(history);
    },
  );

  server.get<{ Params: TenantParams; Querystring: FlowQuery }>(
    '/tenants/:tenantId/dashboard/flow',
    { preHandler: [requireAuth, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - DEFAULT_RANGE_DAYS * ONE_DAY_MS);

      const to = parseDateOrDefault(request.query.to, now);
      const from = parseDateOrDefault(request.query.from, defaultFrom);

      if (!to || !from) {
        return reply.status(400).send({ error: '"from"/"to" precisam ser datas ISO 8601 válidas.' });
      }

      const metrics = await dashboardService.getFlowMetrics(tenantId, from, to, request.query.teamId);
      return reply.status(200).send(metrics);
    },
  );
}
