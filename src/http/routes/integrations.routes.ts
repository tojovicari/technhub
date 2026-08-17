import type { FastifyInstance } from 'fastify';
import { ProviderFactory } from '../../integrations/core/provider.factory';
import { SyncOrchestrator } from '../../integrations/core/sync.orchestrator';
import { ProviderIntegrationRepository } from '../../integrations/repositories/provider-integration.repository';
import { IntegrationRunHistoryRepository } from '../../integrations/repositories/integration-run-history.repository';
import { AlertRepository } from '../../alerts/alert.repository';
import type { ProviderCredentials } from '../../integrations/core/canonical.types';
import { getPgErrorCode } from '../pg-error';
import { isValidUuid } from '../uuid';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';
import { BillingService } from '../../billing/billing.service';

const requireAdmin = requireRole('ADMIN');
const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

interface TenantParams {
  readonly tenantId: string;
}

interface TenantIntegrationParams extends TenantParams {
  readonly integrationId: string;
}

interface RegisterIntegrationBody {
  readonly provider?: string;
  readonly credentials?: ProviderCredentials;
  /** Time da plataforma dono desses dados — usado pela Enriched Layer pra atribuir team_id. */
  readonly teamId?: string;
}

interface UpdateIntegrationBody {
  readonly credentials?: ProviderCredentials;
  readonly teamId?: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Registra as rotas do Módulo de Integrações (Seção 4.2 da spec):
 * cadastro de credenciais por tenant e disparo de sync incremental real.
 */
export function registerIntegrationRoutes(
  server: FastifyInstance,
  integrationRepository: ProviderIntegrationRepository = new ProviderIntegrationRepository(),
  syncOrchestrator: SyncOrchestrator = new SyncOrchestrator(),
  runHistoryRepository: IntegrationRunHistoryRepository = new IntegrationRunHistoryRepository(),
  alertRepository: AlertRepository = new AlertRepository(),
  billingService: BillingService = new BillingService(),
): void {
  server.post<{ Params: TenantParams; Body: RegisterIntegrationBody }>(
    '/tenants/:tenantId/integrations',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { provider, credentials, teamId } = request.body;

      if (!provider || typeof provider !== 'string') {
        return reply.status(400).send({ error: 'O campo "provider" é obrigatório.' });
      }
      if (!ProviderFactory.isRegistered(provider)) {
        return reply.status(400).send({
          error: `Provider "${provider}" não suportado. Disponíveis: ${ProviderFactory.listRegistered().join(', ') || 'nenhum'}.`,
        });
      }
      if (!isPlainObject(credentials)) {
        return reply.status(400).send({ error: 'O campo "credentials" é obrigatório e deve ser um objeto.' });
      }

      const integrationCount = await integrationRepository.countByTenant(tenantId);
      const maxIntegrations = await billingService.getResourceLimit(tenantId, 'maxIntegrations');
      if (maxIntegrations !== null && integrationCount >= maxIntegrations) {
        await alertRepository.evaluateResourceLimitAlert(
          tenantId,
          'integrations_limit_reached',
          integrationCount,
          maxIntegrations,
        );
        return reply.status(403).send({
          error: `Limite de integrações do plano atingido (${maxIntegrations}). Faça upgrade para conectar mais ferramentas.`,
        });
      }

      const providerInstance = ProviderFactory.create(provider);
      const testResult = await providerInstance.testConnection(credentials);

      if (!testResult.success) {
        return reply.status(422).send({
          error: 'Falha ao validar as credenciais junto ao provider.',
          detail: testResult.message,
        });
      }

      try {
        const integration = await integrationRepository.create(
          tenantId,
          provider,
          providerInstance.category,
          credentials,
          teamId,
        );
        return reply.status(201).send(integration);
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(404).send({ error: 'Tenant não encontrado, ou "teamId" não existe neste tenant.' });
        }
        throw error;
      }
    },
  );

  server.get<{ Params: TenantParams }>(
    '/tenants/:tenantId/integrations',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const integrations = await integrationRepository.listByTenant(tenantId);
      return reply.status(200).send(integrations);
    },
  );

  server.patch<{ Params: TenantIntegrationParams; Body: UpdateIntegrationBody }>(
    '/tenants/:tenantId/integrations/:integrationId',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;
      const { credentials, teamId } = request.body;

      if (!isValidUuid(integrationId)) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      if (credentials !== undefined) {
        if (!isPlainObject(credentials)) {
          return reply.status(400).send({ error: 'O campo "credentials", quando enviado, deve ser um objeto.' });
        }

        const existing = await integrationRepository.getById(tenantId, integrationId);
        if (!existing) {
          return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
        }

        const providerInstance = ProviderFactory.create(existing.provider);
        const testResult = await providerInstance.testConnection(credentials);
        if (!testResult.success) {
          return reply.status(422).send({
            error: 'Falha ao validar as credenciais junto ao provider.',
            detail: testResult.message,
          });
        }
      }

      try {
        const updated = await integrationRepository.update(tenantId, integrationId, { credentials, teamId });
        if (!updated) {
          return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
        }
        return reply.status(200).send(updated);
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(404).send({ error: '"teamId" não existe neste tenant.' });
        }
        throw error;
      }
    },
  );

  server.delete<{ Params: TenantIntegrationParams }>(
    '/tenants/:tenantId/integrations/:integrationId',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;

      if (!isValidUuid(integrationId)) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      try {
        const deleted = await integrationRepository.delete(tenantId, integrationId);

        if (!deleted) {
          return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
        }

        return reply.status(204).send();
      } catch (error) {
        if (getPgErrorCode(error) === '23503') {
          return reply.status(409).send({
            error:
              'Não é possível excluir: já existem dados sincronizados vinculados a esta integração (work items ou deploys).',
          });
        }
        throw error;
      }
    },
  );

  server.post<{ Params: TenantIntegrationParams }>(
    '/tenants/:tenantId/integrations/:integrationId/sync',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;

      if (!isValidUuid(integrationId)) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      const integration = await integrationRepository.getById(tenantId, integrationId);

      let stored;
      try {
        stored = await integrationRepository.getDecryptedCredentialsById(tenantId, integrationId);
      } catch (error) {
        // `39000` = erro do pgcrypto (`pgp_sym_decrypt`) — a credencial
        // guardada não descriptografa com a `INTEGRATION_ENCRYPTION_KEY`
        // atual (dado corrompido/seed inválido, ou a chave mudou sem
        // reprocessar as credenciais existentes). Não deixa estourar cru
        // como 500 sem contexto — devolve um erro acionável.
        if (getPgErrorCode(error) === '39000') {
          return reply.status(422).send({
            error: 'Não foi possível descriptografar as credenciais desta integração. Recadastre a integração.',
          });
        }
        throw error;
      }

      if (!integration || !stored) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      const result = await syncOrchestrator.runSyncForIntegration({
        providerName: integration.provider,
        tenantId,
        integrationId,
        teamId: integration.teamId ?? undefined,
        credentials: stored.credentials,
        cursor: stored.lastCursor,
        since: stored.lastSyncedAt ?? undefined,
        epicLinkFieldId: stored.epicLinkFieldId,
      });

      const outcome = await integrationRepository.markSyncOutcome(tenantId, integrationId, {
        success: result.success,
        nextCursor: result.nextCursor,
        cursorInvalidated: result.cursorInvalidated,
        epicLinkFieldId: result.epicLinkFieldId,
      });
      await alertRepository.evaluateReconnectionAlert(
        tenantId,
        integrationId,
        integration.provider,
        outcome.consecutiveFailures,
      );

      return reply.status(200).send(result);
    },
  );

  /**
   * Força a integração a rodar backfill completo de novo na próxima sync —
   * ver `ProviderIntegrationRepository.resetSyncState`. `requireAdmin`
   * (não `requireAdminOrManager` como `/sync`): ação mais cara (revarre a
   * integração inteira, bem mais requests no provider) e com efeito
   * colateral visível (`sync_stale` dispara até o backfill terminar de
   * novo), mesmo tier de registrar/editar/apagar integração.
   */
  server.post<{ Params: TenantIntegrationParams }>(
    '/tenants/:tenantId/integrations/:integrationId/resync',
    { preHandler: [requireAuth, requireAdmin, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;

      if (!isValidUuid(integrationId)) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      const outcome = await integrationRepository.resetSyncState(tenantId, integrationId);

      if (outcome === 'not_found') {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }
      if (outcome === 'in_progress') {
        return reply
          .status(409)
          .send({ error: 'Já existe um backfill em andamento nesta integração — aguarde terminar antes de forçar outro.' });
      }

      return reply.status(200).send({
        message:
          'Estado de sincronização resetado — a próxima sync (manual ou automática) vai revarrer todo o histórico dentro da janela de backfill.',
      });
    },
  );

  server.get<{ Params: TenantIntegrationParams }>(
    '/tenants/:tenantId/integrations/:integrationId/run-history',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;

      if (!isValidUuid(integrationId)) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      const integration = await integrationRepository.getById(tenantId, integrationId);
      if (!integration) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      const history = await runHistoryRepository.findByIntegration(tenantId, integrationId);
      return reply.status(200).send(history);
    },
  );
}
