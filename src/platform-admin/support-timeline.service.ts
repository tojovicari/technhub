import { AlertRepository } from '../alerts/alert.repository';
import type { AlertEntry } from '../alerts/alert.types';
import { BillingEventRepository } from '../billing/billing-event.repository';
import type { BillingEvent } from '../billing/billing.types';
import { BillingService } from '../billing/billing.service';
import { SubscriptionRepository } from '../billing/subscription.repository';
import { ProviderIntegrationRepository } from '../integrations/repositories/provider-integration.repository';
import { TeamRepository } from '../identity/team.repository';
import { UserRepository } from '../identity/user.repository';
import { PlatformOperatorAuditLogRepository, type PlatformOperatorAuditLogEntry } from './platform-operator-audit-log.repository';
import { PlatformTenantNoteRepository, type PlatformTenantNote } from './platform-tenant-note.repository';

interface AuditTimelineItem {
  readonly kind: 'audit';
  readonly occurredAt: Date;
  readonly entry: PlatformOperatorAuditLogEntry;
}
interface AlertTimelineItem {
  readonly kind: 'alert';
  readonly occurredAt: Date;
  readonly entry: AlertEntry;
}
interface BillingEventTimelineItem {
  readonly kind: 'billing_event';
  readonly occurredAt: Date;
  readonly entry: BillingEvent;
}
interface NoteTimelineItem {
  readonly kind: 'note';
  readonly occurredAt: Date;
  readonly entry: PlatformTenantNote;
}

export type TimelineItem = AuditTimelineItem | AlertTimelineItem | BillingEventTimelineItem | NoteTimelineItem;

export interface SupportHealthSnapshot {
  readonly subscription: {
    readonly status: string;
    readonly pastDueSince: string | null;
    readonly cancelledAt: string | null;
    readonly trialEndsAt: string | null;
    readonly currentPeriodEnd: string | null;
  } | null;
  readonly openAlertCountsByType: Readonly<Record<string, number>>;
  readonly usage: {
    readonly users: { readonly current: number; readonly limit: number | null };
    readonly teams: { readonly current: number; readonly limit: number | null };
    readonly integrations: { readonly current: number; readonly limit: number | null };
  };
  readonly onboardingIncomplete: boolean;
}

/**
 * Composição de leitura pro painel de atendimento — funde as 4 fontes de
 * histórico de um tenant numa timeline só, e expõe sinais crus de saúde
 * (sem pontuação/fórmula inventada, decisão explícita — "Semântica
 * Flexível" do `CLAUDE.md`). Nunca escreve nada, só lê e agrega.
 */
export class SupportTimelineService {
  constructor(
    private readonly auditLogRepository: PlatformOperatorAuditLogRepository = new PlatformOperatorAuditLogRepository(),
    private readonly alertRepository: AlertRepository = new AlertRepository(),
    private readonly billingEventRepository: BillingEventRepository = new BillingEventRepository(),
    private readonly tenantNoteRepository: PlatformTenantNoteRepository = new PlatformTenantNoteRepository(),
    private readonly subscriptionRepository: SubscriptionRepository = new SubscriptionRepository(),
    private readonly billingService: BillingService = new BillingService(),
    private readonly userRepository: UserRepository = new UserRepository(),
    private readonly teamRepository: TeamRepository = new TeamRepository(),
    private readonly integrationRepository: ProviderIntegrationRepository = new ProviderIntegrationRepository(),
  ) {}

  /**
   * Cada fonte já busca até `limit` itens próprios, então o corte final
   * (`slice(0, limit)`) nunca perde nada que devesse aparecer na primeira
   * página combinada.
   */
  async getTimeline(tenantId: string, limit: number): Promise<readonly TimelineItem[]> {
    const [auditEntries, alerts, billingEvents, notes] = await Promise.all([
      this.auditLogRepository.findRecent({ tenantId, limit }),
      this.alertRepository.findAllByTenant(tenantId, { limit }),
      this.billingEventRepository.findByTenant(tenantId, limit),
      this.tenantNoteRepository.findByTenant(tenantId, limit),
    ]);

    const items: TimelineItem[] = [
      ...auditEntries.map((entry): AuditTimelineItem => ({ kind: 'audit', occurredAt: entry.createdAt, entry })),
      ...alerts.map((entry): AlertTimelineItem => ({ kind: 'alert', occurredAt: entry.createdAt, entry })),
      ...billingEvents.map((entry): BillingEventTimelineItem => ({ kind: 'billing_event', occurredAt: entry.occurredAt, entry })),
      ...notes.map((entry): NoteTimelineItem => ({ kind: 'note', occurredAt: entry.createdAt, entry })),
    ];

    items.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return items.slice(0, limit);
  }

  /**
   * Sinais crus, sem `score`/`riskLevel` — o front decide como visualizar.
   * `onboardingIncomplete` reaproveita o sinal já cacheado pelo scan
   * periódico (`AlertRepository.hasOpenAlert`), sem recalcular
   * `teamCount`/`userCount` de novo aqui.
   */
  async getHealthSnapshot(tenantId: string): Promise<SupportHealthSnapshot> {
    const [subscription, openAlertCountsByType, userCount, teams, integrations, maxUsers, maxTeams, maxIntegrations, onboardingIncomplete] =
      await Promise.all([
        this.subscriptionRepository.findByTenantId(tenantId),
        this.alertRepository.countOpenByType(tenantId),
        this.userRepository.countByTenant(tenantId),
        this.teamRepository.findAllByTenant(tenantId),
        this.integrationRepository.listByTenant(tenantId),
        this.billingService.getResourceLimit(tenantId, 'maxUsers'),
        this.billingService.getResourceLimit(tenantId, 'maxTeams'),
        this.billingService.getResourceLimit(tenantId, 'maxIntegrations'),
        this.alertRepository.hasOpenAlert(tenantId, 'onboarding_incomplete', null),
      ]);

    return {
      subscription: subscription
        ? {
            status: subscription.status,
            pastDueSince: subscription.pastDueSince?.toISOString() ?? null,
            cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
      openAlertCountsByType,
      usage: {
        users: { current: userCount, limit: maxUsers },
        teams: { current: teams.length, limit: maxTeams },
        integrations: { current: integrations.length, limit: maxIntegrations },
      },
      onboardingIncomplete,
    };
  }
}
