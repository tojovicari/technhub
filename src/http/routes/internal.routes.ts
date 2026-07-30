import type { FastifyInstance } from 'fastify';
import { SyncOrchestrator } from '../../integrations/core/sync.orchestrator';
import { ProviderIntegrationRepository } from '../../integrations/repositories/provider-integration.repository';
import { TenantRepository } from '../../identity/tenant.repository';
import type { SyncContext } from '../../integrations/core/canonical.types';
import { requireInternalToken } from '../middleware/require-internal-token';

interface SyncError {
  readonly tenantId: string;
  readonly integrationId: string;
  readonly provider: string;
  readonly error: string;
}

/** Uma entrada por integração ativa — carrega o contexto já resolvido junto do resultado, pra não precisar re-casar depois. */
interface ScheduledSyncTarget {
  readonly context: SyncContext;
  readonly provider: string;
}

/**
 * Rotas internas (`/internal/*`) — sem `tenantId` na URL, autenticadas por
 * segredo compartilhado (`requireInternalToken`), não por JWT de usuário.
 * Alimentam o driver externo de sync (`.github/workflows/sync.yml`), que
 * substitui o "alguém precisa clicar em sincronizar" por um agendamento —
 * ver `SyncOrchestrator`, doc de classe: "jobs de cron/queue... dependem
 * apenas deste orquestrador", desenho que já existia mas nunca foi
 * conectado a um disparo de verdade.
 */
export function registerInternalRoutes(
  server: FastifyInstance,
  tenantRepository: TenantRepository = new TenantRepository(),
  integrationRepository: ProviderIntegrationRepository = new ProviderIntegrationRepository(),
  syncOrchestrator: SyncOrchestrator = new SyncOrchestrator(),
): void {
  /**
   * Avança **toda** integração `ACTIVE` de todo tenant `ACTIVE` em uma sync
   * call cada — sem heurística de "precisa sincronizar ou não" (uma sync
   * incremental normal já é barata; uma em backfill avança mais uma
   * janela/página). Integrações em `ERROR` ficam de fora de propósito —
   * exigem intervenção manual, não bate várias vezes por hora numa
   * credencial já sabidamente quebrada.
   */
  server.post('/internal/sync', { preHandler: [requireInternalToken] }, async (_request, reply) => {
    const tenants = await tenantRepository.findAllActive();

    const targets: ScheduledSyncTarget[] = [];
    for (const tenant of tenants) {
      const integrations = await integrationRepository.listByTenant(tenant.id);

      for (const integration of integrations) {
        if (integration.status !== 'ACTIVE') {
          continue;
        }

        const stored = await integrationRepository.getDecryptedCredentialsById(tenant.id, integration.id);
        if (!stored) {
          continue;
        }

        targets.push({
          provider: integration.provider,
          context: {
            providerName: integration.provider,
            tenantId: tenant.id,
            integrationId: integration.id,
            teamId: integration.teamId ?? undefined,
            credentials: stored.credentials,
            cursor: stored.lastCursor,
            since: stored.lastSyncedAt ?? undefined,
          },
        });
      }
    }

    const results = await syncOrchestrator.runBatch(targets.map((target) => target.context));

    const errors: SyncError[] = [];
    let succeeded = 0;

    await Promise.all(
      targets.map(async (target, index) => {
        const result = results[index];

        await integrationRepository.markSyncOutcome(target.context.tenantId, target.context.integrationId, {
          success: result.success,
          nextCursor: result.nextCursor,
        });

        if (result.success) {
          succeeded += 1;
        } else {
          errors.push({
            tenantId: target.context.tenantId,
            integrationId: target.context.integrationId,
            provider: target.provider,
            error: result.errors?.join('; ') ?? 'Falha desconhecida.',
          });
        }
      }),
    );

    return reply.status(200).send({
      integrationsProcessed: targets.length,
      succeeded,
      failed: errors.length,
      errors,
    });
  });
}
