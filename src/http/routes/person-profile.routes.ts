import type { FastifyInstance } from 'fastify';
import { PersonProfileService } from '../../dashboard/person-profile.service';
import { requireAuth } from '../middleware/require-auth';
import { requireSelfOrRole } from '../middleware/require-self-or-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireSelfOrAdminOrManager = requireSelfOrRole('ADMIN', 'GESTOR');

interface TenantUserParams {
  readonly tenantId: string;
  readonly userId: string;
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
  server.get<{ Params: TenantUserParams }>(
    '/tenants/:tenantId/users/:userId/profile',
    { preHandler: [requireAuth, requireSelfOrAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, userId } = request.params;

      const profile = await personProfileService.getProfile(tenantId, userId);
      if (!profile) {
        return reply.status(404).send({ error: 'Usuário não encontrado.' });
      }

      return reply.status(200).send(profile);
    },
  );
}
