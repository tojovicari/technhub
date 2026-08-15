import type { FastifyInstance } from 'fastify';
import { MetricTriggerConfigRepository } from '../../dashboard/metric-trigger-config.repository';
import type {
  ChangeFailureRateTriggerConfig,
  DeploymentFrequencyTriggerConfig,
  LeadTimeTriggerConfig,
  MetricTriggerConfig,
  MttrTriggerConfig,
} from '../../dashboard/metric-trigger-config.types';
import { getPgErrorCode } from '../pg-error';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

const DEPLOYMENT_FREQUENCY_START_EVENTS = ['CICD_DEPLOY', 'WORKFLOW_DONE_TRANSITION'] as const;
const CICD_PROVIDERS = ['github_actions', 'argocd', 'azure_pipelines', 'vercel'] as const;
const LEAD_TIME_START_EVENTS = ['PR_OPENED', 'FIRST_COMMIT'] as const;
const LEAD_TIME_END_EVENTS = ['PR_MERGED', 'CICD_DEPLOY'] as const;
const MTTR_START_EVENTS = ['INCIDENT_TRIGGERED', 'INCIDENT_ACKNOWLEDGED'] as const;
const SEMANTIC_CATEGORIES = ['BUG', 'FEATURE', 'TECHNICAL_DEBT', 'TOIL', 'RISK'] as const;

interface TenantParams {
  readonly tenantId: string;
}
interface TenantTeamParams extends TenantParams {
  readonly teamId: string;
}

interface UpsertMetricTriggerConfigBody {
  readonly metricTriggers?: MetricTriggerConfig;
}

function isValidDeploymentFrequencyConfig(value: unknown): value is DeploymentFrequencyTriggerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!DEPLOYMENT_FREQUENCY_START_EVENTS.includes(candidate.startEvent as never)) {
    return false;
  }
  if (candidate.categoryFilter !== undefined) {
    if (!Array.isArray(candidate.categoryFilter) || !candidate.categoryFilter.every((c) => SEMANTIC_CATEGORIES.includes(c))) {
      return false;
    }
  }
  if (candidate.sourceProviders === undefined) {
    return true;
  }
  return Array.isArray(candidate.sourceProviders) && candidate.sourceProviders.every((p) => CICD_PROVIDERS.includes(p));
}

function isValidLeadTimeConfig(value: unknown): value is LeadTimeTriggerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    LEAD_TIME_START_EVENTS.includes(candidate.startEvent as never) &&
    LEAD_TIME_END_EVENTS.includes(candidate.endEvent as never)
  );
}

function isValidMttrConfig(value: unknown): value is MttrTriggerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return MTTR_START_EVENTS.includes(candidate.startEvent as never);
}

function isValidChangeFailureRateConfig(value: unknown): value is ChangeFailureRateTriggerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.correlationWindowHours === 'number' && candidate.correlationWindowHours > 0;
}

function isValidMetricTriggerConfig(value: unknown): value is MetricTriggerConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isValidDeploymentFrequencyConfig(candidate.deploymentFrequency) &&
    isValidLeadTimeConfig(candidate.leadTime) &&
    isValidMttrConfig(candidate.meanTimeToRestore) &&
    isValidChangeFailureRateConfig(candidate.changeFailureRate)
  );
}

/**
 * Registra as rotas de configuração dos gatilhos de DORA por time (Seção 6
 * da spec) — mirror de `mapping-rules.routes.ts` (Seção 3), mesmo RBAC
 * (`ADMIN`/`GESTOR`, CLAUDE.md: GESTOR cobre "configuração semântica de
 * métricas da squad").
 */
export function registerMetricTriggerConfigRoutes(
  server: FastifyInstance,
  metricTriggerConfigRepository: MetricTriggerConfigRepository = new MetricTriggerConfigRepository(),
): void {
  /** Configuração de organização — fallback pro tenant inteiro (`team_id IS NULL`). */
  server.post<{ Params: TenantParams; Body: UpsertMetricTriggerConfigBody }>(
    '/tenants/:tenantId/metric-triggers',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { metricTriggers } = request.body;

      if (!isValidMetricTriggerConfig(metricTriggers)) {
        return reply.status(400).send({
          error:
            'O campo "metricTriggers" é obrigatório e precisa ter deploymentFrequency/leadTime/meanTimeToRestore/changeFailureRate válidos.',
        });
      }

      try {
        // `request.user` é garantido pelo `requireAuth` no preHandler.
        await metricTriggerConfigRepository.upsertOrgTriggers(tenantId, metricTriggers, request.user!.userId);
        return reply.status(200).send({ tenantId, teamId: null, metricTriggers });
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(404).send({ error: 'Tenant não encontrado.' });
        }
        throw error;
      }
    },
  );

  /** Leitura crua da configuração de organização — sem fallback, pra alimentar a tela de edição. */
  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/metric-triggers',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const effective = await metricTriggerConfigRepository.getOrgTriggers(tenantId);

      if (!effective) {
        return reply.status(404).send({ error: 'Nenhum gatilho de organização configurado para este tenant.' });
      }

      return reply.status(200).send({ tenantId, teamId: null, metricTriggers: effective.config });
    },
  );

  /** Configuração de um time específico — maior precedência (Seção 6). */
  server.post<{ Params: TenantTeamParams; Body: UpsertMetricTriggerConfigBody }>(
    '/tenants/:tenantId/teams/:teamId/metric-triggers',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { metricTriggers } = request.body;

      if (!isValidMetricTriggerConfig(metricTriggers)) {
        return reply.status(400).send({
          error:
            'O campo "metricTriggers" é obrigatório e precisa ter deploymentFrequency/leadTime/meanTimeToRestore/changeFailureRate válidos.',
        });
      }

      try {
        // `request.user` é garantido pelo `requireAuth` no preHandler.
        await metricTriggerConfigRepository.upsertTeamTriggers(tenantId, teamId, metricTriggers, request.user!.userId);
        return reply.status(200).send({ tenantId, teamId, metricTriggers });
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(404).send({ error: 'Tenant ou time não encontrado.' });
        }
        throw error;
      }
    },
  );

  /** Leitura crua da configuração de um time — sem mesclar com organização/fallback. */
  server.get<{ Params: TenantTeamParams }>(
    '/tenants/:tenantId/teams/:teamId/metric-triggers',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const effective = await metricTriggerConfigRepository.getTeamTriggers(tenantId, teamId);

      if (!effective) {
        return reply.status(404).send({ error: 'Nenhum gatilho configurado para este time.' });
      }

      return reply.status(200).send({ tenantId, teamId, metricTriggers: effective.config });
    },
  );
}
