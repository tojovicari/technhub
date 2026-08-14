import type { FastifyInstance } from 'fastify';
import { MappingRulesRepository } from '../../enrichment/mapping-rules.repository';
import type { MappingRules } from '../../enrichment/domain-context.types';
import { WorkItemRepository } from '../../integrations/repositories/work-item.repository';
import { DeploymentRepository } from '../../integrations/repositories/deployment.repository';
import { getPgErrorCode } from '../pg-error';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

/**
 * Campos com valor bruto observável no dado canônico já sincronizado —
 * alimenta `GET /mapping-rules/observed-values`. `severity` fica de fora de
 * propósito: `canonical_incidents.severity` já é normalizado num enum fixo
 * (`SEV1`-`SEV4`/`UNKNOWN`) dentro do próprio `waroom.provider.ts`, antes da
 * regra do admin rodar — não existe valor bruto "surpresa" possível ali, o
 * front pode usar um dropdown estático em vez de consultar isto.
 */
const OBSERVABLE_FIELDS = ['issue_type', 'labels', 'status', 'environment'] as const;
type ObservableField = (typeof OBSERVABLE_FIELDS)[number];

function isObservableField(value: unknown): value is ObservableField {
  return typeof value === 'string' && (OBSERVABLE_FIELDS as readonly string[]).includes(value);
}

interface TenantParams {
  readonly tenantId: string;
}
interface TenantTeamParams extends TenantParams {
  readonly teamId: string;
}

interface ObservedValuesQuery {
  readonly field?: string;
}

interface UpsertMappingRulesBody {
  readonly rules?: MappingRules;
}

function isValidMappingRules(value: unknown): value is MappingRules {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.workItemType) &&
    Array.isArray(candidate.workflowStates) &&
    Array.isArray(candidate.deploymentEnvironment) &&
    Array.isArray(candidate.incidentSeverity) &&
    Array.isArray(candidate.epicGrouping)
  );
}

/**
 * Registra as rotas de configuração do Domain Context Engine (Seção 3 da
 * spec) — `ADMIN`/`GESTOR`, CLAUDE.md: GESTOR cobre "configuração semântica
 * de métricas da squad".
 */
export function registerMappingRulesRoutes(
  server: FastifyInstance,
  mappingRulesRepository: MappingRulesRepository = new MappingRulesRepository(),
  workItemRepository: WorkItemRepository = new WorkItemRepository(),
  deploymentRepository: DeploymentRepository = new DeploymentRepository(),
): void {
  /**
   * Valores brutos distintos já sincronizados pra um campo — alimenta o
   * multi-select da tela de Regras Semânticas, em vez de texto livre às
   * cegas. Escopo: tenant inteiro (dado canônico não carrega `team_id`).
   */
  server.get<{ Params: TenantParams; Querystring: ObservedValuesQuery }>(
    '/tenants/:tenantId/mapping-rules/observed-values',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { field } = request.query;

      if (!isObservableField(field)) {
        return reply.status(400).send({
          error: `Query param "field" é obrigatório. Use um de: ${OBSERVABLE_FIELDS.join(', ')}.`,
        });
      }

      const values = await (async (): Promise<readonly string[]> => {
        switch (field) {
          case 'issue_type':
            return workItemRepository.findDistinctIssueTypes(tenantId);
          case 'labels':
            return workItemRepository.findDistinctLabels(tenantId);
          case 'status':
            return workItemRepository.findDistinctStatuses(tenantId);
          case 'environment':
            return deploymentRepository.findDistinctEnvironments(tenantId);
        }
      })();

      return reply.status(200).send({ field, values });
    },
  );


  /** Configuração de organização — fallback pro tenant inteiro (`team_id IS NULL`). */
  server.post<{ Params: TenantParams; Body: UpsertMappingRulesBody }>(
    '/tenants/:tenantId/mapping-rules',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { rules } = request.body;

      if (!isValidMappingRules(rules)) {
        return reply.status(400).send({
          error: 'O campo "rules" é obrigatório e precisa ter "workItemType" e "workflowStates" como arrays.',
        });
      }

      try {
        // `request.user` é garantido pelo `requireAuth` no preHandler.
        await mappingRulesRepository.upsertOrgRules(tenantId, rules, request.user!.userId);
        return reply.status(200).send({ tenantId, teamId: null, rules });
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
    '/tenants/:tenantId/mapping-rules',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const effective = await mappingRulesRepository.getOrgRules(tenantId);

      if (!effective) {
        return reply.status(404).send({ error: 'Nenhuma regra de organização configurada para este tenant.' });
      }

      return reply.status(200).send({ tenantId, teamId: null, rules: effective.rules });
    },
  );

  /** Configuração de um time específico — maior precedência (Seção 3). */
  server.post<{ Params: TenantTeamParams; Body: UpsertMappingRulesBody }>(
    '/tenants/:tenantId/teams/:teamId/mapping-rules',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const { rules } = request.body;

      if (!isValidMappingRules(rules)) {
        return reply.status(400).send({
          error: 'O campo "rules" é obrigatório e precisa ter "workItemType" e "workflowStates" como arrays.',
        });
      }

      try {
        // `request.user` é garantido pelo `requireAuth` no preHandler.
        await mappingRulesRepository.upsertTeamRules(tenantId, teamId, rules, request.user!.userId);
        return reply.status(200).send({ tenantId, teamId, rules });
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
    '/tenants/:tenantId/teams/:teamId/mapping-rules',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, teamId } = request.params;
      const effective = await mappingRulesRepository.getTeamRules(tenantId, teamId);

      if (!effective) {
        return reply.status(404).send({ error: 'Nenhuma regra configurada para este time.' });
      }

      return reply.status(200).send({ tenantId, teamId, rules: effective.rules });
    },
  );
}
