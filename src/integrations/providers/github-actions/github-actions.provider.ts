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

const GITHUB_DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PER_PAGE = 100;

/** Referência mínima a um usuário do GitHub. */
interface GitHubUserRef {
  readonly id: number;
  readonly login: string;
  readonly avatar_url?: string;
}

/** Subconjunto tipado de `GET /repos/{owner}/{repo}/deployments`. */
interface GitHubDeployment {
  readonly id: number;
  readonly sha: string;
  readonly environment: string;
  readonly created_at: string;
  readonly creator: GitHubUserRef | null;
}

/** Subconjunto tipado de `GET .../deployments/{id}/statuses`. */
interface GitHubDeploymentStatus {
  readonly state: string;
  readonly created_at: string;
}

/** Subconjunto tipado de `GET /orgs/{org}/repos`. */
interface GitHubRepo {
  readonly full_name: string;
}

/**
 * Cursor do modo "org inteira" (`credentials.extra.repository` omitido) —
 * a lista de repos é descoberta uma única vez (primeira chamada, sem
 * `context.cursor`) e viaja dentro do próprio cursor daí em diante, já que
 * `syncIncremental` só processa uma página de um repo por vez (mesmo
 * contrato de todo provider incremental: uma chamada, um passo, retomado no
 * próximo tick do scheduler — ver `.github/workflows/sync.yml`).
 */
interface OrgWideCursorState {
  readonly repos: readonly string[];
  readonly repoIndex: number;
  readonly page: number;
}

/** Resultado de processar uma página de deployments de um único repositório. */
interface RepositoryPageResult {
  readonly deployments: CanonicalDeployment[];
  readonly discoveredIdentities: Map<string, CanonicalDiscoveredIdentity>;
  readonly errors: string[];
  readonly hasMorePages: boolean;
}

/**
 * Conector de CI/CD para o GitHub Actions (Deployments API).
 *
 * Traduz deploys para `CanonicalDeployment`, alimentando Deployment
 * Frequency (DORA) — Seção 2 da spec.
 *
 * Usa a Deployments API (`/deployments`), não a API de workflow runs
 * (`/actions/runs`): a API de deployments é o sinal explícito de "isso foi
 * marcado como deploy" por quem configura o pipeline — usar workflow runs
 * exigiria uma heurística tipo "run com sucesso na main = deploy", que
 * seria hardcoded o gatilho de deploy no conector (proibido pela spec —
 * ver comentário em `CanonicalDeployment`, Seção 6).
 *
 * `credentials.extra.repository` é **opcional**: se informado, sincroniza só
 * aquele repo (comportamento original). Se omitido, sincroniza **todos os
 * repos** de `credentials.extra.organization` (esse vira obrigatório nesse
 * caso) — mesma lógica de `projectKey`/`teamKey` opcionais no Jira/Linear.
 * Diferente deles, porém, a Deployments API não tem busca cross-repo, então
 * o modo "org inteira" primeiro descobre a lista de repos (`GET
 * /orgs/{org}/repos`) e depois itera um repo por vez — ver
 * `OrgWideCursorState`.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class GitHubActionsProvider extends BaseProvider {
  readonly providerName = 'github_actions';
  readonly category: ProviderCategory = 'cicd';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const token = this.resolveApiToken(credentials);
      const repository = this.resolveRepository(credentials);
      if (!repository) {
        this.resolveOrganization(credentials);
      }
      const baseUrl = credentials.baseUrl ?? GITHUB_DEFAULT_BASE_URL;

      const response = await fetch(`${baseUrl}/user`, {
        headers: this.buildHeaders(token),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `GitHub respondeu ${response.status} ${response.statusText} em /user.`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const token = this.resolveApiToken(context.credentials);
      const repository = this.resolveRepository(context.credentials);
      const baseUrl = context.credentials.baseUrl ?? GITHUB_DEFAULT_BASE_URL;
      const headers = this.buildHeaders(token);
      const perPage = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PER_PAGE);

      if (repository) {
        const page = context.cursor ? Number.parseInt(context.cursor, 10) : 1;
        const result = await this.fetchRepositoryPage(baseUrl, repository, page, perPage, headers, context.tenantId);

        return {
          success: true,
          nextCursor: result.hasMorePages ? String(page + 1) : null,
          fetchedCount: result.deployments.length,
          deployments: result.deployments,
          discoveredIdentities:
            result.discoveredIdentities.size > 0 ? [...result.discoveredIdentities.values()] : undefined,
          errors: result.errors.length > 0 ? result.errors : undefined,
        };
      }

      return await this.syncOrgWide(context, baseUrl, headers, perPage);
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
  }

  /**
   * Modo "org inteira": descobre a lista de repos na primeira chamada (sem
   * `context.cursor`) e a carrega dentro do próprio cursor dali em diante,
   * processando um repo por vez, uma página por chamada — mesmo contrato de
   * todo provider incremental (uma chamada = um passo, retomado no próximo
   * tick do scheduler).
   */
  private async syncOrgWide(
    context: SyncContext,
    baseUrl: string,
    headers: Record<string, string>,
    perPage: number,
  ): Promise<SyncResult> {
    const organization = this.resolveOrganization(context.credentials);

    const state: OrgWideCursorState = context.cursor
      ? (JSON.parse(context.cursor) as OrgWideCursorState)
      : { repos: await this.fetchAllOrgRepositories(baseUrl, organization, headers), repoIndex: 0, page: 1 };

    if (state.repos.length === 0) {
      return { success: true, nextCursor: null, fetchedCount: 0 };
    }

    const repository = state.repos[state.repoIndex];
    const result = await this.fetchRepositoryPageSafely(
      baseUrl,
      repository,
      state.page,
      perPage,
      headers,
      context.tenantId,
    );

    const nextState: OrgWideCursorState = result.hasMorePages
      ? { ...state, page: state.page + 1 }
      : { ...state, repoIndex: state.repoIndex + 1, page: 1 };
    const isDone = nextState.repoIndex >= nextState.repos.length;

    return {
      success: true,
      nextCursor: isDone ? null : JSON.stringify(nextState),
      fetchedCount: result.deployments.length,
      deployments: result.deployments,
      discoveredIdentities:
        result.discoveredIdentities.size > 0 ? [...result.discoveredIdentities.values()] : undefined,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  }

  /**
   * Mesma coisa que `fetchRepositoryPage`, mas nunca lança — usada só pelo
   * modo "org inteira". Um repo com deployments desabilitados/sem permissão
   * (403/404 pontual, já visto ao vivo: repo de outro time sem `deployments`
   * habilitado pro token) não pode travar o cursor pra sempre — vira erro
   * suave e o cursor avança pro próximo repo mesmo assim, igual o
   * tratamento já existente por-deployment dentro de `fetchRepositoryPage`.
   */
  private async fetchRepositoryPageSafely(
    baseUrl: string,
    repository: string,
    page: number,
    perPage: number,
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<RepositoryPageResult> {
    try {
      return await this.fetchRepositoryPage(baseUrl, repository, page, perPage, headers, tenantId);
    } catch (error) {
      return {
        deployments: [],
        discoveredIdentities: new Map(),
        errors: [this.describeError(error)],
        hasMorePages: false,
      };
    }
  }

  /** Busca e mapeia uma única página de deployments de um único repositório. */
  private async fetchRepositoryPage(
    baseUrl: string,
    repository: string,
    page: number,
    perPage: number,
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<RepositoryPageResult> {
    const listUrl = this.buildDeploymentsUrl(baseUrl, repository, page, perPage);
    const listResponse = await fetch(listUrl, { headers });

    if (!listResponse.ok) {
      throw new Error(
        `[${this.providerName}] Falha ao buscar deployments de "${repository}": ${listResponse.status} ${listResponse.statusText}.`,
      );
    }

    const deploymentsList = (await listResponse.json()) as readonly GitHubDeployment[];
    const errors: string[] = [];
    const deployments: CanonicalDeployment[] = [];
    const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();

    for (const item of deploymentsList) {
      try {
        const latestStatus = await this.fetchLatestStatus(baseUrl, repository, item.id, headers);
        deployments.push(this.mapToCanonicalDeployment(item, latestStatus, repository, tenantId));

        if (item.creator) {
          const identity = this.mapToDiscoveredIdentity(item.creator, tenantId);
          discoveredIdentities.set(identity.externalUserId, identity);
        }
      } catch (itemError) {
        errors.push(
          `[${this.providerName}] Falha ao processar deployment #${item.id} de "${repository}": ${this.describeError(itemError)}`,
        );
      }
    }

    return { deployments, discoveredIdentities, errors, hasMorePages: deploymentsList.length === perPage };
  }

  /**
   * Pagina `GET /orgs/{org}/repos` até esgotar — custo pago uma vez só, na
   * primeira chamada do modo "org inteira" (sem cursor ainda). Pra orgs com
   * milhares de repos isso pode ser lento nessa primeira chamada; fora de
   * escopo otimizar agora (mesmo tipo de trade-off já assumido no conector
   * do ArgoCD pra `GET /api/v1/applications`).
   */
  private async fetchAllOrgRepositories(
    baseUrl: string,
    organization: string,
    headers: Record<string, string>,
  ): Promise<readonly string[]> {
    const repos: string[] = [];
    let page = 1;

    for (;;) {
      const url = new URL(`${baseUrl}/orgs/${organization}/repos`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('per_page', String(MAX_PER_PAGE));

      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(
          `[${this.providerName}] Falha ao listar repos de "${organization}": ${response.status} ${response.statusText}.`,
        );
      }

      const items = (await response.json()) as readonly GitHubRepo[];
      repos.push(...items.map((item) => item.full_name));

      if (items.length < MAX_PER_PAGE) {
        break;
      }
      page += 1;
    }

    return repos;
  }

  /**
   * Extrai o token de acesso (`ProviderCredentials.apiToken`) já validado.
   *
   * @throws {Error} Quando `apiToken` não foi informado.
   */
  private resolveApiToken(credentials: ProviderCredentials): string {
    this.validateRequiredCredentials(credentials, ['apiToken']);

    const { apiToken } = credentials;
    if (!apiToken) {
      // Inalcançável: validateRequiredCredentials já lança acima quando ausente.
      throw new Error(`[${this.providerName}] apiToken ausente.`);
    }

    return apiToken;
  }

  /**
   * `undefined` quando omitido (ou string vazia — formulário de front
   * manda `""`, não ausência do campo) dispara o modo "org inteira"
   * (`syncOrgWide`), já que a Deployments API do GitHub não tem busca
   * cross-repo (diferente da Search API usada pelo conector de PRs). Mesma
   * lógica de `JiraProvider.resolveProjectKey`.
   */
  private resolveRepository(credentials: ProviderCredentials): string | undefined {
    const repository = credentials.extra?.repository;
    return typeof repository === 'string' && repository.length > 0 ? repository : undefined;
  }

  /** Só é chamado (e exigido) quando `credentials.extra.repository` foi omitido. */
  private resolveOrganization(credentials: ProviderCredentials): string {
    const organization = credentials.extra?.organization;

    if (!organization || typeof organization !== 'string') {
      throw new Error(
        `[${this.providerName}] credentials.extra.organization ausente — obrigatório quando credentials.extra.repository não é informado (modo "toda a org").`,
      );
    }

    return organization;
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private buildDeploymentsUrl(baseUrl: string, repository: string, page: number, perPage: number): URL {
    const url = new URL(`${baseUrl}/repos/${repository}/deployments`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));

    return url;
  }

  /**
   * Busca só o status mais recente (`per_page=1`) — a API já devolve o mais
   * recente primeiro, sem precisar paginar tudo pra saber o estado atual.
   */
  private async fetchLatestStatus(
    baseUrl: string,
    repository: string,
    deploymentId: number,
    headers: Record<string, string>,
  ): Promise<GitHubDeploymentStatus | null> {
    const url = `${baseUrl}/repos/${repository}/deployments/${deploymentId}/statuses?per_page=1`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`GET ${url} retornou ${response.status} ${response.statusText}.`);
    }

    const statuses = (await response.json()) as readonly GitHubDeploymentStatus[];
    return statuses[0] ?? null;
  }

  private mapStatus(state: string | undefined): CanonicalDeploymentStatus {
    switch (state) {
      case 'success':
        return 'SUCCESS';
      case 'failure':
      case 'error':
        return 'FAILURE';
      case 'inactive':
        return 'CANCELLED';
      case 'in_progress':
      case 'queued':
      case 'pending':
      default:
        return 'IN_PROGRESS';
    }
  }

  private isTerminalState(state: string | undefined): boolean {
    return state === 'success' || state === 'failure' || state === 'error';
  }

  private mapToCanonicalDeployment(
    deployment: GitHubDeployment,
    latestStatus: GitHubDeploymentStatus | null,
    repository: string,
    tenantId: string,
  ): CanonicalDeployment {
    return {
      tenantId,
      provider: 'github_actions',
      externalId: String(deployment.id),
      environment: deployment.environment,
      status: this.mapStatus(latestStatus?.state),
      serviceName: repository,
      commitSha: deployment.sha,
      triggeredByExternalId: deployment.creator ? String(deployment.creator.id) : null,
      startedAt: new Date(deployment.created_at),
      finishedAt:
        latestStatus && this.isTerminalState(latestStatus.state) ? new Date(latestStatus.created_at) : null,
      // Mesmo repositório já usado pro vínculo de time dos PRs
      // (`team_resource_links`, `resourceType: 'github_repository'`) — um
      // repo já vinculado pra PRs resolve deployment também, sem vincular de novo.
      externalGroupKey: repository,
    };
  }

  private mapToDiscoveredIdentity(user: GitHubUserRef, tenantId: string): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'github_actions',
      externalUserId: String(user.id),
      externalUsername: user.login,
      externalAvatarUrl: user.avatar_url ?? null,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('github_actions', GitHubActionsProvider);
