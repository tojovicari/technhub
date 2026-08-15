import type { FastifyInstance } from 'fastify';
import { TeamRepository } from '../../identity/team.repository';
import { TeamMembershipRepository } from '../../identity/team-membership.repository';
import {
  TeamResourceLinkRepository,
  type ExternalResourceProvider,
  type ExternalResourceType,
} from '../../identity/team-resource-link.repository';
import { PullRequestRepository } from '../../integrations/repositories/pull-request.repository';
import { IncidentRepository } from '../../integrations/repositories/incident.repository';
import { WorkItemRepository } from '../../integrations/repositories/work-item.repository';
import { DeploymentRepository } from '../../integrations/repositories/deployment.repository';
import type { PlanningCycle } from '../../identity/identity.types';
import { getPgErrorCode } from '../pg-error';
import { isValidUuid } from '../uuid';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';
import { BillingService } from '../../billing/billing.service';
import { AlertRepository } from '../../alerts/alert.repository';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');
const VALID_PLANNING_CYCLES: readonly PlanningCycle[] = ['MONTHLY', 'WEEKLY', 'BIWEEKLY_SPRINT'];
const VALID_RESOURCE_PROVIDERS: readonly ExternalResourceProvider[] = [
  'waroom',
  'github',
  'jira',
  'linear',
  'argocd',
  'azure_boards',
  'azure_repos',
  'azure_pipelines',
  'vercel',
];
const VALID_RESOURCE_TYPES: readonly ExternalResourceType[] = [
  'waroom_team',
  'github_repository',
  'jira_project',
  'linear_team',
  'argocd_project',
  'azure_boards_project',
  'azure_repos_repository',
  'azure_pipelines_project',
  'vercel_project',
];

interface TenantParams {
  readonly tenantId: string;
}
interface TenantTeamParams extends TenantParams {
  readonly teamId: string;
}
interface TenantTeamLinkParams extends TenantTeamParams {
  readonly linkId: string;
}

interface CreateTeamBody {
  readonly name?: string;
  readonly defaultMonthlyCapacityHours?: number;
  readonly planningCycle?: string;
  readonly workingDaysPerWeek?: number;
}

interface CreateMembershipBody {
  readonly userId?: string;
  readonly roleInTeam?: string;
  readonly capacityAllocationPercent?: number;
  readonly customMonthlyCapacityHours?: number;
}

interface UpdateTeamBody {
  readonly name?: string;
  readonly defaultMonthlyCapacityHours?: number;
  readonly planningCycle?: string;
  readonly workingDaysPerWeek?: number;
}

interface UpdateMembershipBody {
  readonly roleInTeam?: string;
  readonly capacityAllocationPercent?: number;
  readonly customMonthlyCapacityHours?: number;
}

interface TenantMembershipParams extends TenantTeamParams {
  readonly membershipId: string;
}

interface ResourceLinkCandidatesQuery {
  readonly provider?: string;
  readonly resourceType?: string;
}

interface CreateResourceLinkBody {
  readonly provider?: string;
  readonly resourceType?: string;
  readonly externalResourceId?: string;
  readonly externalResourceName?: string;
}

function isPlanningCycle(value: string): value is PlanningCycle {
  return (VALID_PLANNING_CYCLES as readonly string[]).includes(value);
}

function isResourceProvider(value: unknown): value is ExternalResourceProvider {
  return typeof value === 'string' && (VALID_RESOURCE_PROVIDERS as readonly string[]).includes(value);
}

function isResourceType(value: unknown): value is ExternalResourceType {
  return typeof value === 'string' && (VALID_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Registra as rotas de gestão de Teams e Team Memberships dentro de um
 * Tenant. `ADMIN` e `GESTOR` cobrem ambas — CLAUDE.md é explícito que
 * "Gestão de times" é responsabilidade do GESTOR, não só do ADMIN.
 */
export function registerTeamRoutes(
  server: FastifyInstance,
  teamRepository: TeamRepository = new TeamRepository(),
  teamMembershipRepository: TeamMembershipRepository = new TeamMembershipRepository(),
  teamResourceLinkRepository: TeamResourceLinkRepository = new TeamResourceLinkRepository(),
  pullRequestRepository: PullRequestRepository = new PullRequestRepository(),
  incidentRepository: IncidentRepository = new IncidentRepository(),
  workItemRepository: WorkItemRepository = new WorkItemRepository(),
  deploymentRepository: DeploymentRepository = new DeploymentRepository(),
  billingService: BillingService = new BillingService(),
  alertRepository: AlertRepository = new AlertRepository(),
): void {
  /**
   * Candidatos a vínculo: recursos externos (time do Waroom, repositório do
   * GitHub, projeto do Jira, time do Linear) já vistos no dado canônico
   * sincronizado que ainda não foram vinculados a nenhum time da plataforma.
   */
  server.get<{ Params: TenantParams; Querystring: ResourceLinkCandidatesQuery }>(
    '/tenants/:tenantId/team-resource-links/candidates',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { provider, resourceType } = request.query;

      if (!isResourceProvider(provider) || !isResourceType(resourceType)) {
        return reply.status(400).send({
          error: `Query params "provider" (${VALID_RESOURCE_PROVIDERS.join(', ')}) e "resourceType" (${VALID_RESOURCE_TYPES.join(', ')}) são obrigatórios.`,
        });
      }

      if (provider === 'waroom' && resourceType === 'waroom_team') {
        const candidates = await incidentRepository.findUnlinkedExternalTeams(tenantId);
        return reply.status(200).send(candidates);
      }
      if (provider === 'github' && resourceType === 'github_repository') {
        // União de duas fontes: repositório pode ter só PR, só deploy
        // (GitHub Actions), ou os dois — qualquer um dos dois já vinculado
        // resolve o outro também (mesmo par provider/resourceType).
        const [prCandidates, deploymentCandidates] = await Promise.all([
          pullRequestRepository.findUnlinkedRepositories(tenantId, 'github'),
          deploymentRepository.findUnlinkedExternalGroups(tenantId, 'github_actions', 'github_repository'),
        ]);
        const candidates = [...new Set([...prCandidates, ...deploymentCandidates])].sort();
        return reply.status(200).send(candidates);
      }
      if (provider === 'jira' && resourceType === 'jira_project') {
        const candidates = await workItemRepository.findUnlinkedExternalGroups(tenantId, 'jira');
        return reply.status(200).send(candidates);
      }
      if (provider === 'linear' && resourceType === 'linear_team') {
        const candidates = await workItemRepository.findUnlinkedExternalGroups(tenantId, 'linear');
        return reply.status(200).send(candidates);
      }
      if (provider === 'argocd' && resourceType === 'argocd_project') {
        const candidates = await deploymentRepository.findUnlinkedExternalGroups(tenantId, 'argocd', 'argocd_project');
        return reply.status(200).send(candidates);
      }
      if (provider === 'azure_boards' && resourceType === 'azure_boards_project') {
        const candidates = await workItemRepository.findUnlinkedExternalGroups(tenantId, 'azure_boards');
        return reply.status(200).send(candidates);
      }
      if (provider === 'azure_repos' && resourceType === 'azure_repos_repository') {
        const candidates = await pullRequestRepository.findUnlinkedRepositories(tenantId, 'azure_repos');
        return reply.status(200).send(candidates);
      }
      if (provider === 'azure_pipelines' && resourceType === 'azure_pipelines_project') {
        const candidates = await deploymentRepository.findUnlinkedExternalGroups(
          tenantId,
          'azure_pipelines',
          'azure_pipelines_project',
        );
        return reply.status(200).send(candidates);
      }
      if (provider === 'vercel' && resourceType === 'vercel_project') {
        const candidates = await deploymentRepository.findUnlinkedExternalGroups(tenantId, 'vercel', 'vercel_project');
        return reply.status(200).send(candidates);
      }

      return reply.status(400).send({ error: `Combinação "provider"/"resourceType" não suportada.` });
    },
  );

  server.post<{ Params: TenantTeamParams; Body: CreateResourceLinkBody }>(
    '/tenants/:tenantId/teams/:teamId/resource-links',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { provider, resourceType, externalResourceId, externalResourceName } = request.body;

      if (!isResourceProvider(provider) || !isResourceType(resourceType) || !externalResourceId) {
        return reply.status(400).send({
          error: `Os campos "provider" (${VALID_RESOURCE_PROVIDERS.join(', ')}), "resourceType" (${VALID_RESOURCE_TYPES.join(', ')}) e "externalResourceId" são obrigatórios.`,
        });
      }

      try {
        const link = await teamResourceLinkRepository.create(tenantId, teamId, {
          provider,
          resourceType,
          externalResourceId,
          externalResourceName,
        });
        return reply.status(201).send(link);
      } catch (error) {
        const code = getPgErrorCode(error);

        if (code === '23503') {
          return reply.status(404).send({ error: 'Time não encontrado.' });
        }
        if (code === '23505') {
          return reply.status(409).send({ error: 'Este recurso já está vinculado a um time.' });
        }

        throw error;
      }
    },
  );

  server.get<{ Params: TenantTeamParams }>(
    '/tenants/:tenantId/teams/:teamId/resource-links',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const links = await teamResourceLinkRepository.findByTeam(tenantId, teamId);
      return reply.status(200).send(links);
    },
  );

  /** Desvincula — o recurso externo volta a aparecer em `GET .../candidates` na próxima consulta. Não é retroativo: dado já enriquecido continua com o `team_id` antigo até o próximo `POST .../enrichment/:integrationId/run`. */
  server.delete<{ Params: TenantTeamLinkParams }>(
    '/tenants/:tenantId/teams/:teamId/resource-links/:linkId',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId, linkId } = request.params;

      if (!isValidUuid(linkId)) {
        return reply.status(404).send({ error: 'Vínculo não encontrado.' });
      }

      const deleted = await teamResourceLinkRepository.delete(tenantId, teamId, linkId);
      if (!deleted) {
        return reply.status(404).send({ error: 'Vínculo não encontrado.' });
      }

      return reply.status(204).send();
    },
  );

  server.post<{ Params: TenantParams; Body: CreateTeamBody }>(
    '/tenants/:tenantId/teams',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { name, defaultMonthlyCapacityHours, planningCycle, workingDaysPerWeek } = request.body;

      if (!name) {
        return reply.status(400).send({ error: 'O campo "name" é obrigatório.' });
      }
      if (planningCycle !== undefined && !isPlanningCycle(planningCycle)) {
        return reply
          .status(400)
          .send({ error: `"planningCycle" inválido. Use um de: ${VALID_PLANNING_CYCLES.join(', ')}.` });
      }

      const teamCount = await teamRepository.countByTenant(tenantId);
      const maxTeams = await billingService.getResourceLimit(tenantId, 'maxTeams');
      if (maxTeams !== null && teamCount >= maxTeams) {
        await alertRepository.evaluateResourceLimitAlert(tenantId, 'teams_limit_reached', teamCount, maxTeams);
        return reply
          .status(403)
          .send({ error: `Limite de times do plano atingido (${maxTeams}). Faça upgrade para criar mais times.` });
      }

      try {
        const team = await teamRepository.create(tenantId, {
          name,
          defaultMonthlyCapacityHours,
          planningCycle,
          workingDaysPerWeek,
        });
        return reply.status(201).send(team);
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(404).send({ error: 'Tenant não encontrado.' });
        }
        throw error;
      }
    },
  );

  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/teams',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const teams = await teamRepository.findAllByTenant(tenantId);
      return reply.status(200).send(teams);
    },
  );

  server.patch<{ Params: TenantTeamParams; Body: UpdateTeamBody }>(
    '/tenants/:tenantId/teams/:teamId',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { name, defaultMonthlyCapacityHours, planningCycle, workingDaysPerWeek } = request.body;

      if (planningCycle !== undefined && !isPlanningCycle(planningCycle)) {
        return reply
          .status(400)
          .send({ error: `"planningCycle" inválido. Use um de: ${VALID_PLANNING_CYCLES.join(', ')}.` });
      }

      const team = await teamRepository.update(tenantId, teamId, {
        name,
        defaultMonthlyCapacityHours,
        planningCycle,
        workingDaysPerWeek,
      });

      if (!team) {
        return reply.status(404).send({ error: 'Time não encontrado.' });
      }

      return reply.status(200).send(team);
    },
  );

  server.post<{ Params: TenantTeamParams; Body: CreateMembershipBody }>(
    '/tenants/:tenantId/teams/:teamId/members',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { userId, roleInTeam, capacityAllocationPercent, customMonthlyCapacityHours } = request.body;

      if (!userId) {
        return reply.status(400).send({ error: 'O campo "userId" é obrigatório.' });
      }

      try {
        const membership = await teamMembershipRepository.create(tenantId, teamId, {
          userId,
          roleInTeam,
          capacityAllocationPercent,
          customMonthlyCapacityHours,
        });
        return reply.status(201).send(membership);
      } catch (error) {
        const code = getPgErrorCode(error);

        if (code === '23503') {
          return reply.status(404).send({ error: 'Time ou usuário não encontrado.' });
        }
        if (code === '23505') {
          return reply.status(409).send({ error: 'Este usuário já é membro deste time.' });
        }

        throw error;
      }
    },
  );

  server.get<{ Params: TenantTeamParams }>(
    '/tenants/:tenantId/teams/:teamId/members',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const members = await teamMembershipRepository.findByTeamWithUser(tenantId, teamId);
      return reply.status(200).send(members);
    },
  );

  server.patch<{ Params: TenantMembershipParams; Body: UpdateMembershipBody }>(
    '/tenants/:tenantId/teams/:teamId/members/:membershipId',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId, membershipId } = request.params;
      const { roleInTeam, capacityAllocationPercent, customMonthlyCapacityHours } = request.body;

      const membership = await teamMembershipRepository.update(tenantId, teamId, membershipId, {
        roleInTeam,
        capacityAllocationPercent,
        customMonthlyCapacityHours,
      });

      if (!membership) {
        return reply.status(404).send({ error: 'Membership não encontrada.' });
      }

      return reply.status(200).send(membership);
    },
  );
}
