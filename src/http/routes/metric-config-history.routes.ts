import type { FastifyInstance } from 'fastify';
import {
  TeamMetricConfigHistoryRepository,
  type MetricConfigType,
} from '../../dashboard/team-metric-config-history.repository';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const VALID_CONFIG_TYPES: readonly MetricConfigType[] = ['mapping_rules', 'metric_triggers'];

interface TenantParams {
  readonly tenantId: string;
}
interface TenantTeamParams extends TenantParams {
  readonly teamId: string;
}
interface HistoryQuery {
  readonly configType?: string;
  readonly limit?: string;
}

function isValidConfigType(value: string | undefined): value is MetricConfigType | undefined {
  return value === undefined || (VALID_CONFIG_TYPES as readonly string[]).includes(value);
}

/**
 * "Quem mudou a configuração de organização/time, e quando" — Decisão 3b do
 * plano de auditoria de DORA. Cobre as duas superfícies que compartilham
 * `team_metric_configurations` (`mapping_rules` da Seção 3, `metric_triggers`
 * da Seção 6), discriminadas por `configType`. Mesmo RBAC das rotas de
 * edição — "quem mudou o quê" é tão sensível quanto a própria config.
 */
export function registerMetricConfigHistoryRoutes(
  server: FastifyInstance,
  historyRepository: TeamMetricConfigHistoryRepository = new TeamMetricConfigHistoryRepository(),
): void {
  server.get<{ Params: TenantParams; Querystring: HistoryQuery }>(
    '/tenants/:tenantId/metric-config-history',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { configType, limit: limitParam } = request.query;

      if (!isValidConfigType(configType)) {
        return reply.status(400).send({ error: `"configType", se enviado, precisa ser um de: ${VALID_CONFIG_TYPES.join(', ')}.` });
      }

      const limit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        return reply.status(400).send({ error: `"limit" precisa ser um inteiro entre 1 e ${MAX_LIMIT}.` });
      }

      const entries = await historyRepository.findRecent(tenantId, null, { configType, limit });
      return reply.status(200).send({ tenantId, teamId: null, entries: entries.map(toResponseEntry) });
    },
  );

  server.get<{ Params: TenantTeamParams; Querystring: HistoryQuery }>(
    '/tenants/:tenantId/teams/:teamId/metric-config-history',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { configType, limit: limitParam } = request.query;

      if (!isValidConfigType(configType)) {
        return reply.status(400).send({ error: `"configType", se enviado, precisa ser um de: ${VALID_CONFIG_TYPES.join(', ')}.` });
      }

      const limit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        return reply.status(400).send({ error: `"limit" precisa ser um inteiro entre 1 e ${MAX_LIMIT}.` });
      }

      const entries = await historyRepository.findRecent(tenantId, teamId, { configType, limit });
      return reply.status(200).send({ tenantId, teamId, entries: entries.map(toResponseEntry) });
    },
  );
}

function toResponseEntry(entry: {
  readonly id: string;
  readonly configType: MetricConfigType;
  readonly snapshot: unknown;
  readonly changedByUserId: string;
  readonly changedByEmail: string;
  readonly changedAt: Date;
}) {
  return {
    id: entry.id,
    configType: entry.configType,
    snapshot: entry.snapshot,
    changedByUserId: entry.changedByUserId,
    changedByEmail: entry.changedByEmail,
    changedAt: entry.changedAt.toISOString(),
  };
}
