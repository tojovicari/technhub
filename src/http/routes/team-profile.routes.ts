import type { FastifyInstance } from 'fastify';
import { TeamProfileService } from '../../dashboard/team-profile.service';
import { TeamTimelineService } from '../../dashboard/team-timeline.service';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';
import { parseOptionalPeriod } from './period-query.util';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');
const DEFAULT_HISTORY_WEEKS = 12;
const MAX_HISTORY_WEEKS = 52;
/** Mesmo fallback all-time de `timeline-events.routes.ts` quando `from`/`to` não são passados. */
const ALL_TIME_RANGE = { from: new Date(0), to: new Date('9999-12-31T23:59:59.999Z') };

interface TenantTeamParams {
  readonly tenantId: string;
  readonly teamId: string;
}

interface ProfileHistoryQuery {
  readonly weeks?: string;
}

interface ProfileQuery {
  readonly from?: string;
  readonly to?: string;
}

interface ContributorsQuery {
  readonly from?: string;
  readonly to?: string;
}

interface TimelineQuery {
  readonly from?: string;
  readonly to?: string;
}

interface EpicsQuery {
  readonly status?: string;
}

/**
 * Registra `GET /tenants/:tenantId/teams/:teamId/profile` — perfil agregado
 * de um time (roster/capacidade + métricas de engenharia), pra alimentar a
 * página de perfil de time do front. `ADMIN`/`GESTOR`-only, mesma régua de
 * `GET .../teams/:teamId/members` (o payload inclui o roster completo, com
 * capacidade/alocação por pessoa — mais sensível que um dashboard).
 *
 * `from`/`to` opcionais (os dois juntos ou nenhum) — mesmo espírito de
 * `/profile/contributors`: aplicam a `deploymentSuccessRate`,
 * `pullRequestReviewHealth`, `contributionConcentration` e `reworkRate`, e a
 * `incidentsBySeverity`. Sem período, comportamento all-time original.
 * `wip`/`distribution` (retrato de "agora") e `toilRatio` (travado no mês
 * corrente) nunca respeitam o período.
 */
export function registerTeamProfileRoutes(
  server: FastifyInstance,
  teamProfileService: TeamProfileService = new TeamProfileService(),
  teamTimelineService: TeamTimelineService = new TeamTimelineService(),
): void {
  server.get<{ Params: TenantTeamParams; Querystring: ProfileQuery }>(
    '/tenants/:tenantId/teams/:teamId/profile',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const period = parseOptionalPeriod(request.query.from, request.query.to);

      if (period === 'invalid') {
        return reply
          .status(400)
          .send({ error: '"from" e "to" precisam vir juntos, como datas ISO 8601 válidas.' });
      }

      const profile = await teamProfileService.getProfile(tenantId, teamId, period);
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
   * roster. `from`/`to` opcionais (os dois juntos ou nenhum) — sem eles,
   * comportamento all-time original; `wip`/`toil` nunca respeitam o
   * período (ver doc de `getContributors`).
   */
  server.get<{ Params: TenantTeamParams; Querystring: ContributorsQuery }>(
    '/tenants/:tenantId/teams/:teamId/profile/contributors',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const period = parseOptionalPeriod(request.query.from, request.query.to);

      if (period === 'invalid') {
        return reply
          .status(400)
          .send({ error: '"from" e "to" precisam vir juntos, como datas ISO 8601 válidas.' });
      }

      const contributors = await teamProfileService.getContributors(tenantId, teamId, period);
      if (!contributors) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(contributors);
    },
  );

  /**
   * Tendência semanal de `/profile/contributors`, não-cumulativa (mesmo
   * espírito de query param de `/profile/history`). Mesmo RBAC.
   */
  server.get<{ Params: TenantTeamParams; Querystring: ProfileHistoryQuery }>(
    '/tenants/:tenantId/teams/:teamId/profile/contributors/history',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const parsedWeeks = request.query.weeks ? Number(request.query.weeks) : DEFAULT_HISTORY_WEEKS;

      if (!Number.isInteger(parsedWeeks) || parsedWeeks < 1 || parsedWeeks > MAX_HISTORY_WEEKS) {
        return reply
          .status(400)
          .send({ error: `"weeks" precisa ser um inteiro entre 1 e ${MAX_HISTORY_WEEKS}.` });
      }

      const history = await teamProfileService.getContributorsHistory(tenantId, teamId, parsedWeeks);
      if (!history) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(history);
    },
  );

  /**
   * Quebra de `semantic_category` por épico (Time → Projeto → Épico →
   * Item) — ver `src/enrichment/epic-resolver.ts`. Mesmo RBAC do `/profile`.
   * Sem filtro de período — sempre o histórico inteiro do time (diferente
   * de `/profile/timeline`, que aceita `from`/`to`); `?status=` existe pra
   * reduzir a lista sem precisar de data (pensado pro Gantt do front, que
   * cresce sem limite conforme o time acumula épico concluído há anos).
   */
  server.get<{ Params: TenantTeamParams; Querystring: EpicsQuery }>(
    '/tenants/:tenantId/teams/:teamId/profile/epics',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { status } = request.query;

      if (status !== undefined && status !== 'open' && status !== 'completed') {
        return reply.status(400).send({ error: '"status" precisa ser "open" ou "completed".' });
      }

      const breakdown = await teamProfileService.getEpicBreakdown(tenantId, teamId);
      if (!breakdown) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      if (!status || !breakdown.available) {
        return reply.status(200).send(breakdown);
      }

      // O bucket "sem épico" (`epic: null`) não tem `completedAt`/`startedAt`
      // — não tem conceito de conclusão, então fica de fora sempre que um
      // filtro é pedido (só aparece na resposta sem filtro, comportamento
      // de sempre).
      const filteredEpics = breakdown.epics.filter(
        (entry) => entry.epic !== null && (status === 'completed' ? entry.completedAt != null : entry.completedAt == null),
      );

      return reply.status(200).send({ ...breakdown, epics: filteredEpics });
    },
  );

  /**
   * Timeline consolidada — marcadores pontuais de 4 fontes (eventos
   * manuais, mudança de regra, incidentes, início/fim de épico) numa lista
   * só, ordenada por `date` (ver `TeamTimelineService`). Métricas em série
   * (`dora/history`/`profile/history`) ficam de fora de propósito — formato
   * incompatível com "evento pontual", front compõe no cliente. Mesmo RBAC
   * do `/profile`. `from`/`to` opcionais (mesma regra de `/profile/contributors`
   * — os dois juntos ou nenhum, all-time se omitidos).
   */
  server.get<{ Params: TenantTeamParams; Querystring: TimelineQuery }>(
    '/tenants/:tenantId/teams/:teamId/profile/timeline',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const period = parseOptionalPeriod(request.query.from, request.query.to);

      if (period === 'invalid') {
        return reply
          .status(400)
          .send({ error: '"from" e "to" precisam vir juntos, como datas ISO 8601 válidas.' });
      }

      const range = period ?? ALL_TIME_RANGE;
      const timeline = await teamTimelineService.getTimeline(tenantId, teamId, range.from, range.to);
      if (!timeline) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(timeline);
    },
  );
}
