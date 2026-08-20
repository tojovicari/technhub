import type { FastifyInstance } from 'fastify';
import { UserRepository } from '../../identity/user.repository';
import { TenantRepository } from '../../identity/tenant.repository';
import { UserProviderAliasRepository } from '../../identity/user-provider-alias.repository';
import { DiscoveredIdentityRepository } from '../../integrations/repositories/discovered-identity.repository';
import type { SystemRole, User } from '../../identity/identity.types';
import { getPgErrorCode } from '../pg-error';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';
import { NotificationService } from '../../notifications/notification.service';
import { getFrontendUrl } from '../../config/frontend-url';
import { BillingService } from '../../billing/billing.service';
import { AlertRepository } from '../../alerts/alert.repository';

const VALID_SYSTEM_ROLES: readonly SystemRole[] = ['ADMIN', 'GESTOR', 'USUARIO'];
const requireAdmin = requireRole('ADMIN');
const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

interface CreateUserBody {
  readonly primaryEmail?: string;
  readonly fullName?: string;
  readonly avatarUrl?: string;
  readonly systemRole?: string;
}

interface CreateAliasBody {
  readonly provider?: string;
  readonly externalUserId?: string;
  readonly externalUsername?: string;
  readonly externalEmail?: string;
}

interface MaterializeDiscoveredUserBody {
  readonly primaryEmail?: string;
  readonly fullName?: string;
  readonly avatarUrl?: string;
  readonly systemRole?: string;
  readonly discoveredIdentityIds?: readonly string[];
}

interface TenantParams {
  readonly tenantId: string;
}
interface TenantUserParams extends TenantParams {
  readonly userId: string;
}
interface TenantUserAliasParams extends TenantUserParams {
  readonly aliasId: string;
}

function isSystemRole(value: string): value is SystemRole {
  return (VALID_SYSTEM_ROLES as readonly string[]).includes(value);
}

/**
 * Envia o email de convite de forma best-effort: nunca lança, nunca atrasa
 * a resposta 201 — mesma filosofia de resiliência de
 * `SyncOrchestrator.persist()` (falha de uma etapa não derruba o fluxo
 * principal, só é logada).
 *
 * O link aponta pra uma tela do **front** (`/accept-invite?tenantId=`),
 * não direto pro backend — antes ia hardcoded pro
 * `AUTH_DEFAULT_LOGIN_PROVIDER` (GitHub em produção), o que deixava
 * qualquer pessoa sem conta GitHub sem conseguir aceitar o convite de
 * jeito nenhum (achado investigando um caso real de produção). A tela de
 * aceite deixa a pessoa escolher entre os 4 providers — `GET
 * /tenants/:tenantId/public-info` (já existia, nunca tinha sido consumida)
 * dá o nome do workspace pra essa tela antes de qualquer OAuth acontecer.
 */
function sendInviteEmailBestEffort(
  notificationService: NotificationService,
  tenantRepository: TenantRepository,
  tenantId: string,
  user: User,
): void {
  const acceptInviteUrl = new URL('/accept-invite', getFrontendUrl());
  acceptInviteUrl.searchParams.set('tenantId', tenantId);

  // Nome do tenant é só pra copy do email (personalização) — busca best-effort
  // igual ao resto desta função: se falhar, cai pra um nome genérico em vez
  // de derrubar o convite inteiro por causa de texto de exibição.
  tenantRepository
    .findManyByIds([tenantId])
    .then((tenants) => tenants[0]?.name ?? 'sua equipe')
    .catch(() => 'sua equipe')
    .then((tenantName) =>
      notificationService.sendInviteEmail({
        to: user.primaryEmail,
        recipientName: user.fullName,
        tenantName,
        acceptInviteUrl: acceptInviteUrl.toString(),
      }),
    )
    .then((result) => {
      if (!result.success) {
        console.error(`[users.routes] Falha ao enviar email de convite para "${user.primaryEmail}": ${result.error}`);
      }
    })
    .catch((error) => {
      console.error(`[users.routes] Erro inesperado ao enviar email de convite: ${(error as Error).message}`);
    });
}

/**
 * Registra as rotas de gestão de Users dentro de um Tenant.
 *
 * `POST /tenants/:tenantId/users` é condicional: se o tenant ainda não tem
 * nenhum usuário, a rota fica aberta e o usuário criado sempre vira `ADMIN`
 * — é o "dono" reivindicando o tenant recém-criado, resolvendo o problema
 * do primeiro ADMIN (sem isso, ninguém jamais teria um token pra criar o
 * primeiro usuário). Se o tenant já tem pelo menos um usuário, a rota exige
 * `Authorization: Bearer <token>` de um ADMIN daquele mesmo tenant.
 */
export function registerUserRoutes(
  server: FastifyInstance,
  userRepository: UserRepository = new UserRepository(),
  aliasRepository: UserProviderAliasRepository = new UserProviderAliasRepository(),
  discoveredIdentityRepository: DiscoveredIdentityRepository = new DiscoveredIdentityRepository(),
  notificationService: NotificationService = new NotificationService(),
  tenantRepository: TenantRepository = new TenantRepository(),
  billingService: BillingService = new BillingService(),
  alertRepository: AlertRepository = new AlertRepository(),
): void {
  server.post<{ Params: TenantParams; Body: CreateUserBody }>(
    '/tenants/:tenantId/users',
    async (request, reply) => {
      const { tenantId } = request.params;
      const { primaryEmail, fullName, avatarUrl, systemRole } = request.body;

      if (!primaryEmail || !fullName) {
        return reply.status(400).send({ error: 'Os campos "primaryEmail" e "fullName" são obrigatórios.' });
      }
      if (systemRole !== undefined && !isSystemRole(systemRole)) {
        return reply
          .status(400)
          .send({ error: `"systemRole" inválido. Use um de: ${VALID_SYSTEM_ROLES.join(', ')}.` });
      }

      const existingUserCount = await userRepository.countByTenant(tenantId);
      const isBootstrap = existingUserCount === 0;

      if (!isBootstrap) {
        await requireAuth(request, reply);
        if (reply.sent) return;
        await requireAdmin(request, reply);
        if (reply.sent) return;
        await requireSameTenant(request, reply);
        if (reply.sent) return;

        const maxUsers = await billingService.getResourceLimit(tenantId, 'maxUsers');
        if (maxUsers !== null && existingUserCount >= maxUsers) {
          await alertRepository.evaluateResourceLimitAlert(tenantId, 'users_limit_reached', existingUserCount, maxUsers);
          return reply
            .status(403)
            .send({ error: `Limite de usuários do plano atingido (${maxUsers}). Faça upgrade para convidar mais pessoas.` });
        }
      }

      try {
        const user = await userRepository.create(tenantId, {
          primaryEmail,
          fullName,
          avatarUrl,
          // Bootstrap: ignora o role pedido, o primeiro usuário do tenant sempre vira ADMIN.
          systemRole: isBootstrap ? 'ADMIN' : systemRole,
        });

        if (!isBootstrap) {
          sendInviteEmailBestEffort(notificationService, tenantRepository, tenantId, user);
        }

        return reply.status(201).send(user);
      } catch (error) {
        const code = getPgErrorCode(error);

        if (code === '23503') {
          return reply.status(404).send({ error: 'Tenant não encontrado.' });
        }
        if (code === '23505') {
          return reply.status(409).send({ error: 'Já existe um usuário com este email neste tenant.' });
        }

        throw error;
      }
    },
  );

  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/users',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const users = await userRepository.findAllByTenant(tenantId);
      return reply.status(200).send(users);
    },
  );

  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/discovered-users',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const candidates = await discoveredIdentityRepository.listCandidates(tenantId);
      return reply.status(200).send(candidates);
    },
  );

  /**
   * Materializa uma ou mais identidades descobertas (sync) num único
   * usuário novo — mesclando, por exemplo, o accountId do Jira + o
   * username do GitHub + o externalUserId do Waroom da mesma pessoa num só
   * `users.id` (uma linha em `user_provider_aliases` por identidade
   * mesclada). Cria com `status: 'DISCOVERED'` de propósito: pessoa
   * rastreada, sem convite — não consegue logar até um ADMIN promover via
   * `POST .../users/:userId/invite`. Não convidar automaticamente é
   * intencional: nem todo mundo cujo trabalho é medido vai (ou deve) ter
   * acesso à plataforma.
   */
  server.post<{ Params: TenantParams; Body: MaterializeDiscoveredUserBody }>(
    '/tenants/:tenantId/discovered-users/materialize',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { primaryEmail, fullName, avatarUrl, systemRole, discoveredIdentityIds } = request.body;

      if (!primaryEmail || !fullName) {
        return reply.status(400).send({ error: 'Os campos "primaryEmail" e "fullName" são obrigatórios.' });
      }
      if (!discoveredIdentityIds || discoveredIdentityIds.length === 0) {
        return reply.status(400).send({ error: 'O campo "discoveredIdentityIds" é obrigatório e não pode ser vazio.' });
      }
      if (systemRole !== undefined && !isSystemRole(systemRole)) {
        return reply
          .status(400)
          .send({ error: `"systemRole" inválido. Use um de: ${VALID_SYSTEM_ROLES.join(', ')}.` });
      }

      const identities = await discoveredIdentityRepository.findManyByIds(tenantId, discoveredIdentityIds);
      if (identities.length !== discoveredIdentityIds.length) {
        return reply.status(404).send({ error: 'Uma ou mais "discoveredIdentityIds" não existem neste tenant.' });
      }

      try {
        const user = await userRepository.create(tenantId, {
          primaryEmail,
          fullName,
          avatarUrl,
          systemRole,
          status: 'DISCOVERED',
        });

        for (const identity of identities) {
          await aliasRepository.create(tenantId, user.id, {
            provider: identity.provider,
            externalUserId: identity.externalUserId,
            externalUsername: identity.externalUsername ?? undefined,
            externalEmail: identity.externalEmail ?? undefined,
          });
        }

        return reply.status(201).send(user);
      } catch (error) {
        const code = getPgErrorCode(error);

        if (code === '23505') {
          return reply.status(409).send({
            error:
              'Já existe um usuário com este email, ou uma das identidades já foi mesclada/vinculada a outro usuário.',
          });
        }

        throw error;
      }
    },
  );

  /**
   * Promove `DISCOVERED` → `INVITED`: o convite "de verdade" pra alguém que
   * já foi materializado mas ainda não podia logar. Dispara o email de
   * convite só agora, não na materialização.
   */
  server.post<{ Params: TenantUserParams }>(
    '/tenants/:tenantId/users/:userId/invite',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, userId } = request.params;

      const existing = await userRepository.findById(tenantId, userId);
      if (!existing) {
        return reply.status(404).send({ error: 'Usuário não encontrado.' });
      }

      const invited = await userRepository.markInvited(tenantId, userId);
      if (!invited) {
        return reply.status(409).send({
          error: `Usuário já está em status "${existing.status}" — só é possível convidar quem está em "DISCOVERED".`,
        });
      }

      sendInviteEmailBestEffort(notificationService, tenantRepository, tenantId, invited);

      return reply.status(200).send(invited);
    },
  );

  server.post<{ Params: TenantUserParams; Body: CreateAliasBody }>(
    '/tenants/:tenantId/users/:userId/aliases',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, userId } = request.params;
      const { provider, externalUserId, externalUsername, externalEmail } = request.body;

      if (!provider || !externalUserId) {
        return reply.status(400).send({ error: 'Os campos "provider" e "externalUserId" são obrigatórios.' });
      }

      try {
        const alias = await aliasRepository.create(tenantId, userId, {
          provider,
          externalUserId,
          externalUsername,
          externalEmail,
        });
        return reply.status(201).send(alias);
      } catch (error) {
        const code = getPgErrorCode(error);

        if (code === '23503') {
          return reply.status(404).send({ error: 'Usuário não encontrado.' });
        }
        if (code === '23505') {
          return reply
            .status(409)
            .send({ error: 'Este provider+externalUserId já está vinculado a um usuário neste tenant.' });
        }

        throw error;
      }
    },
  );

  /**
   * Desfaz um vínculo pessoa↔identidade externa criado errado (mescla
   * acidental em `POST .../aliases` ou em `POST .../discovered-users/materialize`).
   * Mesmo RBAC do `POST`. Não apaga dado canônico/enriquecido nenhum, só a
   * ponte — dado histórico já processado com essa identidade fica como
   * estava até o próximo enriquecimento.
   */
  server.delete<{ Params: TenantUserAliasParams }>(
    '/tenants/:tenantId/users/:userId/aliases/:aliasId',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, userId, aliasId } = request.params;

      const deleted = await aliasRepository.delete(tenantId, userId, aliasId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Alias não encontrado para este usuário.' });
      }

      return reply.status(204).send();
    },
  );
}
