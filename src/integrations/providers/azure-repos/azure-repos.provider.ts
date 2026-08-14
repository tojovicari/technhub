import { BaseProvider } from '../../core/base.provider';
import { ProviderFactory } from '../../core/provider.factory';
import type {
  CanonicalDiscoveredIdentity,
  CanonicalPullRequest,
  CanonicalPullRequestState,
  ProviderCategory,
  ProviderCredentials,
  SyncContext,
  SyncResult,
} from '../../core/canonical.types';

const API_VERSION = '7.1';
const DEFAULT_PAGE_SIZE = 50;
const MAX_PER_PAGE = 100;

interface AzureIdentityRef {
  readonly id: string;
  readonly displayName: string;
  readonly uniqueName?: string;
  readonly imageUrl?: string;
}

interface AzureProjectRef {
  readonly name: string;
}

interface AzureRepositoryRef {
  readonly name: string;
  readonly project: AzureProjectRef;
}

/** Subconjunto tipado de `GET .../git/pullrequests`, um item de `value[]`. */
interface AzurePullRequest {
  readonly pullRequestId: number;
  readonly repository: AzureRepositoryRef;
  readonly title: string;
  /** 'active' | 'abandoned' | 'completed' — Azure Repos não tem 'draft' como status separado aqui. */
  readonly status: string;
  readonly createdBy: AzureIdentityRef;
  readonly reviewers: readonly (AzureIdentityRef & { readonly vote?: number })[];
  readonly sourceRefName: string;
  readonly targetRefName: string;
  readonly creationDate: string;
  readonly closedDate?: string;
}

interface AzurePullRequestListResponse {
  readonly value: readonly AzurePullRequest[];
}

/** Subconjunto tipado de `GET .../pullrequests/{id}/iterations/{iterationId}/changes`. */
interface AzurePullRequestChange {
  readonly item?: { readonly path?: string };
  readonly changeType?: string;
}

interface AzurePullRequestChangesResponse {
  readonly changeEntries: readonly AzurePullRequestChange[];
}

interface AzurePullRequestIteration {
  readonly id: number;
}

interface AzurePullRequestIterationsResponse {
  readonly value: readonly AzurePullRequestIteration[];
}

/** Subconjunto tipado de `GET .../pullrequests/{id}/commits`, um item de `value[]`. */
interface AzureCommitRef {
  readonly author?: { readonly date?: string };
  readonly committer?: { readonly date?: string };
}

interface AzurePullRequestCommitsResponse {
  readonly value: readonly AzureCommitRef[];
}

interface AzureProject {
  readonly name: string;
}

interface AzureProjectListResponse {
  readonly value: readonly AzureProject[];
}

/**
 * Cursor do modo "organização inteira" (`credentials.extra.project`
 * omitido) — mesma forma de `OrgWideCursorState` do GitHub Actions: a lista
 * de Projects é descoberta uma vez (primeira chamada) e viaja dentro do
 * próprio cursor, processando um Project por vez.
 */
interface OrgWideCursorState {
  readonly projects: readonly string[];
  readonly projectIndex: number;
  readonly skip: number;
}

interface ProjectPageResult {
  readonly pullRequests: CanonicalPullRequest[];
  readonly discoveredIdentities: Map<string, CanonicalDiscoveredIdentity>;
  readonly errors: string[];
  readonly hasMorePages: boolean;
}

/**
 * Conector de Version Control para o Azure Repos (Azure DevOps Services REST API).
 *
 * Traduz Pull Requests para `CanonicalPullRequest`, alimentando DORA (Lead
 * Time for Changes), SPACE (Activity, Communication & Collaboration) e
 * métricas operacionais de Code Churn — mesmo papel do GitHub (Seção 2).
 *
 * Diferente do GitHub (Search API cross-repo), o Azure Repos não tem busca
 * cross-project — cada Project precisa ser consultado separadamente. Se
 * `credentials.extra.project` for informado, sincroniza só aquele Project
 * (`organization` continua obrigatório); se omitido, descobre todos os
 * Projects (`GET /_apis/projects`) e itera um por vez, mesmo padrão
 * "descobre depois anda" do `GitHubActionsProvider` no modo org-wide.
 *
 * **Sem `externalGroupKey`** — mesma decisão do GitHub: `repository` (aqui
 * no formato `"{project}/{repo}"`) já é a chave natural de vínculo de time
 * via `team_resource_links` (`resourceType: 'azure_repos_repository'`).
 *
 * **Não verificado ao vivo ainda** (mesma ressalva do ArgoCD/Azure Boards).
 * Maior incerteza: não confirmado se `GET .../pullrequests/{id}/commits`
 * devolve em ordem cronológica ascendente por padrão como o GitHub faz —
 * assumido que sim pra `firstCommitAt`, revisar no primeiro teste real.
 *
 * **Limitação conhecida, não incerteza**: `linesAdded`/`linesDeleted`/
 * `commentsCount` sempre `0` — a listagem básica de PRs do Azure Repos não
 * expõe essas contagens (precisaria de chamadas extras por PR a
 * Threads/Iterations pra reconstruir, fora de escopo desta rodada). Code
 * Churn/Retrabalho (que usa `changedFiles`, esse sim populado) não é afetado.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class AzureReposProvider extends BaseProvider {
  readonly providerName = 'azure_repos';
  readonly category: ProviderCategory = 'vcs';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const apiToken = this.resolveApiToken(credentials);
      const organization = this.resolveOrganization(credentials);
      const headers = this.buildHeaders(apiToken);

      const response = await fetch(
        `https://dev.azure.com/${organization}/_apis/projects?api-version=${API_VERSION}`,
        { headers },
      );

      if (!response.ok) {
        return {
          success: false,
          message: `Azure DevOps respondeu ${response.status} ${response.statusText} em /projects.`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const apiToken = this.resolveApiToken(context.credentials);
      const organization = this.resolveOrganization(context.credentials);
      const project = this.resolveProject(context.credentials);
      const headers = this.buildHeaders(apiToken);
      const top = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PER_PAGE);

      if (project) {
        const skip = context.cursor ? Number(context.cursor) : 0;
        const result = await this.fetchProjectPage(organization, project, skip, top, headers, context.tenantId);

        return {
          success: true,
          nextCursor: result.hasMorePages ? String(skip + top) : null,
          fetchedCount: result.pullRequests.length,
          pullRequests: result.pullRequests,
          discoveredIdentities:
            result.discoveredIdentities.size > 0 ? [...result.discoveredIdentities.values()] : undefined,
          errors: result.errors.length > 0 ? result.errors : undefined,
        };
      }

      return await this.syncOrgWide(context, organization, headers, top);
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
  }

  /** Modo "organização inteira" — mesmo contrato do `syncOrgWide` do GitHub Actions. */
  private async syncOrgWide(
    context: SyncContext,
    organization: string,
    headers: Record<string, string>,
    top: number,
  ): Promise<SyncResult> {
    const state: OrgWideCursorState = context.cursor
      ? (JSON.parse(context.cursor) as OrgWideCursorState)
      : { projects: await this.fetchAllProjects(organization, headers), projectIndex: 0, skip: 0 };

    if (state.projects.length === 0) {
      return { success: true, nextCursor: null, fetchedCount: 0 };
    }

    const project = state.projects[state.projectIndex];
    const result = await this.fetchProjectPageSafely(organization, project, state.skip, top, headers, context.tenantId);

    const nextState: OrgWideCursorState = result.hasMorePages
      ? { ...state, skip: state.skip + top }
      : { ...state, projectIndex: state.projectIndex + 1, skip: 0 };
    const isDone = nextState.projectIndex >= nextState.projects.length;

    return {
      success: true,
      nextCursor: isDone ? null : JSON.stringify(nextState),
      fetchedCount: result.pullRequests.length,
      pullRequests: result.pullRequests,
      discoveredIdentities:
        result.discoveredIdentities.size > 0 ? [...result.discoveredIdentities.values()] : undefined,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  }

  /** Nunca lança — um Project sem permissão/PRs desabilitados não pode travar o cursor pra sempre. */
  private async fetchProjectPageSafely(
    organization: string,
    project: string,
    skip: number,
    top: number,
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<ProjectPageResult> {
    try {
      return await this.fetchProjectPage(organization, project, skip, top, headers, tenantId);
    } catch (error) {
      return { pullRequests: [], discoveredIdentities: new Map(), errors: [this.describeError(error)], hasMorePages: false };
    }
  }

  private async fetchProjectPage(
    organization: string,
    project: string,
    skip: number,
    top: number,
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<ProjectPageResult> {
    const listUrl = new URL(`https://dev.azure.com/${organization}/${project}/_apis/git/pullrequests`);
    listUrl.searchParams.set('searchCriteria.status', 'all');
    listUrl.searchParams.set('$top', String(top));
    listUrl.searchParams.set('$skip', String(skip));
    listUrl.searchParams.set('api-version', API_VERSION);

    const listResponse = await fetch(listUrl, { headers });
    if (!listResponse.ok) {
      throw new Error(
        `[${this.providerName}] Falha ao buscar Pull Requests de "${project}": ${listResponse.status} ${listResponse.statusText}.`,
      );
    }

    const { value: prs } = (await listResponse.json()) as AzurePullRequestListResponse;
    const errors: string[] = [];
    const pullRequests: CanonicalPullRequest[] = [];
    const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();

    for (const pr of prs) {
      try {
        const [changedFiles, firstCommitAt] = await Promise.all([
          this.fetchChangedFiles(organization, project, pr.pullRequestId, headers),
          this.fetchFirstCommitAt(organization, project, pr.pullRequestId, headers),
        ]);
        pullRequests.push(this.mapToCanonicalPullRequest(pr, changedFiles, firstCommitAt, tenantId));

        const authorIdentity = this.mapToDiscoveredIdentity(pr.createdBy, tenantId);
        discoveredIdentities.set(authorIdentity.externalUserId, authorIdentity);
        for (const reviewer of pr.reviewers) {
          const identity = this.mapToDiscoveredIdentity(reviewer, tenantId);
          discoveredIdentities.set(identity.externalUserId, identity);
        }
      } catch (itemError) {
        errors.push(
          `[${this.providerName}] Falha ao processar PR #${pr.pullRequestId} de "${project}": ${this.describeError(itemError)}`,
        );
      }
    }

    return { pullRequests, discoveredIdentities, errors, hasMorePages: prs.length === top };
  }

  /**
   * Arquivos tocados — usa a última iteration do PR (revisão mais recente),
   * não a primeira, pra refletir o diff final. Só a primeira página (mesma
   * limitação já aceita no GitHub pra `changedFiles`).
   */
  private async fetchChangedFiles(
    organization: string,
    project: string,
    pullRequestId: number,
    headers: Record<string, string>,
  ): Promise<readonly string[]> {
    const iterationsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/pullrequests/${pullRequestId}/iterations?api-version=${API_VERSION}`;
    const iterationsResponse = await fetch(iterationsUrl, { headers });
    if (!iterationsResponse.ok) {
      throw new Error(`GET ${iterationsUrl} retornou ${iterationsResponse.status} ${iterationsResponse.statusText}.`);
    }
    const { value: iterations } = (await iterationsResponse.json()) as AzurePullRequestIterationsResponse;
    const lastIteration = iterations[iterations.length - 1];
    if (!lastIteration) {
      return [];
    }

    const changesUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/pullrequests/${pullRequestId}/iterations/${lastIteration.id}/changes?api-version=${API_VERSION}`;
    const changesResponse = await fetch(changesUrl, { headers });
    if (!changesResponse.ok) {
      throw new Error(`GET ${changesUrl} retornou ${changesResponse.status} ${changesResponse.statusText}.`);
    }
    const { changeEntries } = (await changesResponse.json()) as AzurePullRequestChangesResponse;
    return changeEntries.map((entry) => entry.item?.path).filter((path): path is string => Boolean(path));
  }

  private async fetchFirstCommitAt(
    organization: string,
    project: string,
    pullRequestId: number,
    headers: Record<string, string>,
  ): Promise<Date | null> {
    const commitsUrl = `https://dev.azure.com/${organization}/${project}/_apis/git/pullrequests/${pullRequestId}/commits?api-version=${API_VERSION}`;
    const response = await fetch(commitsUrl, { headers });
    if (!response.ok) {
      throw new Error(`GET ${commitsUrl} retornou ${response.status} ${response.statusText}.`);
    }

    const { value: commits } = (await response.json()) as AzurePullRequestCommitsResponse;
    const firstCommit = commits[0];
    if (!firstCommit) return null;

    const rawDate = firstCommit.author?.date ?? firstCommit.committer?.date;
    return rawDate ? new Date(rawDate) : null;
  }

  private async fetchAllProjects(organization: string, headers: Record<string, string>): Promise<readonly string[]> {
    const response = await fetch(`https://dev.azure.com/${organization}/_apis/projects?api-version=${API_VERSION}`, {
      headers,
    });
    if (!response.ok) {
      throw new Error(
        `[${this.providerName}] Falha ao listar Projects de "${organization}": ${response.status} ${response.statusText}.`,
      );
    }
    const { value } = (await response.json()) as AzureProjectListResponse;
    return value.map((project) => project.name);
  }

  private resolveApiToken(credentials: ProviderCredentials): string {
    this.validateRequiredCredentials(credentials, ['apiToken']);
    const { apiToken } = credentials;
    if (!apiToken) {
      throw new Error(`[${this.providerName}] apiToken ausente.`);
    }
    return apiToken;
  }

  private resolveOrganization(credentials: ProviderCredentials): string {
    const organization = credentials.extra?.organization;
    if (!organization || typeof organization !== 'string') {
      throw new Error(`[${this.providerName}] credentials.extra.organization ausente — obrigatório.`);
    }
    return organization;
  }

  private resolveProject(credentials: ProviderCredentials): string | undefined {
    const project = credentials.extra?.project;
    return typeof project === 'string' && project.length > 0 ? project : undefined;
  }

  private buildHeaders(apiToken: string): Record<string, string> {
    const basicAuth = Buffer.from(`:${apiToken}`).toString('base64');
    return { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' };
  }

  private stripRefPrefix(ref: string): string {
    return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
  }

  private mapToCanonicalPullRequest(
    pr: AzurePullRequest,
    changedFiles: readonly string[],
    firstCommitAt: Date | null,
    tenantId: string,
  ): CanonicalPullRequest {
    const state: CanonicalPullRequestState =
      pr.status === 'completed' ? 'MERGED' : pr.status === 'abandoned' ? 'CLOSED' : 'OPEN';
    // Sem `updatedAt` explícito na listagem do Azure Repos — aproxima pelo
    // mais recente entre fechamento/criação (decisão de conector, não da API).
    const updatedAt = pr.closedDate ? new Date(pr.closedDate) : new Date(pr.creationDate);

    return {
      tenantId,
      provider: 'azure_repos',
      externalId: String(pr.pullRequestId),
      // Mesmo formato "owner/repo" já usado pelo GitHub, pra não quebrar a
      // convenção de `repository` como chave de vínculo de time.
      repository: `${pr.repository.project.name}/${pr.repository.name}`,
      title: pr.title,
      state,
      authorExternalId: pr.createdBy.id,
      reviewerExternalIds: pr.reviewers.map((reviewer) => reviewer.id),
      sourceBranch: this.stripRefPrefix(pr.sourceRefName),
      targetBranch: this.stripRefPrefix(pr.targetRefName),
      // Azure DevOps não devolve contagem de linhas/comentários na listagem
      // básica de PRs (precisaria de mais uma chamada por PR pra Threads —
      // fora de escopo desta rodada, mesmo espírito de "campo indisponível
      // fica 0" já aceito em outros conectores pra dados não expostos).
      linesAdded: 0,
      linesDeleted: 0,
      commentsCount: 0,
      changedFiles,
      firstCommitAt,
      openedAt: new Date(pr.creationDate),
      mergedAt: pr.status === 'completed' && pr.closedDate ? new Date(pr.closedDate) : null,
      closedAt: pr.status !== 'active' && pr.closedDate ? new Date(pr.closedDate) : null,
      updatedAt,
    };
  }

  private mapToDiscoveredIdentity(identity: AzureIdentityRef, tenantId: string): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'azure_repos',
      externalUserId: identity.id,
      externalUsername: identity.displayName,
      externalEmail: identity.uniqueName ?? null,
      externalAvatarUrl: identity.imageUrl ?? null,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('azure_repos', AzureReposProvider);
