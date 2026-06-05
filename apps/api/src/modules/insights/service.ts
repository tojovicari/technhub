import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type {
  InsightsBacklogQualityQuery,
  InsightsIncidentsQuery,
  InsightsOverviewQuery,
  InsightsPlanningConfidenceQuery,
  InsightsRecomputeBody,
  InsightsTrendsQuery
} from './schema.js';

type GroupContext = {
  group: { id: string; key: string; name: string };
  projectIds: string[];
  serviceMatchers: string[];
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function buildPeriodFromWindow(windowDays: number) {
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return {
    window_days: windowDays,
    from: from.toISOString(),
    to: to.toISOString()
  };
}

function parsePeriodOrDefault(period?: string) {
  const now = new Date();

  if (!period) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    return {
      label: `${year}-${String(month + 1).padStart(2, '0')}`,
      start,
      end
    };
  }

  const quarterMatch = period.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const monthStart = (quarter - 1) * 3;
    const start = new Date(Date.UTC(year, monthStart, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthStart + 3, 0, 23, 59, 59, 999));
    return { label: period, start, end };
  }

  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) {
    return null;
  }

  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return {
    label: period,
    start,
    end
  };
}

function computeRiskLevel(score: number): 'low' | 'watch' | 'high' | 'critical' {
  if (score >= 80) return 'low';
  if (score >= 65) return 'watch';
  if (score >= 45) return 'high';
  return 'critical';
}

function toLowerSet(values: string[]) {
  return new Set(values.map((v) => v.toLowerCase()));
}

function incidentMatchesGroup(affectedServices: string[], serviceMatchers: Set<string>) {
  if (serviceMatchers.size === 0) return true;
  if (!affectedServices || affectedServices.length === 0) return false;
  return affectedServices.some((service) => serviceMatchers.has(service.toLowerCase()));
}

function computePlanningLevel(score: number): 'high' | 'watch' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 55) return 'watch';
  return 'low';
}

function computeBacklogLevel(score: number): 'good' | 'watch' | 'alert' {
  if (score >= 75) return 'good';
  if (score >= 55) return 'watch';
  return 'alert';
}

function groupByEpicId<T extends { epicId: string | null }>(items: T[]) {
  const map = new Map<string, T[]>();

  for (const item of items) {
    if (!item.epicId) continue;
    const current = map.get(item.epicId) ?? [];
    current.push(item);
    map.set(item.epicId, current);
  }

  return map;
}

function calculateBacklogQuality(tasks: Array<{
  status: string;
  createdAt: Date;
  updatedAt: Date;
  dueDate: Date | null;
  completedAt: Date | null;
}>, staleDays: number) {
  const now = new Date();
  const backlogTasks = tasks.filter((task) => task.status === 'backlog' || task.status === 'todo');
  const activeTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const staleThreshold = staleDays * 24 * 60 * 60 * 1000;
  const churnWindow = Math.min(14, Math.max(3, Math.floor(staleDays / 2))) * 24 * 60 * 60 * 1000;

  const backlogAges = backlogTasks.map((task) => (now.getTime() - task.createdAt.getTime()) / 86_400_000);
  const staleCount = backlogTasks.filter((task) => now.getTime() - task.updatedAt.getTime() >= staleThreshold).length;
  const overdueCount = activeTasks.filter((task) => task.dueDate !== null && task.dueDate.getTime() < now.getTime()).length;
  const flowRegressionCount = tasks.filter(
    (task) => task.completedAt !== null && task.status !== 'done' && task.status !== 'cancelled'
  ).length;
  const churnCount = backlogTasks.filter((task) => {
    const age = now.getTime() - task.createdAt.getTime();
    const recency = now.getTime() - task.updatedAt.getTime();
    return age >= 3 * 24 * 60 * 60 * 1000 && recency <= churnWindow;
  }).length;

  const backlogAgingIndexDays = median(backlogAges);
  const staleBacklogRate = backlogTasks.length === 0 ? 0 : staleCount / backlogTasks.length;
  const overdueBacklogRate = activeTasks.length === 0 ? 0 : overdueCount / activeTasks.length;
  const flowRegressionRate = tasks.length === 0 ? 0 : flowRegressionCount / tasks.length;
  const backlogChurnProxy = backlogTasks.length === 0 ? 0 : churnCount / backlogTasks.length;

  const score = Math.round(
    clamp(
      100 - (staleBacklogRate * 40 + overdueBacklogRate * 25 + flowRegressionRate * 20 + backlogChurnProxy * 15),
      0,
      100
    )
  );

  const warnings: string[] = [];
  if (backlogTasks.length === 0) warnings.push('no_backlog_items_found');
  if (staleBacklogRate > 0.5) warnings.push('stale_backlog_above_threshold');
  if (flowRegressionRate > 0) warnings.push('flow_regression_uses_proxy');

  return {
    backlog_quality: {
      score,
      level: computeBacklogLevel(score),
      backlog_aging_index_days: backlogAgingIndexDays == null ? null : round(backlogAgingIndexDays, 1),
      stale_backlog_rate: round(staleBacklogRate, 2),
      overdue_backlog_rate: round(overdueBacklogRate, 2),
      flow_regression_rate: round(flowRegressionRate, 2),
      backlog_churn_proxy: round(backlogChurnProxy, 2)
    },
    warnings,
    backlogTasks,
    activeTasks,
    staleCount,
    overdueCount,
    flowRegressionCount,
    churnCount
  };
}

type BucketGranularity = 'daily' | 'weekly';

type TrendBucket = {
  bucket: string;
  start: Date;
  end: Date;
  value: number;
};

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function startOfUtcWeek(date: Date) {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - offset);
  return startOfUtcDay(start);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function granularityStepDays(granularity: BucketGranularity) {
  return granularity === 'daily' ? 1 : 7;
}

function alignToBucketStart(date: Date, granularity: BucketGranularity) {
  return granularity === 'daily' ? startOfUtcDay(date) : startOfUtcWeek(date);
}

function buildTrendBuckets(windowStart: Date, windowEnd: Date, granularity: BucketGranularity): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  let cursor = alignToBucketStart(windowStart, granularity);
  const stepDays = granularityStepDays(granularity);

  while (cursor <= windowEnd) {
    const bucketEnd = granularity === 'daily'
      ? new Date(cursor.getTime() + 86_400_000 - 1)
      : new Date(cursor.getTime() + 7 * 86_400_000 - 1);

    buckets.push({
      bucket: toDateKey(cursor),
      start: cursor,
      end: bucketEnd,
      value: 0
    });

    cursor = addDays(cursor, stepDays);
  }

  return buckets;
}

function bucketForDate(date: Date, granularity: BucketGranularity) {
  return toDateKey(alignToBucketStart(date, granularity));
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function zScore(value: number, values: number[]) {
  const avg = mean(values);
  const deviation = standardDeviation(values);
  if (deviation === 0) return 0;
  return (value - avg) / deviation;
}

async function getLatestResourceGroupSnapshot(tenantId: string, groupId: string) {
  return prisma.resourceGroupMetricSnapshot.findFirst({
    where: { tenantId, resourceGroupId: groupId },
    orderBy: { computedAt: 'desc' }
  });
}

async function persistResourceGroupSnapshot(input: {
  tenantId: string;
  resourceGroupId: string;
  periodKey: string;
  metricType: 'dora' | 'sla' | 'cogs' | 'health';
  payload: Record<string, unknown>;
  lineage?: Record<string, unknown>;
}) {
  return prisma.resourceGroupMetricSnapshot.create({
    data: {
      tenantId: input.tenantId,
      resourceGroupId: input.resourceGroupId,
      periodKey: input.periodKey,
      metricType: input.metricType,
      payload: input.payload as Prisma.InputJsonValue,
      lineage: input.lineage as Prisma.InputJsonValue | undefined,
      version: 1
    }
  });
}

function freshnessFromSnapshot(snapshot: Awaited<ReturnType<typeof getLatestResourceGroupSnapshot>>) {
  if (!snapshot) {
    return {
      snapshot_generated_at: null,
      snapshot_age_minutes: null,
      stale: true
    };
  }

  const ageMinutes = (Date.now() - snapshot.computedAt.getTime()) / 60_000;
  return {
    snapshot_generated_at: snapshot.computedAt.toISOString(),
    snapshot_age_minutes: Math.round(ageMinutes),
    stale: ageMinutes > 24 * 60
  };
}

async function getGroupContext(tenantId: string, groupId: string): Promise<GroupContext | null> {
  const group = await prisma.resourceGroup.findFirst({
    where: { id: groupId, tenantId },
    select: {
      id: true,
      key: true,
      name: true,
      resources: {
        select: {
          projectId: true,
          project: {
            select: {
              name: true,
              key: true
            }
          }
        }
      }
    }
  });

  if (!group) return null;

  const projectIds = Array.from(new Set(group.resources.map((resource) => resource.projectId)));
  const serviceMatchers = Array.from(
    new Set(
      group.resources
        .flatMap((resource) => [resource.project.name, resource.project.key])
        .filter(Boolean)
        .map((value) => value.toLowerCase())
    )
  );

  return {
    group: {
      id: group.id,
      key: group.key,
      name: group.name
    },
    projectIds,
    serviceMatchers
  };
}

export async function getInsightsOverviewByResourceGroup(
  tenantId: string,
  groupId: string,
  query: InsightsOverviewQuery
) {
  const context = await getGroupContext(tenantId, groupId);
  if (!context) return null;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const whereByGroup = context.projectIds.length > 0
    ? { projectId: { in: context.projectIds } }
    : { projectId: '00000000-0000-0000-0000-000000000000' };

  const [throughput7d, throughput30d, previousThroughput7d, hasIncidentIntegration, incidents30d] = await Promise.all([
    prisma.task.count({
      where: {
        tenantId,
        ...whereByGroup,
        status: 'done',
        completedAt: { gte: sevenDaysAgo, lte: now }
      }
    }),
    prisma.task.count({
      where: {
        tenantId,
        ...whereByGroup,
        status: 'done',
        completedAt: { gte: thirtyDaysAgo, lte: now }
      }
    }),
    prisma.task.count({
      where: {
        tenantId,
        ...whereByGroup,
        status: 'done',
        completedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo }
      }
    }),
    prisma.integrationConnection.findFirst({
      where: {
        tenantId,
        provider: { in: ['opsgenie', 'incident_io'] },
        status: 'active'
      },
      select: { id: true }
    }),
    prisma.incidentEvent.findMany({
      where: {
        tenantId,
        openedAt: { gte: thirtyDaysAgo, lte: now }
      },
      select: {
        openedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        affectedServices: true
      }
    })
  ]);

  const serviceMatchers = toLowerSet(context.serviceMatchers);
  const scopedIncidents30d = incidents30d.filter((incident) =>
    incidentMatchesGroup(incident.affectedServices, serviceMatchers)
  );
  const incidents7d = scopedIncidents30d.filter((incident) => incident.openedAt >= sevenDaysAgo);

  const mttrHours = median(
    scopedIncidents30d
      .filter((incident) => incident.resolvedAt)
      .map((incident) => (incident.resolvedAt!.getTime() - incident.openedAt.getTime()) / 3_600_000)
  );

  const mttaMinutes = median(
    scopedIncidents30d
      .filter((incident) => incident.acknowledgedAt)
      .map((incident) => (incident.acknowledgedAt!.getTime() - incident.openedAt.getTime()) / 60_000)
  );

  const previousRate = previousThroughput7d / 7;
  const currentRate = throughput7d / 7;
  const trend = currentRate > previousRate * 1.1 ? 'up' : currentRate < previousRate * 0.9 ? 'down' : 'stable';

  const incidentPenalty = Math.min(40, incidents7d.length * 4 + scopedIncidents30d.length);
  const throughputPenalty = trend === 'down' ? 15 : trend === 'stable' ? 6 : 0;
  const recoveryPenalty = mttrHours == null ? 4 : mttrHours > 8 ? 20 : mttrHours > 4 ? 12 : mttrHours > 2 ? 6 : 0;

  const healthScore = Math.max(0, Math.min(100, Math.round(100 - incidentPenalty - throughputPenalty - recoveryPenalty)));
  const riskLevel = computeRiskLevel(healthScore);

  const warnings: string[] = [];
  if (!hasIncidentIntegration) warnings.push('incident_integration_not_configured');
  if (context.projectIds.length === 0) warnings.push('resource_group_without_projects');
  if (context.projectIds.length > 0 && scopedIncidents30d.length === 0) warnings.push('no_incident_matches_resource_group');

  const drivers: string[] = [];
  if (incidentPenalty >= 12) drivers.push('incident_load');
  if (trend === 'down') drivers.push('throughput_drop');
  if (recoveryPenalty >= 12) drivers.push('recovery_time_high');
  if (!hasIncidentIntegration) drivers.push('incident_visibility_gap');
  if (drivers.length === 0) drivers.push('stable_execution');

  const recommendations = [
    trend === 'down'
      ? {
          type: 'stabilize_throughput',
          priority: 'high',
          message: 'Reduza WIP e proteja capacidade para recuperar o throughput semanal.',
          context: { throughput_7d: throughput7d, throughput_previous_7d: previousThroughput7d }
        }
      : {
          type: 'sustain_current_flow',
          priority: 'medium',
          message: 'Mantenha a cadencia atual e monitore sinais de incidente no grupo.',
          context: { throughput_7d: throughput7d }
        }
  ];

    const summaryPayload = {
      health_score: healthScore,
      risk_level: riskLevel,
      throughput_7d: throughput7d,
      throughput_30d: throughput30d,
      incident_count_30d: scopedIncidents30d.length,
      mttr_p50_hours: mttrHours == null ? null : round(mttrHours, 2)
    };

    await persistResourceGroupSnapshot({
      tenantId,
      resourceGroupId: context.group.id,
      periodKey: `window-${query.window_days}`,
      metricType: 'health',
      payload: summaryPayload,
      lineage: {
        source: 'insights.overview',
        window_days: query.window_days,
        generated_at: new Date().toISOString()
      }
    });

    const latestSnapshot = await getLatestResourceGroupSnapshot(tenantId, context.group.id);
    const freshness = freshnessFromSnapshot(latestSnapshot);
    const dataQualityWarnings = [...warnings];
    if (freshness.stale) dataQualityWarnings.push('snapshot_stale_or_missing');

  return {
    resource_group: context.group,
    period: buildPeriodFromWindow(query.window_days),
    health_score: healthScore,
    risk_level: riskLevel,
    drivers,
    execution: {
      throughput_7d: throughput7d,
      throughput_30d: throughput30d,
      trend
    },
    incident: {
      incident_count_7d: incidents7d.length,
      incident_count_30d: scopedIncidents30d.length,
      mtta_p50_minutes: mttaMinutes == null ? null : round(mttaMinutes, 1),
      mttr_p50_hours: mttrHours == null ? null : round(mttrHours, 2),
      mttr_source: hasIncidentIntegration ? 'incidents' : 'not_configured'
    },
    recommendations,
    warnings,
    freshness,
    data_quality_warnings: Array.from(new Set(dataQualityWarnings))
  };
}

export async function getIncidentInsightsByResourceGroup(
  tenantId: string,
  groupId: string,
  query: InsightsIncidentsQuery
) {
  const context = await getGroupContext(tenantId, groupId);
  if (!context) return null;

  const period = parsePeriodOrDefault(query.period);
  if (!period) return null;

  const hasIncidentIntegration = await prisma.integrationConnection.findFirst({
    where: {
      tenantId,
      provider: { in: ['opsgenie', 'incident_io'] },
      status: 'active'
    },
    select: { id: true }
  });

  const incidents = await prisma.incidentEvent.findMany({
    where: {
      tenantId,
      openedAt: { gte: period.start, lte: period.end }
    },
    select: {
      openedAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      severity: true,
      affectedServices: true
    }
  });

  const serviceMatchers = toLowerSet(context.serviceMatchers);
  const scopedIncidents = incidents.filter((incident) =>
    incidentMatchesGroup(incident.affectedServices, serviceMatchers)
  );

  const severityMap = new Map<string, number>();
  for (const incident of scopedIncidents) {
    const severity = incident.severity?.trim() || 'unknown';
    severityMap.set(severity, (severityMap.get(severity) ?? 0) + 1);
  }

  const severityDistribution = Array.from(severityMap.entries())
    .map(([severity, count]) => ({ severity, count }))
    .sort((a, b) => b.count - a.count);

  const hotspotsMap = new Map<string, number>();
  for (const incident of scopedIncidents) {
    for (const service of incident.affectedServices ?? []) {
      hotspotsMap.set(service, (hotspotsMap.get(service) ?? 0) + 1);
    }
  }

  const hotspotServices = Array.from(hotspotsMap.entries())
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const mttrHours = median(
    scopedIncidents
      .filter((incident) => incident.resolvedAt)
      .map((incident) => (incident.resolvedAt!.getTime() - incident.openedAt.getTime()) / 3_600_000)
  );

  const mttaMinutes = median(
    scopedIncidents
      .filter((incident) => incident.acknowledgedAt)
      .map((incident) => (incident.acknowledgedAt!.getTime() - incident.openedAt.getTime()) / 60_000)
  );

  const warnings: string[] = [];
  if (!hasIncidentIntegration) warnings.push('incident_integration_not_configured');
  if (context.projectIds.length === 0) warnings.push('resource_group_without_projects');
  if (context.projectIds.length > 0 && scopedIncidents.length === 0) warnings.push('no_incident_matches_resource_group');

  return {
    resource_group: context.group,
    period: period.label,
    total_incidents: scopedIncidents.length,
    severity_distribution: severityDistribution,
    hotspot_services: hotspotServices,
    mtta_p50_minutes: mttaMinutes == null ? null : round(mttaMinutes, 1),
    mttr_p50_hours: mttrHours == null ? null : round(mttrHours, 2),
    warnings
  };
}

export async function getInsightTrendsByResourceGroup(
  tenantId: string,
  groupId: string,
  query: InsightsTrendsQuery
) {
  const context = await getGroupContext(tenantId, groupId);
  if (!context) return null;

  const now = new Date();
  const windowStart = new Date(now.getTime() - query.window_days * 24 * 60 * 60 * 1000);
  const granularity = query.granularity;
  const buckets = buildTrendBuckets(windowStart, now, granularity);

  const projectFilter = context.projectIds.length > 0 ? { projectId: { in: context.projectIds } } : undefined;
  const [tasks, incidents, hasIncidentIntegration] = await Promise.all([
    prisma.task.findMany({
      where: {
        tenantId,
        ...(projectFilter ?? {}),
        completedAt: { gte: windowStart, lte: now }
      },
      select: { completedAt: true, createdAt: true, updatedAt: true, status: true, dueDate: true, epicId: true }
    }),
    prisma.incidentEvent.findMany({
      where: {
        tenantId,
        openedAt: { gte: windowStart, lte: now }
      },
      select: { openedAt: true, affectedServices: true }
    }),
    prisma.integrationConnection.findFirst({
      where: {
        tenantId,
        provider: { in: ['opsgenie', 'incident_io'] },
        status: 'active'
      },
      select: { id: true }
    })
  ]);

  const serviceMatchers = toLowerSet(context.serviceMatchers);
  const scopedIncidents = incidents.filter((incident) => incidentMatchesGroup(incident.affectedServices, serviceMatchers));

  const throughputSeries = buckets.map((bucket) => ({
    bucket: bucket.bucket,
    value: tasks.filter((task) => task.completedAt !== null && task.completedAt >= bucket.start && task.completedAt <= bucket.end).length
  }));

  const incidentSeries = buckets.map((bucket) => ({
    bucket: bucket.bucket,
    value: scopedIncidents.filter((incident) => incident.openedAt >= bucket.start && incident.openedAt <= bucket.end).length
  }));

  const confidenceSeries = buckets.map((bucket, index) => {
    const throughput = throughputSeries[index].value;
    const incidentsInBucket = incidentSeries[index].value;
    const previousThroughput = index > 0 ? throughputSeries[index - 1].value : throughput;
    const throughputMomentum = throughput - previousThroughput;
    const value = clamp(100 - incidentsInBucket * 9 + throughput * 2 + throughputMomentum * 3, 0, 100);
    return {
      bucket: bucket.bucket,
      value: Math.round(value)
    };
  });

  const anomalies: Array<{ metric_name: string; bucket: string; date: string; z_score: number; direction: 'spike' | 'drop' }> = [];
  const throughputValues = throughputSeries.map((point) => point.value);
  const incidentValues = incidentSeries.map((point) => point.value);

  throughputSeries.forEach((point) => {
    const z = zScore(point.value, throughputValues);
    if (Math.abs(z) >= 2) {
      anomalies.push({
        metric_name: 'throughput',
        bucket: point.bucket,
        date: point.bucket,
        z_score: Number(z.toFixed(2)),
        direction: z < 0 ? 'drop' : 'spike'
      });
    }
  });

  incidentSeries.forEach((point) => {
    const z = zScore(point.value, incidentValues);
    if (Math.abs(z) >= 2) {
      anomalies.push({
        metric_name: 'incidents',
        bucket: point.bucket,
        date: point.bucket,
        z_score: Number(z.toFixed(2)),
        direction: z > 0 ? 'spike' : 'drop'
      });
    }
  });

  const degradationSignals: Array<{ id: string; level: 'high' | 'medium' | 'low'; message: string }> = [];
  if (throughputSeries.length >= 3) {
    const lastThree = throughputSeries.slice(-3).map((point) => point.value);
    if (lastThree[0] > lastThree[1] && lastThree[1] > lastThree[2]) {
      degradationSignals.push({
        id: 'throughput_decline_3buckets',
        level: 'high',
        message: 'Queda consistente de throughput nas ultimas 3 janelas.'
      });
    }
  }
  if (incidentSeries.length >= 3) {
    const lastThree = incidentSeries.slice(-3).map((point) => point.value);
    if (lastThree[0] < lastThree[1] && lastThree[1] < lastThree[2]) {
      degradationSignals.push({
        id: 'incident_rise_3buckets',
        level: 'high',
        message: 'Aumento consistente de incidentes nas ultimas 3 janelas.'
      });
    }
  }

  const confidenceAverage = mean(confidenceSeries.map((point) => point.value));
  if (confidenceAverage < 55) {
    degradationSignals.push({
      id: 'confidence_below_target',
      level: 'medium',
      message: 'Confianca media abaixo do alvo operacional.'
    });
  }

  const warnings: string[] = [];
  if (!hasIncidentIntegration) warnings.push('incident_integration_not_configured');
  if (context.projectIds.length === 0) warnings.push('resource_group_without_projects');
  if (scopedIncidents.length === 0 && hasIncidentIntegration) warnings.push('no_incident_matches_resource_group');

  await persistResourceGroupSnapshot({
    tenantId,
    resourceGroupId: context.group.id,
    periodKey: `trend-${query.window_days}-${granularity}`,
    metricType: 'health',
    payload: {
      window_days: query.window_days,
      granularity,
      series: {
        throughput: throughputSeries,
        incidents: incidentSeries,
        confidence: confidenceSeries
      },
      anomalies,
      degradation_signals: degradationSignals
    },
    lineage: {
      source: 'insights.trends',
      window_days: query.window_days,
      granularity,
      generated_at: now.toISOString()
    }
  });

  return {
    resource_group: context.group,
    window_days: query.window_days,
    granularity,
    series: {
      throughput: throughputSeries,
      incidents: incidentSeries,
      confidence: confidenceSeries
    },
    anomalies,
    degradation_signals: degradationSignals,
    warnings
  };
}

export async function getBacklogQualityByResourceGroup(
  tenantId: string,
  groupId: string,
  query: InsightsBacklogQualityQuery
) {
  const context = await getGroupContext(tenantId, groupId);
  if (!context) return null;

  if (context.projectIds.length === 0) {
    return {
      resource_group: context.group,
      backlog_quality: {
        score: 0,
        level: 'alert' as const,
        backlog_aging_index_days: null,
        stale_backlog_rate: 0,
        overdue_backlog_rate: 0,
        flow_regression_rate: 0,
        backlog_churn_proxy: 0
      },
      thresholds: { stale_days: query.stale_days },
      warnings: ['resource_group_without_projects', 'no_backlog_items_found']
    };
  }

  const tasks = await prisma.task.findMany({
    where: {
      tenantId,
      projectId: { in: context.projectIds }
    },
    select: {
      status: true,
      createdAt: true,
      updatedAt: true,
      dueDate: true,
      completedAt: true
    }
  });

  const backlog = calculateBacklogQuality(tasks, query.stale_days);
  const warnings = [...backlog.warnings];
  if (context.projectIds.length === 0) warnings.push('resource_group_without_projects');

  return {
    resource_group: context.group,
    backlog_quality: backlog.backlog_quality,
    thresholds: {
      stale_days: query.stale_days
    },
    warnings
  };
}

export async function recomputeInsightsForResourceGroup(
  tenantId: string,
  groupId: string,
  body: InsightsRecomputeBody
) {
  const context = await getGroupContext(tenantId, groupId);
  if (!context) return null;

  const submittedAt = new Date();
  const recomputeId = crypto.randomUUID();
  const latestSnapshot = await getLatestResourceGroupSnapshot(tenantId, context.group.id);

  if (latestSnapshot?.lineage && typeof latestSnapshot.lineage === 'object') {
    const lineage = latestSnapshot.lineage as Record<string, unknown>;
    const isRecentRecompute = lineage.source === 'insights.recompute' && (submittedAt.getTime() - latestSnapshot.computedAt.getTime()) < 2 * 60 * 1000;
    if (isRecentRecompute) {
      return { error: 'JOB_IN_PROGRESS' as const };
    }
  }

  const [overview, planningConfidence, backlogQuality, trends] = await Promise.all([
    getInsightsOverviewByResourceGroup(tenantId, groupId, { window_days: 30 }),
    getPlanningConfidenceByResourceGroup(tenantId, groupId, {}),
    getBacklogQualityByResourceGroup(tenantId, groupId, { stale_days: 21 }),
    getInsightTrendsByResourceGroup(tenantId, groupId, { window_days: 60, granularity: 'weekly' })
  ]);

  await persistResourceGroupSnapshot({
    tenantId,
    resourceGroupId: context.group.id,
    periodKey: `recompute-${body.mode}-${submittedAt.toISOString().slice(0, 10)}`,
    metricType: 'health',
    payload: {
      mode: body.mode,
      reason: body.reason ?? null,
      overview,
      planning_confidence: planningConfidence,
      backlog_quality: backlogQuality,
      trends
    },
    lineage: {
      source: 'insights.recompute',
      mode: body.mode,
      reason: body.reason ?? null,
      generated_at: submittedAt.toISOString()
    }
  });

  return {
    job_id: recomputeId,
    status: 'queued' as const,
    resource_group_id: context.group.id,
    submitted_at: submittedAt.toISOString()
  };
}

export async function getPlanningConfidenceByResourceGroup(
  tenantId: string,
  groupId: string,
  query: InsightsPlanningConfidenceQuery
) {
  const context = await getGroupContext(tenantId, groupId);
  if (!context) return null;

  const period = parsePeriodOrDefault(query.period);
  if (!period) return null;

  const now = new Date();

  const [epics, tasks, incidents, hasIncidentIntegration] = await Promise.all([
    context.projectIds.length > 0
      ? prisma.epic.findMany({
          where: {
            tenantId,
            projectId: { in: context.projectIds }
          },
          select: {
            id: true,
            name: true,
            startDate: true,
            targetEndDate: true,
            actualEndDate: true,
            totalTasks: true,
            completedTasks: true,
            totalStoryPoints: true
          },
          orderBy: { updatedAt: 'desc' }
        })
      : Promise.resolve([]),
    context.projectIds.length > 0
      ? prisma.task.findMany({
          where: {
            tenantId,
            projectId: { in: context.projectIds }
          },
          select: {
            id: true,
            epicId: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            dueDate: true,
            completedAt: true
          }
        })
      : Promise.resolve([]),
    prisma.incidentEvent.findMany({
      where: {
        tenantId,
        openedAt: { gte: period.start, lte: period.end }
      },
      select: {
        openedAt: true,
        acknowledgedAt: true,
        resolvedAt: true,
        affectedServices: true
      }
    }),
    prisma.integrationConnection.findFirst({
      where: {
        tenantId,
        provider: { in: ['opsgenie', 'incident_io'] },
        status: 'active'
      },
      select: { id: true }
    })
  ]);

  const taskIds = tasks.map((task) => task.id);
  const dependencies = taskIds.length > 0
    ? await prisma.taskDependency.findMany({
        where: {
          tenantId,
          OR: [
            { blockerId: { in: taskIds } },
            { blockedId: { in: taskIds } }
          ]
        },
        select: {
          blockerId: true,
          blockedId: true
        }
      })
    : [];

  const backlog = calculateBacklogQuality(tasks, 21);
  const taskByEpic = groupByEpicId(tasks);
  const dependencyByTaskId = new Map<string, number>();
  for (const dependency of dependencies) {
    dependencyByTaskId.set(dependency.blockerId, (dependencyByTaskId.get(dependency.blockerId) ?? 0) + 1);
    dependencyByTaskId.set(dependency.blockedId, (dependencyByTaskId.get(dependency.blockedId) ?? 0) + 1);
  }
  const serviceMatchers = toLowerSet(context.serviceMatchers);
  const scopedIncidents = incidents.filter((incident) => incidentMatchesGroup(incident.affectedServices, serviceMatchers));
  const epicResults = epics.map((epic) => {
    const epicTasks = taskByEpic.get(epic.id) ?? [];
    const completedTasks = epic.completedTasks ?? epicTasks.filter((task) => task.status === 'done').length;
    const totalTasks = Math.max(epic.totalTasks ?? 0, epicTasks.length, 1);
    const progressRatio = totalTasks === 0 ? 0 : completedTasks / totalTasks;
    const openRatio = 1 - progressRatio;

    const overdueWeeks = epic.targetEndDate && epic.targetEndDate < now
      ? Math.ceil((now.getTime() - epic.targetEndDate.getTime()) / (7 * 24 * 60 * 60 * 1000))
      : 0;

    const epicIncidents = scopedIncidents.filter((incident) => {
      const epicStart = epic.startDate ?? period.start;
      const epicEnd = epic.actualEndDate ?? epic.targetEndDate ?? now;
      const incidentInWindow = incident.openedAt >= epicStart && incident.openedAt <= epicEnd;
      const serviceMatch = incidentMatchesGroup(incident.affectedServices, serviceMatchers);
      return incidentInWindow && serviceMatch;
    });

    const epicDependencyPressure = epicTasks.reduce(
      (count, task) => count + (dependencyByTaskId.get(task.id) ?? 0),
      0
    );
    const backlogPenalty = backlog.backlog_quality.stale_backlog_rate * 18 + backlog.backlog_quality.overdue_backlog_rate * 12 + backlog.backlog_quality.flow_regression_rate * 10;
    const schedulePenalty = overdueWeeks > 0 ? overdueWeeks * 8 : epic.targetEndDate == null ? 10 : 0;
    const throughputPenalty = openRatio * 25;
    const dependencyPenalty = Math.min(20, epicDependencyPressure * 4);
    const incidentPenalty = Math.min(24, epicIncidents.length * 6);
    const scopePenalty = openRatio * 20;

    const confidenceScore = Math.round(
      clamp(100 - backlogPenalty - schedulePenalty - throughputPenalty - dependencyPenalty - incidentPenalty - scopePenalty, 0, 100)
    );

    const drivers: string[] = [];
    if (openRatio >= 0.5) drivers.push('scope_drift');
    if (overdueWeeks > 0) drivers.push('schedule_drift');
    if (epicDependencyPressure > 0) drivers.push('dependency_pressure');
    if (epicIncidents.length > 0) drivers.push('incident_pressure');
    if (backlog.backlog_quality.stale_backlog_rate > 0.2) drivers.push('backlog_staleness');
    if (drivers.length === 0) drivers.push('steady_progress');

    return {
      epic_id: epic.id,
      epic_name: epic.name,
      confidence_score: confidenceScore,
      confidence_level: computePlanningLevel(confidenceScore),
      weeks_overdue: overdueWeeks,
      drivers,
      impacted_by_incidents: epicIncidents.length > 0,
      weight: Math.max(1, epic.totalStoryPoints ?? epic.totalTasks ?? 1)
    };
  });

  const weightedSum = epicResults.reduce((sum, epic) => sum + epic.confidence_score * epic.weight, 0);
  const weightSum = epicResults.reduce((sum, epic) => sum + epic.weight, 0);
  const roadmapScore = epicResults.length === 0 ? 0 : Math.round(weightedSum / weightSum);
  const delayedEpicsCount = epicResults.filter((epic) => epic.weeks_overdue > 0 || epic.confidence_score < 60).length;
  const onTrackCount = epicResults.length - delayedEpicsCount;
  const impactedEpicsCount = epicResults.filter((epic) => epic.impacted_by_incidents).length;
  const incidentPressureRatio = epicResults.length === 0 ? 0 : impactedEpicsCount / epicResults.length;

  const planningScore = Math.round(clamp((roadmapScore * 0.7) + (backlog.backlog_quality.score * 0.3) - Math.min(10, scopedIncidents.length * 1.5), 0, 100));
  const planningTrend = delayedEpicsCount > epicResults.length / 2 || backlog.backlog_quality.level === 'alert' || scopedIncidents.length >= 4
    ? 'down'
    : delayedEpicsCount === 0 && backlog.backlog_quality.level === 'good'
      ? 'up'
      : 'stable';
  const roadmapTrend = roadmapScore >= 75 && delayedEpicsCount === 0
    ? 'up'
    : delayedEpicsCount > 0 || scopedIncidents.length >= 3
      ? 'down'
      : 'stable';

  const warnings: string[] = [];
  if (!hasIncidentIntegration) warnings.push('incident_integration_not_configured');
  if (context.projectIds.length === 0) warnings.push('resource_group_without_projects');
  if (epicResults.length === 0) warnings.push('no_epics_in_resource_group');
  if (backlog.warnings.includes('flow_regression_uses_proxy')) warnings.push('flow_regression_rate_uses_proxy');
  if (scopedIncidents.length === 0 && hasIncidentIntegration) warnings.push('no_incident_matches_resource_group');

  return {
    resource_group: context.group,
    period: period.label,
    planning_confidence: {
      score: planningScore,
      level: computePlanningLevel(planningScore),
      trend: planningTrend,
      drivers: Array.from(new Set(epicResults.flatMap((epic) => epic.drivers))).slice(0, 5)
    },
    roadmap_confidence: {
      score: roadmapScore,
      trend: roadmapTrend,
      on_track_ratio: epicResults.length === 0 ? 0 : Number((onTrackCount / epicResults.length).toFixed(2)),
      delayed_epics_count: delayedEpicsCount
    },
    epics: epicResults
      .map(({ weight: _weight, impacted_by_incidents: _impactedByIncidents, ...epic }) => epic)
      .sort((a, b) => a.confidence_score - b.confidence_score),
    incident_correlation: {
      impacted_epics_count: impactedEpicsCount,
      roadmap_risk_due_to_incidents:
        incidentPressureRatio >= 0.5 || scopedIncidents.length >= 5 ? 'high' : incidentPressureRatio > 0 ? 'medium' : 'low'
    },
    warnings: Array.from(new Set(warnings.concat(backlog.warnings.filter((warning) => warning !== 'flow_regression_uses_proxy'))))
  };
}
