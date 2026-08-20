import { BaseProvider } from '../../core/base.provider';
import { ProviderFactory } from '../../core/provider.factory';
import type {
  CanonicalDeployment,
  CanonicalDeploymentStatus,
  CanonicalDiscoveredIdentity,
  ProviderCategory,
  ProviderCredentials,
  SyncContext,
  SyncResult,
} from '../../core/canonical.types';

const VERCEL_BASE_URL = 'https://api.vercel.com';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PER_PAGE = 100;

/** Subconjunto tipado de um item de `GET /v6/deployments` — API REST oficial, bem documentada (diferente do Fly.io). */
interface VercelDeployment {
  readonly uid: string;
  readonly name: string;
  readonly projectId: string;
  readonly createdAt: number;
  readonly ready?: number;
  readonly readyState: 'BLOCKED' | 'BUILDING' | 'CANCELED' | 'DELETED' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY';
  readonly target?: 'production' | 'staging' | null;
  readonly creator?: {
    readonly uid: string;
    readonly username?: string;
    readonly email?: string;
  } | null;
  readonly meta?: {
    readonly githubCommitSha?: string;
    readonly gitlabCommitSha?: string;
    readonly bitbucketCommitSha?: string;
  };
}

interface VercelDeploymentsResponse {
  readonly deployments: readonly VercelDeployment[];
  readonly pagination: { readonly next: number | null };
}

/**
 * Conector de CI/CD para a Vercel (`GET /v6/deployments`).
 *
 * API REST oficial e bem documentada (diferente do Fly.io — ver decisão
 * registrada no plano desta rodada: sem conector dedicado pro Fly.io porque
 * a única forma de listar releases lá é uma API GraphQL não-documentada, sem
 * garantia de estabilidade; deploys no Fly.io feitos via GitHub Actions já
 * são cobertos pelo conector `github_actions`, desde que o job declare
 * `environment:` pra o GitHub criar o Deployment de verdade).
 *
 * Não filtra por `target=production` na chamada — traz tudo e deixa a
 * classificação de ambiente pra Enriched Layer (`mapping_rules.deploymentEnvironment`),
 * mesma filosofia do resto dos conectores CI/CD (nunca decidir semântica no
 * conector).
 *
 * `credentials.extra.projectId` **opcional**: informado, sincroniza só
 * aquele projeto Vercel; omitido, sincroniza todos os projetos visíveis ao
 * token e o time é resolvido depois via vínculo pós-sync (`vercel`+`vercel_project`,
 * `externalGroupKey = deployment.name`, o nome do projeto — não
 * `projectId`, que é opaco e apareceria cru na tela de vínculo).
 * `credentials.extra.vercelTeamId` também
 * opcional — só necessário se o token for de conta pessoal usada num
 * contexto de time/org da Vercel (nome deliberadamente diferente de
 * `teamId`, que já é o time da nossa própria plataforma).
 *
 * **Atenção pro par com o conector GitHub Actions**: se o projeto Vercel
 * estiver conectado ao GitHub, o app oficial da Vercel já cria um
 * "Deployment" de verdade na API do GitHub a cada push — conectar `vercel`
 * **e** `github_actions` pro mesmo time pode contar o mesmo deploy duas
 * vezes em Deployment Frequency. Ver `DeploymentFrequencyTriggerConfig.sourceProviders`
 * pra resolver isso (o time escolhe qual provider conta).
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class VercelProvider extends BaseProvider {
  readonly providerName = 'vercel';
  readonly category: ProviderCategory = 'cicd';

  async testConnection(credentials: ProviderCredentials): Promise<{ success: boolean; message?: string }> {
    try {
      const apiToken = this.resolveApiToken(credentials);
      const url = this.buildDeploymentsUrl(credentials, undefined, 1);
      const response = await fetch(url, { headers: this.buildHeaders(apiToken) });

      if (!response.ok) {
        return {
          success: false,
          message: `Vercel respondeu ${response.status} ${response.statusText} em /v6/deployments.`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  /**
   * Paginação real via `until` (não "descobre tudo de uma vez" como
   * ArgoCD/Azure Pipelines) — volume de deploys da Vercel inclui preview de
   * PR, pode ser grande. Sem `context.cursor`, busca a página mais recente;
   * com cursor, continua puxando páginas mais antigas (`pagination.next` da
   * chamada anterior) até `null` — mesmo contrato "uma chamada, um passo" do
   * resto dos conectores incrementais.
   */
  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const apiToken = this.resolveApiToken(context.credentials);
      const perPage = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PER_PAGE);
      const until = context.cursor ? Number.parseInt(context.cursor, 10) : undefined;

      const url = this.buildDeploymentsUrl(context.credentials, until, perPage);
      const response = await fetch(url, { headers: this.buildHeaders(apiToken) });

      if (!response.ok) {
        throw new Error(`Vercel respondeu ${response.status} ${response.statusText} em /v6/deployments.`);
      }

      const body = (await response.json()) as VercelDeploymentsResponse;
      const deployments: CanonicalDeployment[] = [];
      const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();

      for (const item of body.deployments) {
        deployments.push(this.mapToCanonicalDeployment(item, context.tenantId));

        if (item.creator) {
          const identity = this.mapToDiscoveredIdentity(item.creator, context.tenantId);
          discoveredIdentities.set(identity.externalUserId, identity);
        }
      }

      return {
        success: true,
        nextCursor: body.pagination.next !== null ? String(body.pagination.next) : null,
        fetchedCount: deployments.length,
        deployments,
        discoveredIdentities: discoveredIdentities.size > 0 ? [...discoveredIdentities.values()] : undefined,
      };
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
  }

  private resolveApiToken(credentials: ProviderCredentials): string {
    this.validateRequiredCredentials(credentials, ['apiToken']);
    const { apiToken } = credentials;
    if (!apiToken) {
      // Inalcançável: validateRequiredCredentials já lança acima quando ausente.
      throw new Error(`[${this.providerName}] apiToken ausente.`);
    }
    return apiToken;
  }

  private resolveVercelTeamId(credentials: ProviderCredentials): string | undefined {
    const vercelTeamId = credentials.extra?.vercelTeamId;
    return typeof vercelTeamId === 'string' && vercelTeamId.length > 0 ? vercelTeamId : undefined;
  }

  private resolveProjectId(credentials: ProviderCredentials): string | undefined {
    const projectId = credentials.extra?.projectId;
    return typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined;
  }

  private buildDeploymentsUrl(credentials: ProviderCredentials, until: number | undefined, limit: number): URL {
    const url = new URL(`${VERCEL_BASE_URL}/v6/deployments`);
    url.searchParams.set('limit', String(limit));

    const vercelTeamId = this.resolveVercelTeamId(credentials);
    if (vercelTeamId) url.searchParams.set('teamId', vercelTeamId);

    const projectId = this.resolveProjectId(credentials);
    if (projectId) url.searchParams.set('projectId', projectId);

    if (until !== undefined) url.searchParams.set('until', String(until));

    return url;
  }

  private buildHeaders(apiToken: string): Record<string, string> {
    return { Authorization: `Bearer ${apiToken}` };
  }

  private mapStatus(readyState: VercelDeployment['readyState']): CanonicalDeploymentStatus {
    switch (readyState) {
      case 'READY':
        return 'SUCCESS';
      case 'ERROR':
        return 'FAILURE';
      case 'CANCELED':
      case 'DELETED':
        return 'CANCELLED';
      case 'BUILDING':
      case 'INITIALIZING':
      case 'QUEUED':
      case 'BLOCKED':
      default:
        return 'IN_PROGRESS';
    }
  }

  private isTerminalState(readyState: VercelDeployment['readyState']): boolean {
    return readyState === 'READY' || readyState === 'ERROR' || readyState === 'CANCELED';
  }

  private mapToCanonicalDeployment(deployment: VercelDeployment, tenantId: string): CanonicalDeployment {
    return {
      tenantId,
      provider: 'vercel',
      externalId: deployment.uid,
      // Cru, sem classificação semântica ("production"/"staging"/null) —
      // quem decide "é produção" é a Enriched Layer via mapping_rules,
      // mesmo princípio do GitHub Actions/Azure Pipelines.
      environment: deployment.target ?? 'unknown',
      status: this.mapStatus(deployment.readyState),
      serviceName: deployment.name,
      commitSha: deployment.meta?.githubCommitSha ?? deployment.meta?.gitlabCommitSha ?? deployment.meta?.bitbucketCommitSha ?? null,
      triggeredByExternalId: deployment.creator?.uid ?? null,
      startedAt: new Date(deployment.createdAt),
      finishedAt: this.isTerminalState(deployment.readyState) && deployment.ready ? new Date(deployment.ready) : null,
      // Projeto Vercel — mesmo padrão de `spec.project` do ArgoCD, alimenta
      // o vínculo pós-sync (`vercel`+`vercel_project`). Usa `deployment.name`
      // (a Vercel preenche isso com o nome do projeto, não um nome de
      // deployment à parte — mesmo valor já usado em `serviceName` acima),
      // não `deployment.projectId` — o `projectId` é opaco (`prj_...`),
      // apareceria cru na tela de "vincular time" sem nenhum contexto,
      // diferente do repo do GitHub/chave do Jira, que já são legíveis por
      // natureza. Mesmo trade-off que já existe pro nome de repo do GitHub
      // (também pode ser renomeado) — não é uma categoria de risco nova.
      externalGroupKey: deployment.name,
    };
  }

  private mapToDiscoveredIdentity(
    creator: NonNullable<VercelDeployment['creator']>,
    tenantId: string,
  ): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'vercel',
      externalUserId: creator.uid,
      externalUsername: creator.username ?? null,
      externalEmail: creator.email ?? null,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('vercel', VercelProvider);
