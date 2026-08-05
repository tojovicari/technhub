import type { FastifyInstance } from 'fastify';
import { PersonProfileService } from '../../dashboard/person-profile.service';
import { requireAuth } from '../middleware/require-auth';
import { requireSelfOrRole } from '../middleware/require-self-or-role';
import { requireSameTenant } from '../middleware/require-same-tenant';
import { parseOptionalPeriod } from './period-query.util';

const requireSelfOrAdminOrManager = requireSelfOrRole('ADMIN', 'GESTOR');
const DEFAULT_HISTORY_WEEKS = 12;
const MAX_HISTORY_WEEKS = 52;

interface TenantUserParams {
  readonly tenantId: string;
  readonly userId: string;
}

interface ProfileHistoryQuery {
  readonly weeks?: string;
}

interface ProfileQuery {
  readonly from?: string;
  readonly to?: string;
}

/**
 * Registra `GET /tenants/:tenantId/users/:userId/profile` — perfil agregado
 * de uma pessoa (todo o trabalho dela, cruzando os times em que contribui).
 * Inverso do perfil de time: em vez de `ADMIN`/`GESTOR`-only, qualquer
 * `USUARIO` pode ver o **próprio** perfil (CLAUDE.md, RBAC: "visualização
 * dos seus próprios dados") — `ADMIN`/`GESTOR` continuam vendo o de
 * qualquer um. `404` se o usuário não existe neste tenant.
 */
export function registerPersonProfileRoutes(
  server: FastifyInstance,
  personProfileService: PersonProfileService = new PersonProfileService(),
): void {
  server.get<{ Params: TenantUserParams; Querystring: ProfileQuery }>(
    '/tenants/:tenantId/users/:userId/profile',
    { preHandler: [requireAuth, requireSelfOrAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, userId } = request.params;
      const period = parseOptionalPeriod(request.query.from, request.query.to);

      if (period === 'invalid') {
        return reply
          .status(400)
          .send({ error: '"from" e "to" precisam vir juntos, como datas ISO 8601 válidas.' });
      }

      const profile = await personProfileService.getProfile(tenantId, userId, period);
      if (!profile) {
        return reply.status(404).send({ error: 'Usuário não encontrado.' });
      }

      return reply.status(200).send(profile);
    },
  );

  /**
   * Trabalho concluído/incidentes por semana, não cumulativo — mesmo
   * espírito de `.../teams/:teamId/profile/history`. Mesmo RBAC do
   * `/profile`.
   */
  server.get<{ Params: TenantUserParams; Querystring: ProfileHistoryQuery }>(
    '/tenants/:tenantId/users/:userId/profile/history',
    { preHandler: [requireAuth, requireSelfOrAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, userId } = request.params;
      const parsedWeeks = request.query.weeks ? Number(request.query.weeks) : DEFAULT_HISTORY_WEEKS;

      if (!Number.isInteger(parsedWeeks) || parsedWeeks < 1 || parsedWeeks > MAX_HISTORY_WEEKS) {
        return reply
          .status(400)
          .send({ error: `"weeks" precisa ser um inteiro entre 1 e ${MAX_HISTORY_WEEKS}.` });
      }

      const history = await personProfileService.getProfileHistory(tenantId, userId, parsedWeeks);
      if (!history) {
        return reply.status(404).send({ error: 'Usuário não encontrado.' });
      }

      return reply.status(200).send(history);
    },
  );
}
