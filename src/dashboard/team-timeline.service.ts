import { TimelineEventRepository } from './timeline-event.repository';
import { TeamMetricConfigHistoryRepository, type MetricConfigType } from './team-metric-config-history.repository';
import { TeamProfileService } from './team-profile.service';
import { IncidentRepository } from '../integrations/repositories/incident.repository';
import type { CanonicalIncident } from '../integrations/core/canonical.types';

export type TeamTimelineItem =
  | {
      readonly type: 'manual_event';
      readonly date: string;
      readonly teamId: string | null;
      readonly title: string;
      readonly description: string | null;
      readonly createdByEmail: string;
    }
  | {
      readonly type: 'config_change';
      readonly date: string;
      readonly teamId: string | null;
      readonly configType: MetricConfigType;
      readonly changedByEmail: string;
    }
  | {
      readonly type: 'incident';
      readonly date: string;
      readonly title: string;
      readonly severity: CanonicalIncident['severity'];
      readonly status: CanonicalIncident['status'];
      readonly resolvedAt: string | null;
    }
  | {
      readonly type: 'epic_started' | 'epic_completed';
      readonly date: string;
      readonly epicId: string;
      readonly epicName: string | null;
    };

export interface TeamTimeline {
  readonly items: readonly TeamTimelineItem[];
}

/**
 * Consolida marcadores pontuais (não métrica — isso continua em
 * `dora/history`/`profile/history`, série contínua, formato incompatível)
 * de 4 fontes numa timeline só, ordenada por `date`. Existe pra evitar que
 * a tela cresça uma chamada paralela por fonte nova (ver
 * `cto_ai_front/.spec/proposals/team-timeline.md`) — front busca isto uma
 * vez por janela, em vez de `timeline-events` + `configChanges` +
 * incidentes + épicos separados.
 *
 * Épicos são a única fonte com "intervalo" (início/fim), não ponto único —
 * viram até 2 itens (`epic_started`/`epic_completed`), só o(s) lado(s) que
 * cai(em) dentro de `[from, to]`, reaproveitando
 * `TeamProfileService.getEpicBreakdown` (mesma query/merge que alimenta
 * `GET .../profile/epics`) em vez de duplicar a query de datas.
 */
export class TeamTimelineService {
  constructor(
    private readonly timelineEventRepository: TimelineEventRepository = new TimelineEventRepository(),
    private readonly teamMetricConfigHistoryRepository: TeamMetricConfigHistoryRepository = new TeamMetricConfigHistoryRepository(),
    private readonly incidentRepository: IncidentRepository = new IncidentRepository(),
    private readonly teamProfileService: TeamProfileService = new TeamProfileService(),
  ) {}

  /** `null` se o time não existe — checagem via `getEpicBreakdown` (já valida o time), sem depender de `TeamRepository` à parte. */
  async getTimeline(tenantId: string, teamId: string, from: Date, to: Date): Promise<TeamTimeline | null> {
    const epicBreakdown = await this.teamProfileService.getEpicBreakdown(tenantId, teamId);
    if (epicBreakdown === null) {
      return null;
    }

    const [manualEvents, configChanges, incidents] = await Promise.all([
      this.timelineEventRepository.findInRange(tenantId, teamId, from, to),
      this.teamMetricConfigHistoryRepository.findChangesInRange(tenantId, teamId, from, to),
      this.incidentRepository.findInRangeByTeam(tenantId, teamId, from, to),
    ]);

    const items: TeamTimelineItem[] = [];

    for (const event of manualEvents) {
      items.push({
        type: 'manual_event',
        date: event.eventDate.toISOString(),
        teamId: event.teamId,
        title: event.title,
        description: event.description,
        createdByEmail: event.createdByEmail,
      });
    }

    for (const change of configChanges) {
      items.push({
        type: 'config_change',
        date: change.changedAt.toISOString(),
        teamId: change.teamId,
        configType: change.configType,
        changedByEmail: change.changedByEmail,
      });
    }

    for (const incident of incidents) {
      items.push({
        type: 'incident',
        date: incident.triggeredAt.toISOString(),
        title: incident.title,
        severity: incident.severity,
        status: incident.status,
        resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
      });
    }

    if (epicBreakdown.available) {
      for (const entry of epicBreakdown.epics) {
        if (!entry.epic) {
          continue;
        }

        const startedAt = entry.startedAt ? new Date(entry.startedAt) : null;
        if (startedAt && startedAt >= from && startedAt <= to) {
          items.push({ type: 'epic_started', date: startedAt.toISOString(), epicId: entry.epic.id, epicName: entry.epic.name });
        }

        const completedAt = entry.completedAt ? new Date(entry.completedAt) : null;
        if (completedAt && completedAt >= from && completedAt <= to) {
          items.push({
            type: 'epic_completed',
            date: completedAt.toISOString(),
            epicId: entry.epic.id,
            epicName: entry.epic.name,
          });
        }
      }
    }

    items.sort((a, b) => a.date.localeCompare(b.date));

    return { items };
  }
}
