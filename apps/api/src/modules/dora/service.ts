import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  computeDeploymentFrequency,
  computeLeadTime,
  computeMttr,
  computeMtta,
  computeIncidentFrequency,
  computeChangeFailureRate,
  computeOverallDoraLevel,
  type DoraLevel
} from './engine.js';
import type {
  DoraQueryInput,
  IngestDeployEventInput,
  IngestLeadTimeEventInput
} from './schema.js';
import { listDeployEventsQuerySchema } from './schema.js';
import type { z } from 'zod';

type ListDeployEventsQuery = z.infer<typeof listDeployEventsQuerySchema>;

// ── Deploy event ingest ───────────────────────────────────────────────────────

export async function ingestDeployEvent(tenantId: string, input: IngestDeployEventInput) {
  return prisma.deployEvent.upsert({
    where: {
      tenantId_source_externalId: {
        tenantId,
        source: input.source,
        externalId: input.external_id ?? `manual-${Date.now()}`
      }
    },
    create: {
      tenantId,
      projectId: input.project_id,
      source: input.source,
      externalId: input.external_id,
      ref: input.ref,
      commitSha: input.commit_sha,
      environment: input.environment,
      deployedAt: new Date(input.deployed_at),
      isHotfix: input.is_hotfix ?? false,
      isRollback: input.is_rollback ?? false,
      prIds: input.pr_ids ?? [],
      rawPayload: (input.raw_payload ?? undefined) as Prisma.InputJsonValue | undefined
    },
    update: {
      ref: input.ref,
      commitSha: input.commit_sha,
      deployedAt: new Date(input.deployed_at),
      isHotfix: input.is_hotfix ?? false,
      isRollback: input.is_rollback ?? false,
      prIds: input.pr_ids ?? []
    }
  });
}

// ── List deploy events ────────────────────────────────────────────────────────

export async function listDeployEvents(tenantId: string, query: ListDeployEventsQuery) {
  const where: Prisma.DeployEventWhereInput = { tenantId };
  if (query.project_id) where.projectId = query.project_id;
  if (query.environment) where.environment = query.environment;

  const limit = query.limit;
  const items = await prisma.deployEvent.findMany({
    where,
    orderBy: { deployedAt: 'desc' },
    take: limit + 1,
    cursor: query.cursor ? { id: query.cursor } : undefined
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    data: page,
    next_cursor: hasMore ? page[page.length - 1].id : null
  };
}

// ── Compute DORA scorecard ────────────────────────────────────────────────────

export async function computeDoraScorecard(tenantId: string, query: DoraQueryInput) {
  const windowDays = query.window_days;
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const whereBase: Prisma.DeployEventWhereInput = {
    tenantId,
    environment: query.environment,
    deployedAt: { gte: windowStart, lte: windowEnd },
    ...(query.project_id && { projectId: query.project_id })
  };

  // ── Deployment Frequency ───────────────────────────────────────────────────
  const deployCount = await prisma.deployEvent.count({ where: whereBase });
  const df = computeDeploymentFrequency(deployCount, windowDays);

  // ── Lead Time for Changes ──────────────────────────────────────────────────
  // Use HealthMetric snapshots written by ingestLeadTimeEvent
  const ltMetrics = await prisma.healthMetric.findMany({
    where: {
      tenantId,
      metricName: 'lead_time_hours',
      windowStart: { gte: windowStart },
      windowEnd: { lte: windowEnd },
      ...(query.project_id && { projectId: query.project_id })
    },
    select: { value: true }
  });

  const lt = computeLeadTime(ltMetrics.map((m) => m.value));

  // ── Mean Time to Restore ───────────────────────────────────────────────────
  // Source: IncidentEvent exclusively. Bug tasks JIRA are no longer used.
  // Returns null with mttr_source: "not_configured" when no incident integration is active.
  const hasIncidentIntegration = await prisma.integrationConnection.findFirst({
    where: {
      tenantId,
      provider: { in: ['opsgenie', 'incident_io'] },
      status: 'active'
    },
    select: { id: true }
  });

  type MttrSource = 'incidents' | 'not_configured';
  const mttrSource: MttrSource = hasIncidentIntegration ? 'incidents' : 'not_configured';

  let mttr: ReturnType<typeof computeMttr> = null;
  let mtta: ReturnType<typeof computeMtta> = null;
  let incidentFrequency: ReturnType<typeof computeIncidentFrequency> | null = null;
  let incidentSampleSize = 0;
  let mttaSampleSize = 0;

  if (hasIncidentIntegration) {
    const incidents = await prisma.incidentEvent.findMany({
      where: {
        tenantId,
        resolvedAt: { not: null },
        openedAt: { gte: windowStart, lte: windowEnd },
        priority: { in: ['P1', 'P2'] },
        ...(query.project_id
          ? { affectedServices: { isEmpty: false } }  // project-scoped handled post-query
          : {})
      },
      select: { openedAt: true, acknowledgedAt: true, resolvedAt: true, affectedServices: true }
    });

    // If project_id is set, auto-match incidents whose affectedServices overlap
    // with the project name/key (case-insensitive). See dora-metrics.md §MTTR.
    let scoped = incidents;
    if (query.project_id) {
      const project = await prisma.project.findFirst({
        where: { id: query.project_id, tenantId },
        select: { name: true, key: true }
      });
      if (project) {
        const lower = [project.name.toLowerCase(), (project.key ?? '').toLowerCase()].filter(Boolean);
        scoped = incidents.filter((i) =>
          i.affectedServices.some((s) => lower.includes(s.toLowerCase()))
        );
        // If no match, fall back to all tenant incidents (MTTR genérico)
        if (scoped.length === 0) scoped = incidents;
      }
    }

    incidentSampleSize = scoped.length;

    const restoreTimes = scoped.map((i) =>
      (i.resolvedAt!.getTime() - i.openedAt.getTime()) / 3_600_000
    );
    mttr = computeMttr(restoreTimes);

    // MTTA: only incidents that were acknowledged
    const ackTimes = scoped
      .filter((i) => i.acknowledgedAt !== null)
      .map((i) => (i.acknowledgedAt!.getTime() - i.openedAt.getTime()) / 3_600_000);
    mttaSampleSize = ackTimes.length;
    mtta = computeMtta(ackTimes);

    // Incident frequency: count of all P1/P2 incidents in window (not just resolved)
    const incidentCount = await prisma.incidentEvent.count({
      where: {
        tenantId,
        openedAt: { gte: windowStart, lte: windowEnd },
        priority: { in: ['P1', 'P2'] }
      }
    });
    incidentFrequency = computeIncidentFrequency(incidentCount, windowDays);
  }

  // ── Change Failure Rate ────────────────────────────────────────────────────
  const allDeploys = await prisma.deployEvent.findMany({
    where: whereBase,
    select: { deployedAt: true, id: true }
  });

  // Bugs P0/P1 opened within 24h after a deploy → correlated failures
  let failedDeployCount = 0;
  for (const deploy of allDeploys) {
    const oneDayAfter = new Date(deploy.deployedAt.getTime() + 24 * 60 * 60 * 1000);
    const correlated = await prisma.task.count({
      where: {
        tenantId,
        taskType: 'bug',
        priority: { in: ['P0', 'P1'] },
        createdAt: { gte: deploy.deployedAt, lte: oneDayAfter },
        ...(query.project_id && { projectId: query.project_id })
      }
    });
    if (correlated > 0) failedDeployCount++;
  }

  const cfr = computeChangeFailureRate(allDeploys.length, failedDeployCount);

  // ── Overall level ──────────────────────────────────────────────────────────
  // MTTR is only included when fed by real incident data (not when not_configured).
  // Score is computed from available metrics to avoid penalising tenants who
  // haven't configured an incident integration yet.
  const levels: DoraLevel[] = [df.level];
  if (lt) levels.push(lt.level);
  if (mttr) levels.push(mttr.level);
  if (cfr) levels.push(cfr.level);

  const overallLevel = computeOverallDoraLevel(levels);

  // ── Persist snapshots ──────────────────────────────────────────────────────
  const snapshots = [
    { metric_name: 'deployment_frequency', value: df.value, unit: 'per_day', level: df.level },
    ...(lt
      ? [
          { metric_name: 'lead_time_p50', value: lt.p50, unit: 'hours', level: lt.level },
          { metric_name: 'lead_time_p95', value: lt.p95, unit: 'hours', level: lt.level }
        ]
      : []),
    ...(mttr ? [{ metric_name: 'mttr', value: mttr.value, unit: 'hours', level: mttr.level }] : []),
    ...(mtta ? [{ metric_name: 'mtta', value: mtta.p50, unit: 'hours', level: mtta.level }] : []),
    ...(incidentFrequency ? [{ metric_name: 'incident_frequency', value: incidentFrequency.value, unit: 'per_day', level: 'medium' as DoraLevel }] : []),
    ...(cfr
      ? [{ metric_name: 'change_failure_rate', value: cfr.value, unit: 'percent', level: cfr.level }]
      : []),
    { metric_name: 'dora_overall', value: LEVEL_RANK[overallLevel], unit: 'level', level: overallLevel }
  ];

  await Promise.all(
    snapshots.map((s) =>
      prisma.healthMetric.create({
        data: {
          tenantId,
          projectId: query.project_id,
          metricName: s.metric_name,
          windowDays,
          value: s.value,
          unit: s.unit,
          level: s.level as DoraLevel,
          windowStart,
          windowEnd
        }
      })
    )
  );

  return {
    window_days: windowDays,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    project_id: query.project_id ?? null,
    overall_level: overallLevel,
    deployment_frequency: {
      value: df.value,
      unit: df.unit,
      level: df.level,
      deploy_count: deployCount
    },
    lead_time: lt
      ? { p50: lt.p50, p95: lt.p95, unit: lt.unit, level: lt.level, sample_size: ltMetrics.length }
      : null,
    mttr: mttr
      ? { value: mttr.value, unit: mttr.unit, level: mttr.level, sample_size: incidentSampleSize }
      : null,
    mttr_source: mttrSource,
    mtta: mtta
      ? { p50: mtta.p50, unit: mtta.unit, level: mtta.level, sample_size: mttaSampleSize }
      : null,
    incident_frequency: incidentFrequency
      ? { value: incidentFrequency.value, unit: incidentFrequency.unit }
      : null,
    change_failure_rate: cfr
      ? {
          value: cfr.value,
          unit: cfr.unit,
          level: cfr.level,
          total_deploys: allDeploys.length,
          failed_deploys: failedDeployCount
        }
      : null
  };
}

// ── Ingest lead time from a merged PR ────────────────────────────────────────

export async function ingestLeadTimeEvent(tenantId: string, input: IngestLeadTimeEventInput) {
  const firstCommit = new Date(input.first_commit_at);
  const merged = new Date(input.merged_at);
  const leadTimeHours = (merged.getTime() - firstCommit.getTime()) / 3_600_000;

  // Ignore outliers (> 90 days open)
  if (leadTimeHours > 90 * 24) {
    return { skipped: true, reason: 'outlier_gt_90d', lead_time_hours: leadTimeHours };
  }

  const metric = await prisma.healthMetric.create({
    data: {
      tenantId,
      projectId: input.project_id,
      metricName: 'lead_time_hours',
      windowDays: 1,
      value: leadTimeHours,
      unit: 'hours',
      windowStart: firstCommit,
      windowEnd: merged,
      metadata: { pr_id: input.pr_id } as Prisma.InputJsonValue
    }
  });

  return { skipped: false, lead_time_hours: leadTimeHours, metric_id: metric.id };
}

// ── Historical HealthMetric list ──────────────────────────────────────────────

export async function listHealthMetrics(
  tenantId: string,
  params: {
    metric_name?: string;
    project_id?: string;
    window_days?: number;
    limit?: number;
    cursor?: string;
  }
) {
  const where: Prisma.HealthMetricWhereInput = { tenantId };
  if (params.metric_name) where.metricName = params.metric_name;
  if (params.project_id) where.projectId = params.project_id;
  if (params.window_days) where.windowDays = params.window_days;

  const limit = params.limit ?? 20;
  const items = await prisma.healthMetric.findMany({
    where,
    orderBy: { computedAt: 'desc' },
    take: limit + 1,
    cursor: params.cursor ? { id: params.cursor } : undefined
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return {
    data: page,
    next_cursor: hasMore ? page[page.length - 1].id : null
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEVEL_RANK: Record<DoraLevel, number> = { elite: 4, high: 3, medium: 2, low: 1 };
