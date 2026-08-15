import type { FastifyInstance } from 'fastify';
import { SyncOrchestrator } from '../../integrations/core/sync.orchestrator';
import { ProviderIntegrationRepository } from '../../integrations/repositories/provider-integration.repository';
import { TenantRepository } from '../../identity/tenant.repository';
import type { SyncContext } from '../../integrations/core/canonical.types';
import { requireInternalToken } from '../middleware/require-internal-token';
import { AlertRepository } from '../../alerts/alert.repository';
import { UserRepository } from '../../identity/user.repository';
import { TeamRepository } from '../../identity/team.repository';
import { TeamMembershipRepository } from '../../identity/team-membership.repository';
import { BillingService } from '../../billing/billing.service';

/** Integrações mais novas que isso são ignoradas pelo scan de staleness — dá tempo do primeiro sync rodar. */
const STALE_SCAN_GRACE_PERIOD_MS = 60 * 60 * 1000;

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
  alertRepository: AlertRepository = new AlertRepository(),
  userRepository: UserRepository = new UserRepository(),
  teamRepository: TeamRepository = new TeamRepository(),
  teamMembershipRepository: TeamMembershipRepository = new TeamMembershipRepository(),
  billingService: BillingService = new BillingService(),
): void {
  /**
   * Avança **toda** integração `ACTIVE` *ou* `ERROR` de todo tenant `ACTIVE`
   * em uma sync call cada — sem heurística de "precisa sincronizar ou não"
   * (uma sync incremental normal já é barata; uma em backfill avança mais
   * uma janela/página).
   *
   * `ERROR` entra na lista de propósito (mudou nesta rodada) — uma
   * integração real ficou travada em `ERROR` por mais de um ano porque o
   * cron só reprocessava `ACTIVE`: uma falha passageira virava permanente
   * silenciosamente, sem ninguém saber até checar manualmente. O custo de
   * reprocessar diariamente uma credencial genuinamente quebrada é uma
   * chamada HTTP a mais por dia (o `SyncOrchestrator` já isola falha por
   * integração, nunca propaga) — bem mais barato que o risco de esconder um
   * problema recuperável (rate limit, blip de rede, cursor expirado — ver
   * `cursorInvalidated` em `provider-integration.repository.ts`) atrás de
   * "precisa de intervenção manual" indefinidamente.
   */
  server.post('/internal/sync', { preHandler: [requireInternalToken] }, async (_request, reply) => {
    const tenants = await tenantRepository.findAllActive();

    // Um tenant de cada vez era sequencial (só SELECT+decrypt, bem mais
    // barato que a sync em si) — em paralelo agora, com o pool de conexões
    // já dimensionado (`DATABASE_POOL_MAX`) pra dar a contrapressão certa
    // sem precisar de lote manual aqui também (diferente de `runBatch`, que
    // sim dispara chamada de rede por integração).
    const targetsByTenant = await Promise.all(
      tenants.map(async (tenant): Promise<readonly ScheduledSyncTarget[]> => {
        const integrations = await integrationRepository.listByTenant(tenant.id);
        const activeIntegrations = integrations.filter(
          (integration) => integration.status === 'ACTIVE' || integration.status === 'ERROR',
        );

        const resolved = await Promise.all(
          activeIntegrations.map(async (integration): Promise<ScheduledSyncTarget | null> => {
            // Nunca deixa uma credencial que falha ao descriptografar
            // (dado corrompido, ou a chave de criptografia mudou) derrubar
            // o `Promise.all` inteiro — isso quebraria o cron pra todas as
            // outras integrações deste tenant (ou de todos, dependendo de
            // como a rejeição se propagaria pra fora), o oposto do
            // isolamento de falha por integração que este endpoint já
            // documenta acima. Mesmo espírito de `resolveKnownExternalUserIds`
            // em `sync.orchestrator.ts`: falha soft, loga, segue sem essa
            // integração nesta rodada.
            let stored;
            try {
              stored = await integrationRepository.getDecryptedCredentialsById(tenant.id, integration.id);
            } catch (error) {
              console.error(
                `[internal/sync] Falha ao descriptografar credenciais da integração ${integration.id} (${integration.provider}, tenant ${tenant.id}): ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            }

            if (!stored) {
              return null;
            }

            return {
              provider: integration.provider,
              context: {
                providerName: integration.provider,
                tenantId: tenant.id,
                integrationId: integration.id,
                teamId: integration.teamId ?? undefined,
                credentials: stored.credentials,
                cursor: stored.lastCursor,
                since: stored.lastSyncedAt ?? undefined,
                triggeredBy: 'cron',
                epicLinkFieldId: stored.epicLinkFieldId,
              },
            };
          }),
        );

        return resolved.filter((target): target is ScheduledSyncTarget => target !== null);
      }),
    );

    const targets: ScheduledSyncTarget[] = targetsByTenant.flat();

    const results = await syncOrchestrator.runBatch(targets.map((target) => target.context));

    const errors: SyncError[] = [];
    let succeeded = 0;

    await Promise.all(
      targets.map(async (target, index) => {
        const result = results[index];

        const outcome = await integrationRepository.markSyncOutcome(target.context.tenantId, target.context.integrationId, {
          success: result.success,
          nextCursor: result.nextCursor,
          cursorInvalidated: result.cursorInvalidated,
          epicLinkFieldId: result.epicLinkFieldId,
        });
        await alertRepository.evaluateReconnectionAlert(
          target.context.tenantId,
          target.context.integrationId,
          target.provider,
          outcome.consecutiveFailures,
        );

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

  /**
   * Scan leve, read-only na maior parte (poucos INSERT/UPDATE condicionais),
   * rodado periodicamente (`.github/workflows/alerts-staleness-scan.yml`)
   * pra tudo que precisa ser *checado* em vez de reagir a um evento — hoje
   * três coisas, todas por tenant:
   *
   * 1. `sync_stale` — dispara/fecha pra toda integração ACTIVE/ERROR (não
   *    DISABLED) cujo `last_synced_at` não é de hoje. Integrações criadas
   *    há menos de `STALE_SCAN_GRACE_PERIOD_MS` são ignoradas de propósito:
   *    dar tempo do primeiro sync rodar antes de gritar "desatualizado".
   * 2. `onboarding_incomplete` — tenant sem nenhum time e sem ninguém além
   *    do ADMIN bootstrap (ver `AlertRepository.evaluateOnboardingAlert`).
   * 3. `team_without_contributors` — cada time do tenant sem nenhuma linha
   *    em `team_memberships` (ver `AlertRepository.evaluateTeamContributorsAlert`).
   * 4. `users_limit_reached`/`teams_limit_reached`/`integrations_limit_reached`
   *    — resolve sozinho quando a contagem volta a caber sob o teto do
   *    plano (`BillingService.getResourceLimit`), e também cria
   *    proativamente se um tenant já estiver acima do limite sem ninguém
   *    ter tentado criar nada recentemente (ex: downgrade de plano) — o
   *    bloqueio em si (`403`) acontece na hora, nas rotas de criação
   *    (`users.routes.ts`/`teams.routes.ts`/`integrations.routes.ts`), não
   *    aqui.
   *
   * Todos com o mesmo padrão de dedup: só cria se não houver um alerta
   * ABERTO já daquele tipo/assunto; só resolve se existir um aberto e a
   * condição deixou de valer. "Hoje" (item 1) é data UTC do momento do
   * scan, não o fuso do tenant.
   */
  server.post('/internal/alerts/scan-stale', { preHandler: [requireInternalToken] }, async (_request, reply) => {
    const tenants = await tenantRepository.findAllActive();
    const todayUtc = new Date().toISOString().slice(0, 10);

    let integrationsScanned = 0;
    let teamsScanned = 0;
    let alertsCreated = 0;
    let alertsResolved = 0;

    await Promise.all(
      tenants.map(async (tenant) => {
        const [integrations, teams, userCount] = await Promise.all([
          integrationRepository.listByTenant(tenant.id),
          teamRepository.findAllByTenant(tenant.id),
          userRepository.countByTenant(tenant.id),
        ]);

        await Promise.all([
          ...integrations
            .filter((integration) => integration.status !== 'DISABLED')
            .filter((integration) => Date.now() - integration.createdAt.getTime() > STALE_SCAN_GRACE_PERIOD_MS)
            .map(async (integration) => {
              integrationsScanned += 1;
              const syncedToday =
                integration.lastSyncedAt !== null && integration.lastSyncedAt.toISOString().slice(0, 10) === todayUtc;

              try {
                if (!syncedToday) {
                  if (!(await alertRepository.hasOpenAlert(tenant.id, 'sync_stale', integration.id))) {
                    await alertRepository.create(tenant.id, {
                      type: 'sync_stale',
                      severity: 'warning',
                      title: 'Sincronização desatualizada',
                      message: `A integração "${integration.provider}" não sincroniza com sucesso desde ${
                        integration.lastSyncedAt?.toISOString() ?? 'nunca'
                      }.`,
                      integrationId: integration.id,
                      metadata: { provider: integration.provider, lastSyncedAt: integration.lastSyncedAt },
                    });
                    alertsCreated += 1;
                  }
                } else {
                  await alertRepository.resolveOpenAlerts(tenant.id, 'sync_stale', integration.id);
                  alertsResolved += 1;
                }
              } catch (error) {
                console.error(
                  `[internal/alerts/scan-stale] Falha ao avaliar integração ${integration.id}: ${(error as Error).message}`,
                );
              }
            }),

          (async () => {
            const hadOpen = await alertRepository.hasOpenAlert(tenant.id, 'onboarding_incomplete', null);
            await alertRepository.evaluateOnboardingAlert(tenant.id, teams.length, userCount);
            const stillOpen = await alertRepository.hasOpenAlert(tenant.id, 'onboarding_incomplete', null);
            if (!hadOpen && stillOpen) alertsCreated += 1;
            if (hadOpen && !stillOpen) alertsResolved += 1;
          })(),

          (async () => {
            const [maxUsers, maxTeams, maxIntegrations] = await Promise.all([
              billingService.getResourceLimit(tenant.id, 'maxUsers'),
              billingService.getResourceLimit(tenant.id, 'maxTeams'),
              billingService.getResourceLimit(tenant.id, 'maxIntegrations'),
            ]);

            await Promise.all(
              (
                [
                  ['users_limit_reached', userCount, maxUsers],
                  ['teams_limit_reached', teams.length, maxTeams],
                  ['integrations_limit_reached', integrations.length, maxIntegrations],
                ] as const
              ).map(async ([type, currentCount, limit]) => {
                const hadOpen = await alertRepository.hasOpenAlert(tenant.id, type, null);
                await alertRepository.evaluateResourceLimitAlert(tenant.id, type, currentCount, limit);
                const stillOpen = await alertRepository.hasOpenAlert(tenant.id, type, null);
                if (!hadOpen && stillOpen) alertsCreated += 1;
                if (hadOpen && !stillOpen) alertsResolved += 1;
              }),
            );
          })(),

          ...teams.map(async (team) => {
            teamsScanned += 1;
            const memberships = await teamMembershipRepository.findByTeamWithUser(tenant.id, team.id);
            const hasContributors = memberships.length > 0;

            try {
              const hadOpen = await alertRepository.hasOpenAlert(tenant.id, 'team_without_contributors', null, team.id);
              await alertRepository.evaluateTeamContributorsAlert(tenant.id, team.id, team.name, hasContributors);
              if (!hadOpen && !hasContributors) alertsCreated += 1;
              if (hadOpen && hasContributors) alertsResolved += 1;
            } catch (error) {
              console.error(
                `[internal/alerts/scan-stale] Falha ao avaliar contribuidores do time ${team.id}: ${(error as Error).message}`,
              );
            }
          }),
        ]);
      }),
    );

    return reply
      .status(200)
      .send({ tenantsScanned: tenants.length, integrationsScanned, teamsScanned, alertsCreated, alertsResolved });
  });
}
