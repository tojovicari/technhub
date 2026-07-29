import type { Pool, PoolClient } from 'pg';
import { getPool, withTenantContext } from '../database/pool';

/** Presente só quando `teamId` é passado na query — distingue métrica calculada por time de métrica ainda tenant-wide. */
export type MetricScope = 'team' | 'tenant';

export interface DeploymentFrequencyMetric {
  readonly total: number;
  readonly byDay: readonly { readonly date: string; readonly count: number }[];
  readonly scope?: MetricScope;
}

export interface AvailableDurationMetric {
  readonly available: true;
  readonly avgHours: number | null;
  readonly medianHours?: number | null;
  readonly sampleSize: number;
  readonly scope?: MetricScope;
}

export interface UnavailableMetric {
  readonly available: false;
  readonly reason: string;
}

export interface AvailableChangeFailureRateMetric {
  readonly available: true;
  readonly totalDeployments: number;
  readonly failedDeployments: number;
  /** Fração (0-1), não percentual — mesma convenção de `DeploymentSuccessRateMetric`/`ContributionConcentrationMetric`. */
  readonly rate: number;
  readonly scope?: MetricScope;
}

export interface DoraMetrics {
  readonly period: { readonly from: string; readonly to: string };
  readonly deploymentFrequency: DeploymentFrequencyMetric;
  readonly leadTimeForChanges: AvailableDurationMetric | UnavailableMetric;
  readonly meanTimeToRestore: AvailableDurationMetric | UnavailableMetric;
  readonly changeFailureRate: AvailableChangeFailureRateMetric | UnavailableMetric;
}

export interface FlowDistributionEntry {
  readonly category: string;
  readonly count: number;
}

export interface FlowMetrics {
  readonly distribution: readonly FlowDistributionEntry[];
  readonly wip: { readonly count: number };
  /**
   * `velocity`/`cycleTime` dependem de `period` (diferente de
   * `distribution`/`wip`, que são sempre "agora") — populados a partir de
   * `enriched_work_items.completed_at`/`started_working_at`, calculados na
   * Enriched Layer a partir do changelog de status (Jira/Linear).
   */
  readonly period: { readonly from: string; readonly to: string };
  readonly velocity: DeploymentFrequencyMetric;
  readonly cycleTime: AvailableDurationMetric | UnavailableMetric;
  /**
   * Presente só quando `teamId` é passado. As 4 métricas de Flow
   * (`distribution`/`wip`/`velocity`/`cycleTime`) compartilham o mesmo
   * filtro simples (`enriched_work_items.team_id`, sem depender de vínculo
   * manual nenhum) — um único campo cobre todas, diferente do DORA, que tem
   * `scope` por métrica porque cada uma tem fonte/filtro próprio (algumas
   * dependendo de `team_resource_links`, outras não).
   */
  readonly scope?: MetricScope;
}

/**
 * `available: false` são gaps reais e já conhecidos, não esquecidos — cada
 * um documentado no plano desta rodada. Devolver isso explícito na resposta
 * (em vez de omitir o campo) reduz a necessidade de documentação externa
 * pro time de front: a própria API explica por que o número não existe.
 */
const CHANGE_FAILURE_RATE_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Nenhum deploy de produção bem-sucedido neste período.',
};

/**
 * Janela de correlação deploy→incidente pro Change Failure Rate: um
 * incidente conta como "causado por" um deploy se disparar dentro dessa
 * janela depois do deploy terminar, no mesmo time. Sem link explícito nos
 * dados (nem GitHub Actions nem Waroom expõem isso) — é sempre inferido por
 * proximidade de tempo. 1h é o valor confirmado com o usuário: rigoroso o
 * bastante pra não correlacionar coisas não relacionadas, mesmo sabendo que
 * subestima falhas que demoram mais que isso pra se manifestar.
 */
const CHANGE_FAILURE_RATE_WINDOW = "INTERVAL '1 hour'";

const CYCLE_TIME_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Nenhum work item concluído (completed_at) neste período ainda.',
};

/**
 * Primeira camada de leitura agregada (DORA + Flow) — Seção 6 da spec.
 *
 * Gatilhos fixos nesta rodada (não ainda o motor de eventos configuráveis
 * "Valor = f(Evento Inicial, Evento Final, Filtro, Agrupamento)" descrito
 * na Seção 6): Lead Time é sempre abertura→merge do PR, MTTR é sempre
 * disparo→resolução do incidente. A classificação semântica em si (o que é
 * "produção", o que conta como falha) continua configurável via
 * `mapping_rules` — isso não muda, só o "quando começa/termina o relógio".
 *
 * Escopo tenant inteiro, não por time: Pull Requests nunca passaram pela
 * Enriched Layer e o conector do GitHub escopa por organização (não por
 * repo/time), então não há como filtrar Lead Time por time ainda.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 6.
 */
export class DashboardService {
  constructor(private readonly pool: Pool = getPool()) {}

  async getDoraMetrics(tenantId: string, from: Date, to: Date, teamId?: string): Promise<DoraMetrics> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const [deploymentFrequency, leadTimeForChanges, meanTimeToRestore, changeFailureRate] = await Promise.all([
        this.queryDeploymentFrequency(client, from, to, teamId),
        this.queryLeadTime(client, from, to, teamId),
        this.queryMeanTimeToRestore(client, from, to, teamId),
        this.queryChangeFailureRate(client, from, to, teamId),
      ]);

      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        deploymentFrequency,
        leadTimeForChanges,
        meanTimeToRestore,
        changeFailureRate,
      };
    });
  }

  /**
   * `teamId` filtra `distribution`/`wip` por `enriched_work_items.team_id`.
   * Nullable: Jira/Linear podem sincronizar sem `projectKey`/`teamKey`, com
   * o time resolvido depois via `team_resource_links` (por item, não mais
   * garantido no cadastro da integração) — itens ainda não vinculados ficam
   * de fora do filtro por time, mas aparecem normalmente na visão tenant-wide
   * (sem `teamId`). `scope: 'team'` (mesmo sinal do DORA) avisa o front que o
   * número é filtrado e pode estar artificialmente baixo/zerado por falta de
   * vínculo, não só por ausência real de dado.
   */
  async getFlowMetrics(tenantId: string, from: Date, to: Date, teamId?: string): Promise<FlowMetrics> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const [distribution, wip, velocity, cycleTime] = await Promise.all([
        this.queryDistribution(client, teamId),
        this.queryWip(client, teamId),
        this.queryVelocity(client, from, to, teamId),
        this.queryCycleTime(client, from, to, teamId),
      ]);

      return {
        distribution,
        wip,
        period: { from: from.toISOString(), to: to.toISOString() },
        velocity,
        cycleTime,
        ...(teamId ? { scope: 'team' as const } : {}),
      };
    });
  }

  private async queryDeploymentFrequency(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<DeploymentFrequencyMetric> {
    const result = await client.query<{ day: Date; count: string }>(
      `SELECT date_trunc('day', cd.started_at) AS day, count(*) AS count
       FROM enriched_deployments ed
       JOIN canonical_deployments cd ON cd.id = ed.id
       WHERE ed.semantic_environment = 'PRODUCTION' AND cd.started_at BETWEEN $1 AND $2
       ${teamId ? 'AND ed.team_id = $3' : ''}
       GROUP BY 1
       ORDER BY 1`,
      teamId ? [from, to, teamId] : [from, to],
    );

    const byDay = result.rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      count: Number(row.count),
    }));
    const total = byDay.reduce((sum, day) => sum + day.count, 0);

    return { total, byDay, ...(teamId ? { scope: 'team' as const } : {}) };
  }

  /**
   * Sem `teamId`: lê `canonical_pull_requests` direto, como sempre (PRs
   * nunca passaram pela Enriched Layer). Com `teamId`: junta contra
   * `team_resource_links` (vínculo manual `repository → team`, ver
   * `POST /teams/:teamId/resource-links`) — só entra na conta o PR de um
   * repositório já vinculado àquele time.
   */
  private async queryLeadTime(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<AvailableDurationMetric> {
    const result = teamId
      ? await client.query<{ avg_hours: string | null; median_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (cpr.merged_at - cpr.opened_at)) / 3600) AS avg_hours,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (cpr.merged_at - cpr.opened_at)) / 3600) AS median_hours,
             count(*) AS sample_size
           FROM canonical_pull_requests cpr
           JOIN team_resource_links trl
             ON trl.provider = 'github' AND trl.resource_type = 'github_repository' AND trl.external_resource_id = cpr.repository
           WHERE cpr.state = 'MERGED' AND cpr.merged_at BETWEEN $1 AND $2 AND trl.team_id = $3`,
          [from, to, teamId],
        )
      : await client.query<{ avg_hours: string | null; median_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (merged_at - opened_at)) / 3600) AS avg_hours,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (merged_at - opened_at)) / 3600) AS median_hours,
             count(*) AS sample_size
           FROM canonical_pull_requests
           WHERE state = 'MERGED' AND merged_at BETWEEN $1 AND $2`,
          [from, to],
        );

    const row = result.rows[0];

    return {
      available: true,
      avgHours: row.avg_hours !== null ? Number(row.avg_hours) : null,
      medianHours: row.median_hours !== null ? Number(row.median_hours) : null,
      sampleSize: Number(row.sample_size),
      ...(teamId ? { scope: 'team' as const } : {}),
    };
  }

  /**
   * Sem `teamId`: lê `canonical_incidents` direto, como sempre — não depende
   * do enriquecimento ter rodado. Com `teamId`: junta contra
   * `enriched_incidents.team_id`, que agora é resolvido por incidente (ver
   * `EnrichmentService.runIncidentEnrichment`), não mais por integração inteira.
   */
  private async queryMeanTimeToRestore(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<AvailableDurationMetric> {
    const result = teamId
      ? await client.query<{ avg_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (ci.resolved_at - ci.triggered_at)) / 3600) AS avg_hours,
             count(*) AS sample_size
           FROM canonical_incidents ci
           JOIN enriched_incidents ei ON ei.id = ci.id
           WHERE ci.resolved_at IS NOT NULL AND ci.resolved_at BETWEEN $1 AND $2 AND ei.team_id = $3`,
          [from, to, teamId],
        )
      : await client.query<{ avg_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (resolved_at - triggered_at)) / 3600) AS avg_hours,
             count(*) AS sample_size
           FROM canonical_incidents
           WHERE resolved_at IS NOT NULL AND resolved_at BETWEEN $1 AND $2`,
          [from, to],
        );

    const row = result.rows[0];

    return {
      available: true,
      avgHours: row.avg_hours !== null ? Number(row.avg_hours) : null,
      sampleSize: Number(row.sample_size),
      ...(teamId ? { scope: 'team' as const } : {}),
    };
  }

  /**
   * Sem link explícito entre deploy e incidente em lugar nenhum dos dados
   * (nem GitHub Actions nem Waroom expõem isso) — correlação é sempre por
   * proximidade de tempo + mesmo time: um deploy `SUCCESS`/`PRODUCTION`
   * "causou falha" se existe um incidente `COUNTS_AS_FAILURE` (campo já
   * calculado por `evaluateIncidentSeverity`, antes não consumido por
   * nenhuma métrica) do mesmo time, disparado dentro de
   * `CHANGE_FAILURE_RATE_WINDOW` depois do deploy terminar. Mesmo padrão de
   * `queryDeploymentFrequency`: `team_id` direto em `enriched_deployments`/
   * `enriched_incidents`, sem `team_resource_links` (ambos já passam pela
   * Enriched Layer, diferente de PRs).
   */
  private async queryChangeFailureRate(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<AvailableChangeFailureRateMetric | UnavailableMetric> {
    const result = await client.query<{ total_deployments: string; failed_deployments: string }>(
      `SELECT
         count(*) AS total_deployments,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM canonical_incidents ci
           JOIN enriched_incidents ei ON ei.id = ci.id
           WHERE ei.failure_classification = 'COUNTS_AS_FAILURE'
             AND ei.team_id = ed.team_id
             AND ci.triggered_at BETWEEN cd.finished_at AND cd.finished_at + ${CHANGE_FAILURE_RATE_WINDOW}
         )) AS failed_deployments
       FROM canonical_deployments cd
       JOIN enriched_deployments ed ON ed.id = cd.id
       WHERE ed.semantic_environment = 'PRODUCTION'
         AND cd.status = 'SUCCESS'
         AND cd.finished_at IS NOT NULL
         AND cd.started_at BETWEEN $1 AND $2
         ${teamId ? 'AND ed.team_id = $3' : ''}`,
      teamId ? [from, to, teamId] : [from, to],
    );

    const totalDeployments = Number(result.rows[0].total_deployments);
    if (totalDeployments === 0) {
      return CHANGE_FAILURE_RATE_UNAVAILABLE;
    }

    const failedDeployments = Number(result.rows[0].failed_deployments);

    return {
      available: true,
      totalDeployments,
      failedDeployments,
      rate: failedDeployments / totalDeployments,
      ...(teamId ? { scope: 'team' as const } : {}),
    };
  }

  /** Mesmo padrão de `queryDeploymentFrequency` — `total`/`byDay` de itens concluídos no período. */
  private async queryVelocity(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<DeploymentFrequencyMetric> {
    const result = await client.query<{ day: Date; count: string }>(
      `SELECT date_trunc('day', completed_at) AS day, count(*) AS count
       FROM enriched_work_items
       WHERE completed_at BETWEEN $1 AND $2
       ${teamId ? 'AND team_id = $3' : ''}
       GROUP BY 1
       ORDER BY 1`,
      teamId ? [from, to, teamId] : [from, to],
    );

    const byDay = result.rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      count: Number(row.count),
    }));
    const total = byDay.reduce((sum, day) => sum + day.count, 0);

    return { total, byDay, ...(teamId ? { scope: 'team' as const } : {}) };
  }

  /** Mesmo padrão de `queryLeadTime` — horas entre `started_working_at` e `completed_at`, itens concluídos no período. */
  private async queryCycleTime(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<AvailableDurationMetric | UnavailableMetric> {
    const result = await client.query<{ avg_hours: string | null; median_hours: string | null; sample_size: string }>(
      `SELECT
         avg(EXTRACT(EPOCH FROM (completed_at - started_working_at)) / 3600) AS avg_hours,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at - started_working_at)) / 3600) AS median_hours,
         count(*) AS sample_size
       FROM enriched_work_items
       WHERE completed_at BETWEEN $1 AND $2 AND started_working_at IS NOT NULL
       ${teamId ? 'AND team_id = $3' : ''}`,
      teamId ? [from, to, teamId] : [from, to],
    );

    const row = result.rows[0];
    const sampleSize = Number(row.sample_size);

    if (sampleSize === 0) {
      return CYCLE_TIME_UNAVAILABLE;
    }

    return {
      available: true,
      avgHours: row.avg_hours !== null ? Number(row.avg_hours) : null,
      medianHours: row.median_hours !== null ? Number(row.median_hours) : null,
      sampleSize,
      ...(teamId ? { scope: 'team' as const } : {}),
    };
  }

  private async queryDistribution(
    client: PoolClient,
    teamId: string | undefined,
  ): Promise<readonly FlowDistributionEntry[]> {
    const result = await client.query<{ semantic_category: string; count: string }>(
      `SELECT semantic_category, count(*) AS count
       FROM enriched_work_items
       ${teamId ? 'WHERE team_id = $1' : ''}
       GROUP BY semantic_category
       ORDER BY semantic_category`,
      teamId ? [teamId] : [],
    );

    return result.rows.map((row) => ({ category: row.semantic_category, count: Number(row.count) }));
  }

  private async queryWip(client: PoolClient, teamId: string | undefined): Promise<{ readonly count: number }> {
    const result = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM enriched_work_items WHERE semantic_state = 'IN_PROGRESS' ${teamId ? 'AND team_id = $1' : ''}`,
      teamId ? [teamId] : [],
    );

    return { count: Number(result.rows[0].count) };
  }
}
