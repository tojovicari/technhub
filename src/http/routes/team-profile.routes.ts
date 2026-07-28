import type { FastifyInstance } from 'fastify';
import { TeamProfileService } from '../../dashboard/team-profile.service';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');
const DEFAULT_HISTORY_WEEKS = 12;
const MAX_HISTORY_WEEKS = 52;

interface TenantTeamParams {
  readonly tenantId: string;
  readonly teamId: string;
}

interface ProfileHistoryQuery {
  readonly weeks?: string;
}

/**
 * Registra `GET /tenants/:tenantId/teams/:teamId/profile` — perfil agregado
 * de um time (roster/capacidade + métricas de engenharia), pra alimentar a
 * página de perfil de time do front. `ADMIN`/`GESTOR`-only, mesma régua de
 * `GET .../teams/:teamId/members` (o payload inclui o roster completo, com
 * capacidade/alocação por pessoa — mais sensível que um dashboard).
 */
export function registerTeamProfileRoutes(
  server: FastifyInstance,
  teamProfileService: TeamProfileService = new TeamProfileService(),
): void {
  server.get<{ Params: TenantTeamParams }>(
    '/tenants/:tenantId/teams/:teamId/profile',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;

      const profile = await teamProfileService.getProfile(tenantId, teamId);
      if (!profile) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(profile);
    },
  );

  /**
   * WIP/Distribution histórico, um ponto por semana (default 12, máx 52) —
   * reconstrução via changelog de status (Jira/Linear). Mesmo RBAC do
   * `/profile`.
   */
  server.get<{ Params: TenantTeamParams; Querystring: ProfileHistoryQuery }>(
    '/tenants/:tenantId/teams/:teamId/profile/history',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const parsedWeeks = request.query.weeks ? Number(request.query.weeks) : DEFAULT_HISTORY_WEEKS;

      if (!Number.isInteger(parsedWeeks) || parsedWeeks < 1 || parsedWeeks > MAX_HISTORY_WEEKS) {
        return reply
          .status(400)
          .send({ error: `"weeks" precisa ser um inteiro entre 1 e ${MAX_HISTORY_WEEKS}.` });
      }

      const history = await teamProfileService.getProfileHistory(tenantId, teamId, parsedWeeks);
      if (!history) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(history);
    },
  );

  /**
   * Quebra por pessoa (work items/PRs/deploys/incidentes). Mesmo RBAC do
   * `/profile` — payload identifica gente, é ao menos tão sensível quanto o
   * roster.
   */
  server.get<{ Params: TenantTeamParams }>(
    '/tenants/:tenantId/teams/:teamId/profile/contributors',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;

      const contributors = await teamProfileService.getContributors(tenantId, teamId);
      if (!contributors) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(contributors);
    },
  );
}
