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
      this.resolveRepository(credentials);
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

      const page = context.cursor ? Number.parseInt(context.cursor, 10) : 1;
      const perPage = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PER_PAGE);

      const listUrl = this.buildDeploymentsUrl(baseUrl, repository, page, perPage);
      const listResponse = await fetch(listUrl, { headers });

      if (!listResponse.ok) {
        return {
          success: false,
          fetchedCount: 0,
          errors: [
            `[${this.providerName}] Falha ao buscar deployments: ${listResponse.status} ${listResponse.statusText}.`,
          ],
        };
      }

      const deploymentsList = (await listResponse.json()) as readonly GitHubDeployment[];
      const errors: string[] = [];
      const deployments: CanonicalDeployment[] = [];
      const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();

      for (const item of deploymentsList) {
        try {
          const latestStatus = await this.fetchLatestStatus(baseUrl, repository, item.id, headers);
          deployments.push(this.mapToCanonicalDeployment(item, latestStatus, repository, context.tenantId));

          if (item.creator) {
            const identity = this.mapToDiscoveredIdentity(item.creator, context.tenantId);
            discoveredIdentities.set(identity.externalUserId, identity);
          }
        } catch (itemError) {
          errors.push(
            `[${this.providerName}] Falha ao processar deployment #${item.id}: ${this.describeError(itemError)}`,
          );
        }
      }

      const hasMorePages = deploymentsList.length === perPage;

      return {
        success: true,
        nextCursor: hasMorePages ? String(page + 1) : null,
        fetchedCount: deployments.length,
        deployments,
        discoveredIdentities: discoveredIdentities.size > 0 ? [...discoveredIdentities.values()] : undefined,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
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
   * A Deployments API do GitHub não tem busca cross-repo (diferente da
   * Search API usada pelo conector de PRs, escopado por `organization`) —
   * só existe por repositório. Por isso a integração é escopada a um único
   * `owner/repo`, mesmo padrão já usado em Jira (`projectKey`) e Linear
   * (`teamKey`).
   */
  private resolveRepository(credentials: ProviderCredentials): string {
    const repository = credentials.extra?.repository;

    if (!repository || typeof repository !== 'string') {
      throw new Error(
        `[${this.providerName}] credentials.extra.repository ausente — obrigatório, formato "owner/repo".`,
      );
    }

    return repository;
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
