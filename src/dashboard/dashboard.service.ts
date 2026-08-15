import type { Pool, PoolClient } from 'pg';
import { getPool, withTenantContext } from '../database/pool';
import { MetricTriggerConfigRepository } from './metric-trigger-config.repository';
import type {
  ChangeFailureRateTriggerConfig,
  DeploymentFrequencyTriggerConfig,
  LeadTimeTriggerConfig,
  MttrTriggerConfig,
  TriggerConfigSource,
} from './metric-trigger-config.types';
import type { SemanticCategory } from '../enrichment/domain-context.types';
import type { CicdProvider } from '../integrations/core/canonical.types';

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
  readonly deploymentFrequency: DeploymentFrequencyMetric | UnavailableMetric;
  readonly leadTimeForChanges: AvailableDurationMetric | UnavailableMetric;
  readonly meanTimeToRestore: AvailableDurationMetric | UnavailableMetric;
  readonly changeFailureRate: AvailableChangeFailureRateMetric | UnavailableMetric;
  /**
   * "O que foi usado pra calcular este número" (auditoria — Seção 6 da
   * spec). As 4 métricas já ecoam aqui — última a entrar foi
   * `leadTimeForChanges` (ver `DashboardService`, ordem de construção).
   */
  readonly appliedTriggerConfig: {
    readonly deploymentFrequency: TriggerConfigSource<DeploymentFrequencyTriggerConfig>;
    readonly leadTimeForChanges: TriggerConfigSource<LeadTimeTriggerConfig>;
    readonly meanTimeToRestore: TriggerConfigSource<MttrTriggerConfig>;
    readonly changeFailureRate: TriggerConfigSource<ChangeFailureRateTriggerConfig>;
  };
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
 * DORA como série temporal — mesmo espírito de `TeamProfileHistoryPoint`
 * (`team-profile.service.ts`): pontos semanais rolantes, cada um escopado à
 * sua própria janela `(ponto anterior, este ponto]`, não cumulativo. Só
 * `deploymentFrequency`/`changeFailureRate` (o par que forma o "quadrante"
 * DORA clássico) — Lead Time/MTTR são distribuições de duração, menos
 * naturais como barra semanal; se fizer falta depois, é a mesma extensão.
 */
export interface DoraHistoryPoint {
  readonly date: string;
  readonly deploymentFrequency: DeploymentFrequencyMetric | UnavailableMetric;
  readonly changeFailureRate: AvailableChangeFailureRateMetric | UnavailableMetric;
}

export interface DoraHistory {
  readonly points: readonly DoraHistoryPoint[];
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

const CYCLE_TIME_UNAVAILABLE: UnavailableMetric = {
  available: false,
  reason: 'Nenhum work item concluído (completed_at) neste período ainda.',
};

const DORA_HISTORY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Primeira camada de leitura agregada (DORA + Flow) — Seção 6 da spec.
 *
 * As 4 métricas de DORA já resolvem gatilho via `MetricTriggerConfigRepository`
 * (Time > Organização > Fallback do Sistema, mesma precedência de
 * `mapping_rules`) — chegaram 1 de cada vez, nessa ordem: Change Failure
 * Rate, Deployment Frequency, Mean Time to Restore, Lead Time. A
 * classificação semântica em si (o que é "produção", o que conta como
 * falha) continua configurável via `mapping_rules` — isso não muda, só o
 * "quando começa/termina o relógio".
 *
 * Lead Time com `endEvent: 'PR_MERGED'` (default) continua tenant-wide por
 * padrão — Pull Requests nunca passaram pela Enriched Layer e o conector do
 * GitHub escopa por organização (não por repo/time), então só filtra por
 * time quando `teamId` é passado (via `team_resource_links`). Com
 * `endEvent: 'CICD_DEPLOY'`, o vínculo com `team_resource_links` passa a
 * ser **obrigatório** mesmo sem `teamId` — precisa saber o time do PR pra
 * correlacionar com o deploy do mesmo time (ver `queryLeadTimeToDeployment`).
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 6.
 */
export class DashboardService {
  constructor(
    private readonly pool: Pool = getPool(),
    private readonly metricTriggerConfigRepository: MetricTriggerConfigRepository = new MetricTriggerConfigRepository(),
  ) {}

  async getDoraMetrics(tenantId: string, from: Date, to: Date, teamId?: string): Promise<DoraMetrics> {
    const effectiveTriggerConfig = await this.metricTriggerConfigRepository.getEffectiveTriggerConfig(
      tenantId,
      teamId ?? null,
    );

    return withTenantContext(this.pool, tenantId, async (client) => {
      const [deploymentFrequency, leadTimeForChanges, meanTimeToRestore, changeFailureRate] = await Promise.all([
        this.queryDeploymentFrequency(client, from, to, teamId, effectiveTriggerConfig.config.deploymentFrequency),
        this.queryLeadTime(client, from, to, teamId, effectiveTriggerConfig.config.leadTime),
        this.queryMeanTimeToRestore(client, from, to, teamId, effectiveTriggerConfig.config.meanTimeToRestore),
        this.queryChangeFailureRate(
          client,
          from,
          to,
          teamId,
          effectiveTriggerConfig.config.changeFailureRate.correlationWindowHours,
        ),
      ]);

      const appliedTriggerConfigSource = {
        source: effectiveTriggerConfig.source,
        teamId: teamId ?? null,
        updatedAt: effectiveTriggerConfig.updatedAt.toISOString(),
      };

      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        deploymentFrequency,
        leadTimeForChanges,
        meanTimeToRestore,
        changeFailureRate,
        appliedTriggerConfig: {
          deploymentFrequency: { config: effectiveTriggerConfig.config.deploymentFrequency, ...appliedTriggerConfigSource },
          leadTimeForChanges: { config: effectiveTriggerConfig.config.leadTime, ...appliedTriggerConfigSource },
          meanTimeToRestore: { config: effectiveTriggerConfig.config.meanTimeToRestore, ...appliedTriggerConfigSource },
          changeFailureRate: { config: effectiveTriggerConfig.config.changeFailureRate, ...appliedTriggerConfigSource },
        },
      };
    });
  }

  /**
   * `deploymentFrequency`/`changeFailureRate` recalculados por semana, cada
   * um escopado só à sua própria janela (não cumulativo) — reaproveita as
   * mesmas queries de `getDoraMetrics` sem alterá-las, só chamadas várias
   * vezes com `from`/`to` estreitos. Nenhuma das duas tem CTE pesada nem
   * subquery por linha custosa (`queryChangeFailureRate` é uma varredura +
   * `EXISTS` correlacionado simples), então rodar até 52x numa chamada não é
   * motivo de preocupação de performance.
   */
  async getDoraHistory(tenantId: string, teamId: string | undefined, weeks: number): Promise<DoraHistory> {
    // Resolvido uma vez pro `tenantId`/`teamId` inteiro (não por ponto semanal
    // — é o mesmo time ao longo de toda a série). Sem eco de
    // `appliedTriggerConfig` aqui, diferente de `getDoraMetrics`: repetir por
    // ponto seria ruído numa série já densa, e "o que foi usado" já fica
    // respondido no retrato principal (`/dashboard/dora`).
    const effectiveTriggerConfig = await this.metricTriggerConfigRepository.getEffectiveTriggerConfig(
      tenantId,
      teamId ?? null,
    );

    return withTenantContext(this.pool, tenantId, async (client) => {
      const now = new Date();
      const pointDates: Date[] = [];
      for (let i = weeks - 1; i >= 0; i -= 1) {
        pointDates.push(new Date(now.getTime() - i * DORA_HISTORY_WEEK_MS));
      }

      const points = await Promise.all(
        pointDates.map(async (date, index) => {
          const windowStart = index === 0 ? new Date(date.getTime() - DORA_HISTORY_WEEK_MS) : pointDates[index - 1];

          const [deploymentFrequency, changeFailureRate] = await Promise.all([
            this.queryDeploymentFrequency(
              client,
              windowStart,
              date,
              teamId,
              effectiveTriggerConfig.config.deploymentFrequency,
            ),
            this.queryChangeFailureRate(
              client,
              windowStart,
              date,
              teamId,
              effectiveTriggerConfig.config.changeFailureRate.correlationWindowHours,
            ),
          ]);

          return { date: date.toISOString().slice(0, 10), deploymentFrequency, changeFailureRate };
        }),
      );

      return { points };
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

  /**
   * Gatilho configurável (Seção 6 da spec): `CICD_DEPLOY` (default, mesmo
   * comportamento hardcoded de antes desta config existir) conta deploy de
   * produção via `canonical_deployments`/`enriched_deployments`.
   * `WORKFLOW_DONE_TRANSITION` conta transição pra `DONE` via
   * `enriched_work_items.completed_at` em vez disso — pensado pra time sem
   * pipeline de CI/CD rastreado, que usa a coluna "Done" do board como
   * proxy de "foi pra produção" (exemplo literal da spec). As duas fontes
   * são mutuamente exclusivas — nunca somadas.
   */
  private async queryDeploymentFrequency(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    config: DeploymentFrequencyTriggerConfig,
  ): Promise<DeploymentFrequencyMetric | UnavailableMetric> {
    if (config.startEvent === 'WORKFLOW_DONE_TRANSITION') {
      const rows = await this.queryDeploymentFrequencyFromWorkflowDone(client, from, to, teamId, config.categoryFilter);
      return this.toDeploymentFrequencyMetric(rows, teamId);
    }

    // Ambiguidade real: mais de um provider de CI/CD distinto com deploy de
    // produção neste escopo/período, sem o time ter escolhido qual conta —
    // mesmo deploy pode estar contado 2x (ex: github_actions + vercel, que
    // podem representar o mesmo release). Devolve indisponível em vez de um
    // número errado; `AlertRepository.evaluateDeploymentFrequencySourceAmbiguousAlert`
    // (via scan periódico) avisa proativamente sobre a mesma condição, sem
    // escopo de período (ver `DeploymentRepository.findTeamsWithMultipleProductionProviders`).
    const distinctProviders = await this.queryDistinctCicdProviders(client, from, to, teamId);
    if (distinctProviders.length > 1 && (!config.sourceProviders || config.sourceProviders.length === 0)) {
      return {
        available: false,
        reason: `Mais de uma integração de CI/CD (${distinctProviders.join(', ')}) tem deploy de produção registrado ${teamId ? 'para este time' : 'neste tenant'} — pode estar contando o mesmo deploy duas vezes. Configure "deploymentFrequency.sourceProviders" pra escolher qual conta.`,
      };
    }

    const rows = await this.queryDeploymentFrequencyFromCicdDeploy(client, from, to, teamId, config.sourceProviders);
    return this.toDeploymentFrequencyMetric(rows, teamId);
  }

  private toDeploymentFrequencyMetric(
    rows: readonly { readonly day: Date; readonly count: string }[],
    teamId: string | undefined,
  ): DeploymentFrequencyMetric {
    const byDay = rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      count: Number(row.count),
    }));
    const total = byDay.reduce((sum, day) => sum + day.count, 0);

    return { total, byDay, ...(teamId ? { scope: 'team' as const } : {}) };
  }

  private async queryDistinctCicdProviders(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
  ): Promise<readonly string[]> {
    const result = await client.query<{ provider: string }>(
      `SELECT DISTINCT cd.provider
       FROM enriched_deployments ed
       JOIN canonical_deployments cd ON cd.id = ed.id
       WHERE ed.semantic_environment = 'PRODUCTION' AND cd.started_at BETWEEN $1 AND $2
       ${teamId ? 'AND ed.team_id = $3' : ''}`,
      teamId ? [from, to, teamId] : [from, to],
    );

    return result.rows.map((row) => row.provider);
  }

  private async queryDeploymentFrequencyFromCicdDeploy(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    sourceProviders: readonly CicdProvider[] | undefined,
  ): Promise<readonly { readonly day: Date; readonly count: string }[]> {
    const hasSourceFilter = sourceProviders !== undefined && sourceProviders.length > 0;
    const teamParamIndex = 3;
    const sourceParamIndex = teamId ? 4 : 3;

    const params: unknown[] = [from, to];
    if (teamId) params.push(teamId);
    if (hasSourceFilter) params.push(sourceProviders);

    const result = await client.query<{ day: Date; count: string }>(
      `SELECT date_trunc('day', cd.started_at) AS day, count(*) AS count
       FROM enriched_deployments ed
       JOIN canonical_deployments cd ON cd.id = ed.id
       WHERE ed.semantic_environment = 'PRODUCTION' AND cd.started_at BETWEEN $1 AND $2
       ${teamId ? `AND ed.team_id = $${teamParamIndex}` : ''}
       ${hasSourceFilter ? `AND cd.provider = ANY($${sourceParamIndex})` : ''}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    return result.rows;
  }

  /**
   * `categoryFilter` vazio/ausente = sem filtro (conta toda categoria) —
   * mesma convenção de "array vazio/ausente não restringe" já usada em
   * `condition.values` do Domain Context Engine, não "filtra pra zero".
   */
  private async queryDeploymentFrequencyFromWorkflowDone(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    categoryFilter: readonly SemanticCategory[] | undefined,
  ): Promise<readonly { readonly day: Date; readonly count: string }[]> {
    const teamParamIndex = 3;
    const categoryParamIndex = teamId ? 4 : 3;
    const hasCategoryFilter = categoryFilter !== undefined && categoryFilter.length > 0;

    const params: unknown[] = [from, to];
    if (teamId) params.push(teamId);
    if (hasCategoryFilter) params.push(categoryFilter);

    const result = await client.query<{ day: Date; count: string }>(
      `SELECT date_trunc('day', completed_at) AS day, count(*) AS count
       FROM enriched_work_items
       WHERE completed_at BETWEEN $1 AND $2
       ${teamId ? `AND team_id = $${teamParamIndex}` : ''}
       ${hasCategoryFilter ? `AND semantic_category = ANY($${categoryParamIndex})` : ''}
       GROUP BY 1
       ORDER BY 1`,
      params,
    );

    return result.rows;
  }

  /**
   * Gatilho configurável (Seção 6 da spec, exemplo literal: "Início
   * configurável (1º commit ou abertura de card) e Fim configurável (Deploy
   * CI/CD ou Merge de PR)"). `startEvent: 'FIRST_COMMIT'` troca
   * `opened_at` por `first_commit_at` — nullable no schema (PR sem commit
   * sincronizado ainda), excluído da amostra quando ausente, mesma decisão
   * já tomada em `queryMeanTimeToRestore` (não cai silenciosamente pro
   * `opened_at`, pra não misturar duas metodologias na mesma média).
   * `endEvent: 'CICD_DEPLOY'` despacha pra `queryLeadTimeToDeployment`
   * (correlação aproximada, ver lá) em vez do merge direto. `CARD_OPENED`
   * **não existe** no enum — não há vínculo PR↔work item no schema hoje.
   */
  private async queryLeadTime(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    config: LeadTimeTriggerConfig,
  ): Promise<AvailableDurationMetric> {
    const startColumn = config.startEvent === 'FIRST_COMMIT' ? 'first_commit_at' : 'opened_at';

    const row =
      config.endEvent === 'CICD_DEPLOY'
        ? await this.queryLeadTimeToDeployment(client, from, to, teamId, startColumn)
        : await this.queryLeadTimeToMerge(client, from, to, teamId, startColumn);

    return {
      available: true,
      avgHours: row.avg_hours !== null ? Number(row.avg_hours) : null,
      medianHours: row.median_hours !== null ? Number(row.median_hours) : null,
      sampleSize: Number(row.sample_size),
      ...(teamId ? { scope: 'team' as const } : {}),
    };
  }

  private async queryLeadTimeToMerge(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    startColumn: 'opened_at' | 'first_commit_at',
  ): Promise<{ readonly avg_hours: string | null; readonly median_hours: string | null; readonly sample_size: string }> {
    const result = teamId
      ? await client.query<{ avg_hours: string | null; median_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (cpr.merged_at - cpr.${startColumn})) / 3600) AS avg_hours,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (cpr.merged_at - cpr.${startColumn})) / 3600) AS median_hours,
             count(*) AS sample_size
           FROM canonical_pull_requests cpr
           JOIN team_resource_links trl
             ON trl.provider = cpr.provider
             AND trl.resource_type = (CASE cpr.provider WHEN 'github' THEN 'github_repository' WHEN 'azure_repos' THEN 'azure_repos_repository' ELSE NULL END)
             AND trl.external_resource_id = cpr.repository
           WHERE cpr.state = 'MERGED' AND cpr.merged_at BETWEEN $1 AND $2
             AND cpr.${startColumn} IS NOT NULL AND trl.team_id = $3`,
          [from, to, teamId],
        )
      : await client.query<{ avg_hours: string | null; median_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (merged_at - ${startColumn})) / 3600) AS avg_hours,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (merged_at - ${startColumn})) / 3600) AS median_hours,
             count(*) AS sample_size
           FROM canonical_pull_requests
           WHERE state = 'MERGED' AND merged_at BETWEEN $1 AND $2 AND ${startColumn} IS NOT NULL`,
          [from, to],
        );

    return result.rows[0];
  }

  /**
   * `endEvent: 'CICD_DEPLOY'` — sem vínculo explícito PR→deploy nos dados
   * (mesma limitação do Change Failure Rate), correlacionado por
   * proximidade: o primeiro deploy de produção bem-sucedido do **mesmo
   * time**, iniciado depois do merge (`JOIN LATERAL ... LIMIT 1`, ordenado
   * por `started_at ASC`). Aproximado, não uma verdade absoluta — um PR
   * cujo time nunca teve deploy de produção depois do merge simplesmente
   * não entra na amostra (a lateral join não devolve linha, `count(*)` já
   * reflete só os pares de verdade correlacionados).
   *
   * Diferente de `queryLeadTimeToMerge`: o vínculo com `team_resource_links`
   * é **sempre obrigatório** aqui, mesmo sem `teamId` — precisa do time do
   * PR pra saber qual deploy corresponde. Um PR cujo repositório nunca foi
   * vinculado a nenhum time fica de fora mesmo numa chamada tenant-wide.
   */
  private async queryLeadTimeToDeployment(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    startColumn: 'opened_at' | 'first_commit_at',
  ): Promise<{ readonly avg_hours: string | null; readonly median_hours: string | null; readonly sample_size: string }> {
    const result = await client.query<{ avg_hours: string | null; median_hours: string | null; sample_size: string }>(
      `SELECT
         avg(EXTRACT(EPOCH FROM (deploy.started_at - cpr.${startColumn})) / 3600) AS avg_hours,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (deploy.started_at - cpr.${startColumn})) / 3600) AS median_hours,
         count(*) AS sample_size
       FROM canonical_pull_requests cpr
       JOIN team_resource_links trl
         ON trl.provider = cpr.provider
         AND trl.resource_type = (CASE cpr.provider WHEN 'github' THEN 'github_repository' WHEN 'azure_repos' THEN 'azure_repos_repository' ELSE NULL END)
         AND trl.external_resource_id = cpr.repository
       JOIN LATERAL (
         SELECT cd.started_at
         FROM canonical_deployments cd
         JOIN enriched_deployments ed ON ed.id = cd.id
         WHERE ed.semantic_environment = 'PRODUCTION' AND cd.status = 'SUCCESS'
           AND ed.team_id = trl.team_id
           AND cd.started_at >= cpr.merged_at
         ORDER BY cd.started_at ASC
         LIMIT 1
       ) deploy ON true
       WHERE cpr.state = 'MERGED' AND cpr.merged_at BETWEEN $1 AND $2
         AND cpr.${startColumn} IS NOT NULL
         ${teamId ? 'AND trl.team_id = $3' : ''}`,
      teamId ? [from, to, teamId] : [from, to],
    );

    return result.rows[0];
  }

  /**
   * Sem `teamId`: lê `canonical_incidents` direto, como sempre — não depende
   * do enriquecimento ter rodado. Com `teamId`: junta contra
   * `enriched_incidents.team_id`, que agora é resolvido por incidente (ver
   * `EnrichmentService.runIncidentEnrichment`), não mais por integração inteira.
   *
   * Gatilho configurável (Seção 6 da spec): `startEvent` troca
   * `triggered_at` (default) por `acknowledged_at`. Sem `endEvent`
   * configurável — `resolved_at` é o único sinal de "restaurado" que existe
   * nos dados (ver `MttrTriggerConfig`). `<startColumn> IS NOT NULL` é
   * incondicional nas duas queries abaixo: é sempre verdadeiro pra
   * `triggered_at` (`NOT NULL` no schema, não muda nada no default), mas
   * exclui da amostra incidente sem `acknowledged_at` quando esse é o
   * gatilho escolhido — não cai silenciosamente pra `triggered_at`.
   */
  private async queryMeanTimeToRestore(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    config: MttrTriggerConfig,
  ): Promise<AvailableDurationMetric> {
    const startColumn = config.startEvent === 'INCIDENT_ACKNOWLEDGED' ? 'acknowledged_at' : 'triggered_at';

    const result = teamId
      ? await client.query<{ avg_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (ci.resolved_at - ci.${startColumn})) / 3600) AS avg_hours,
             count(*) AS sample_size
           FROM canonical_incidents ci
           JOIN enriched_incidents ei ON ei.id = ci.id
           WHERE ci.resolved_at IS NOT NULL AND ci.resolved_at BETWEEN $1 AND $2
             AND ci.${startColumn} IS NOT NULL AND ei.team_id = $3`,
          [from, to, teamId],
        )
      : await client.query<{ avg_hours: string | null; sample_size: string }>(
          `SELECT
             avg(EXTRACT(EPOCH FROM (resolved_at - ${startColumn})) / 3600) AS avg_hours,
             count(*) AS sample_size
           FROM canonical_incidents
           WHERE resolved_at IS NOT NULL AND resolved_at BETWEEN $1 AND $2
             AND ${startColumn} IS NOT NULL`,
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
   * `correlationWindowHours` depois do deploy terminar — configurável por
   * time via `MetricTriggerConfigRepository` (Seção 6 da spec; default `1`,
   * ver `SYSTEM_DEFAULT_TRIGGER_CONFIG`, reproduz o valor que era hardcoded
   * antes desta config existir). Mesmo padrão de `queryDeploymentFrequency`:
   * `team_id` direto em `enriched_deployments`/`enriched_incidents`, sem
   * `team_resource_links` (ambos já passam pela Enriched Layer, diferente
   * de PRs).
   */
  private async queryChangeFailureRate(
    client: PoolClient,
    from: Date,
    to: Date,
    teamId: string | undefined,
    correlationWindowHours: number,
  ): Promise<AvailableChangeFailureRateMetric | UnavailableMetric> {
    // Em segundos, não horas: `make_interval(secs => ...)` aceita fração
    // (double precision), diferente do parâmetro `hours` (inteiro) —
    // permite configurar uma janela menor que 1h (ex: 30min) sem truncar.
    const correlationWindowSeconds = correlationWindowHours * 3600;
    const windowParamIndex = teamId ? 4 : 3;

    const result = await client.query<{ total_deployments: string; failed_deployments: string }>(
      `SELECT
         count(*) AS total_deployments,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM canonical_incidents ci
           JOIN enriched_incidents ei ON ei.id = ci.id
           WHERE ei.failure_classification = 'COUNTS_AS_FAILURE'
             AND ei.team_id = ed.team_id
             AND ci.triggered_at BETWEEN cd.finished_at AND cd.finished_at + make_interval(secs => $${windowParamIndex})
         )) AS failed_deployments
       FROM canonical_deployments cd
       JOIN enriched_deployments ed ON ed.id = cd.id
       WHERE ed.semantic_environment = 'PRODUCTION'
         AND cd.status = 'SUCCESS'
         AND cd.finished_at IS NOT NULL
         AND cd.started_at BETWEEN $1 AND $2
         ${teamId ? 'AND ed.team_id = $3' : ''}`,
      teamId ? [from, to, teamId, correlationWindowSeconds] : [from, to, correlationWindowSeconds],
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
