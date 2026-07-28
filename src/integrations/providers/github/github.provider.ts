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
import {
  computeBackfillFloor,
  computeWindowStart,
  isAtBackfillFloor,
  parseBackfillCursor,
  resolveSafeWindowSizeDays,
  serializeBackfillCursor,
  BACKFILL_RESULT_CAP,
  DEFAULT_WINDOW_SIZE_DAYS,
} from '../../core/backfill-window';

const GITHUB_DEFAULT_BASE_URL = 'https://api.github.com';
const DEFAULT_PAGE_SIZE = 50;
/** Limite máximo de itens por página imposto pela Search API do GitHub. */
const SEARCH_MAX_PER_PAGE = 100;

/** Referência mínima a um usuário do GitHub, usada em `user`/`requested_reviewers`. */
interface GitHubUserRef {
  readonly id: number;
  readonly login: string;
  readonly avatar_url?: string;
}

/** Envelope de resposta da GitHub Search API (`/search/issues`). */
interface GitHubSearchIssuesResponse {
  readonly total_count: number;
  readonly incomplete_results: boolean;
  readonly items: readonly GitHubSearchIssueItem[];
}

/**
 * Item retornado pela Search API. Representa tanto Issues quanto Pull
 * Requests — a presença do campo `pull_request` distingue os últimos.
 */
interface GitHubSearchIssueItem {
  readonly number: number;
  readonly repository_url: string;
  readonly pull_request?: { readonly url: string };
}

/** Subconjunto tipado da resposta de "Get a pull request" consumido pelo mapeamento canônico. */
interface GitHubPullRequestDetail {
  readonly number: number;
  readonly state: 'open' | 'closed';
  readonly title: string;
  readonly additions: number;
  readonly deletions: number;
  readonly comments: number;
  readonly review_comments: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly merged_at: string | null;
  readonly closed_at: string | null;
  readonly user: GitHubUserRef | null;
  readonly requested_reviewers: readonly GitHubUserRef[];
  readonly head: { readonly ref: string };
  readonly base: { readonly ref: string; readonly repo: { readonly full_name: string } };
}

/**
 * Conector de Version Control para o GitHub (REST API v3 / Search API).
 *
 * Traduz Pull Requests para `CanonicalPullRequest`, alimentando DORA (Lead
 * Time for Changes), SPACE (Activity, Communication & Collaboration) e
 * métricas operacionais de Code Churn (Seção 2 da spec).
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class GitHubProvider extends BaseProvider {
  readonly providerName = 'github';
  readonly category: ProviderCategory = 'vcs';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const token = this.resolveApiToken(credentials);
      this.resolveOrganization(credentials);
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

  /**
   * Enquanto `context.since` não existe, o backfill ainda não completou —
   * a busca é fatiada em janelas de tempo adaptativas (`backfill-window.ts`)
   * pra nunca esbarrar no teto de 1000 resultados da Search API. Uma vez
   * completo (`since` passa a existir), volta ao modo simples de sempre:
   * uma query só, sem janela — incrementos do dia a dia nunca são grandes o
   * bastante pra precisar disso.
   */
  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const token = this.resolveApiToken(context.credentials);
      const organization = this.resolveOrganization(context.credentials);
      const baseUrl = context.credentials.baseUrl ?? GITHUB_DEFAULT_BASE_URL;
      const headers = this.buildHeaders(token);
      const perPage = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, SEARCH_MAX_PER_PAGE);

      return context.since
        ? await this.syncSincePage(baseUrl, organization, headers, context, perPage)
        : await this.syncBackfillPage(baseUrl, organization, headers, context, perPage);
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
  }

  /** Modo simples de sempre — uma query, sem janela, escopada por `updated:>=since`. */
  private async syncSincePage(
    baseUrl: string,
    organization: string,
    headers: Record<string, string>,
    context: SyncContext,
    perPage: number,
  ): Promise<SyncResult> {
    const page = context.cursor ? Number.parseInt(context.cursor, 10) : 1;
    const query = `is:pr org:${organization} updated:>=${(context.since as Date).toISOString()}`;
    const searchUrl = this.buildSearchUrl(baseUrl, query, page, perPage);
    const searchResponse = await fetch(searchUrl, { headers });

    if (!searchResponse.ok) {
      const detail = await searchResponse.text().catch(() => '');
      return {
        success: false,
        fetchedCount: 0,
        errors: [
          `[${this.providerName}] Falha ao buscar Pull Requests: ${searchResponse.status} ${searchResponse.statusText}. ${detail}`.trim(),
        ],
      };
    }

    const searchResult = (await searchResponse.json()) as GitHubSearchIssuesResponse;
    const { pullRequests, discoveredIdentities, errors } = await this.processSearchItems(
      searchResult.items,
      headers,
      context.tenantId,
    );

    // A Search API do GitHub nunca devolve além do resultado 1000, mesmo que
    // `total_count` diga que existe mais — confirmado ao vivo (página 21 de
    // um resultado com mais de 1000 PRs retornou 422). Sem esse teto, a
    // sync tenta a página seguinte pra sempre e fica presa em erro. Na
    // prática, incrementos do dia a dia não deveriam nem chegar perto disso.
    const hasMorePages =
      searchResult.items.length === perPage && page * perPage < Math.min(searchResult.total_count, BACKFILL_RESULT_CAP);

    return {
      success: true,
      nextCursor: hasMorePages ? String(page + 1) : null,
      fetchedCount: pullRequests.length,
      pullRequests,
      discoveredIdentities: discoveredIdentities.length > 0 ? discoveredIdentities : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /** Backfill em janelas adaptativas — ver `backfill-window.ts` pro algoritmo geral. */
  private async syncBackfillPage(
    baseUrl: string,
    organization: string,
    headers: Record<string, string>,
    context: SyncContext,
    perPage: number,
  ): Promise<SyncResult> {
    const floor = computeBackfillFloor();
    const parsedCursor = parseBackfillCursor(context.cursor);
    const windowEnd = parsedCursor?.windowEnd ?? new Date();
    const page = parsedCursor?.page ?? 1;
    let windowSizeDays = parsedCursor?.windowSizeDays ?? DEFAULT_WINDOW_SIZE_DAYS;

    if (page === 1) {
      windowSizeDays = await resolveSafeWindowSizeDays(windowEnd, windowSizeDays, floor, (start, end) =>
        this.countPullRequests(baseUrl, organization, headers, start, end),
      );
    }

    const windowStart = computeWindowStart(windowEnd, windowSizeDays, floor);
    const query = `is:pr org:${organization} created:${this.formatDate(windowStart)}..${this.formatDate(windowEnd)}`;
    const searchUrl = this.buildSearchUrl(baseUrl, query, page, perPage);
    const searchResponse = await fetch(searchUrl, { headers });

    if (!searchResponse.ok) {
      const detail = await searchResponse.text().catch(() => '');
      return {
        success: false,
        fetchedCount: 0,
        errors: [
          `[${this.providerName}] Falha ao buscar Pull Requests (backfill): ${searchResponse.status} ${searchResponse.statusText}. ${detail}`.trim(),
        ],
      };
    }

    const searchResult = (await searchResponse.json()) as GitHubSearchIssuesResponse;
    const { pullRequests, discoveredIdentities, errors } = await this.processSearchItems(
      searchResult.items,
      headers,
      context.tenantId,
    );

    const hasMorePagesInWindow =
      searchResult.items.length === perPage && page * perPage < Math.min(searchResult.total_count, BACKFILL_RESULT_CAP);

    let nextCursor: string | null;
    if (hasMorePagesInWindow) {
      nextCursor = serializeBackfillCursor({ windowEnd, windowSizeDays, page: page + 1, pageToken: null });
    } else if (isAtBackfillFloor(windowStart, floor)) {
      nextCursor = null;
    } else {
      nextCursor = serializeBackfillCursor({ windowEnd: windowStart, windowSizeDays, page: 1, pageToken: null });
    }

    return {
      success: true,
      nextCursor,
      fetchedCount: pullRequests.length,
      pullRequests,
      discoveredIdentities: discoveredIdentities.length > 0 ? discoveredIdentities : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Só a contagem (`total_count`), sem buscar os itens — usado por
   * `resolveSafeWindowSizeDays` pra descobrir o tamanho seguro de janela
   * sem gastar as chamadas de detalhe por PR.
   */
  private async countPullRequests(
    baseUrl: string,
    organization: string,
    headers: Record<string, string>,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<number> {
    const query = `is:pr org:${organization} created:${this.formatDate(windowStart)}..${this.formatDate(windowEnd)}`;
    const url = this.buildSearchUrl(baseUrl, query, 1, 1);
    const response = await fetch(url, { headers });

    if (!response.ok) {
      // Falha na contagem não deve travar o backfill inteiro — assume o pior
      // (teto cheio), o que força a próxima tentativa a encolher a janela.
      return BACKFILL_RESULT_CAP;
    }

    const body = (await response.json()) as GitHubSearchIssuesResponse;
    return body.total_count;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * Busca o detalhe de cada PR da página e monta os registros canônicos —
   * compartilhado entre `syncSincePage`/`syncBackfillPage`, únicas duas
   * formas de chegar numa página de resultados da Search API.
   */
  private async processSearchItems(
    items: readonly GitHubSearchIssueItem[],
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<{
    readonly pullRequests: CanonicalPullRequest[];
    readonly discoveredIdentities: CanonicalDiscoveredIdentity[];
    readonly errors: string[];
  }> {
    const errors: string[] = [];
    const pullRequests: CanonicalPullRequest[] = [];
    const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();

    for (const item of items) {
      // A Search API de Issues também retorna Issues comuns; ignoramos as que não são PRs.
      if (!item.pull_request) {
        continue;
      }

      try {
        const detail = await this.fetchPullRequestDetail(item, headers);
        pullRequests.push(this.mapToCanonicalPullRequest(detail, tenantId));

        if (detail.user) {
          const identity = this.mapToDiscoveredIdentity(detail.user, tenantId);
          discoveredIdentities.set(identity.externalUserId, identity);
        }
        for (const reviewer of detail.requested_reviewers) {
          const identity = this.mapToDiscoveredIdentity(reviewer, tenantId);
          discoveredIdentities.set(identity.externalUserId, identity);
        }
      } catch (itemError) {
        errors.push(`[${this.providerName}] Falha ao processar PR #${item.number}: ${this.describeError(itemError)}`);
      }
    }

    return { pullRequests, discoveredIdentities: [...discoveredIdentities.values()], errors };
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
   * Extrai a organização a sincronizar (`ProviderCredentials.extra.organization`).
   *
   * A Search API do GitHub, sem qualificador de escopo, busca PRs em todo o
   * GitHub público — não apenas nos repositórios que o token acessa. Exigir
   * a organização evita sincronizar dado alheio/irrelevante ao tenant.
   *
   * @throws {Error} Quando `extra.organization` não foi informado.
   */
  private resolveOrganization(credentials: ProviderCredentials): string {
    const organization = credentials.extra?.organization;

    if (!organization || typeof organization !== 'string') {
      throw new Error(
        `[${this.providerName}] credentials.extra.organization ausente — obrigatório para escopar a busca a uma organização.`,
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

  private buildSearchUrl(baseUrl: string, query: string, page: number, perPage: number): URL {
    const searchUrl = new URL(`${baseUrl}/search/issues`);
    searchUrl.searchParams.set('q', query);
    /**
     * Descendente (mais recente primeiro) — decisão deliberada dado o teto
     * de 1000 resultados da Search API (`BACKFILL_RESULT_CAP`): em orgs com
     * histórico grande (ex: 40 mil+ PRs), uma query sem janela nunca alcança
     * o fim de qualquer jeito, então a pergunta é só "qual fatia dos 1000
     * vale mais". Atividade recente importa mais pra métricas de engenharia
     * (DORA/Flow olham "últimos N dias") do que histórico antigo — com
     * ordem ascendente, a sync gastava as 1000 vagas nos PRs mais antigos e
     * nunca chegava perto de "agora" (bug real, visto ao vivo: PR de hoje
     * não sincronizava numa org de 583 repos). Paginação com cursor funciona
     * igual em qualquer direção, não há trade-off de estabilidade aqui.
     */
    searchUrl.searchParams.set('sort', 'updated');
    searchUrl.searchParams.set('order', 'desc');
    searchUrl.searchParams.set('page', String(page));
    searchUrl.searchParams.set('per_page', String(perPage));

    return searchUrl;
  }

  private async fetchPullRequestDetail(
    item: GitHubSearchIssueItem,
    headers: Record<string, string>,
  ): Promise<GitHubPullRequestDetail> {
    const detailUrl = `${item.repository_url}/pulls/${item.number}`;
    const response = await fetch(detailUrl, { headers });

    if (!response.ok) {
      throw new Error(`GET ${detailUrl} retornou ${response.status} ${response.statusText}.`);
    }

    return (await response.json()) as GitHubPullRequestDetail;
  }

  private mapToCanonicalPullRequest(
    detail: GitHubPullRequestDetail,
    tenantId: string,
  ): CanonicalPullRequest {
    const state: CanonicalPullRequestState = detail.merged_at
      ? 'MERGED'
      : detail.state === 'closed'
        ? 'CLOSED'
        : 'OPEN';

    return {
      tenantId,
      provider: 'github',
      externalId: String(detail.number),
      repository: detail.base.repo.full_name,
      title: detail.title,
      state,
      authorExternalId: detail.user ? String(detail.user.id) : null,
      reviewerExternalIds: detail.requested_reviewers.map((reviewer) => String(reviewer.id)),
      sourceBranch: detail.head.ref,
      targetBranch: detail.base.ref,
      linesAdded: detail.additions,
      linesDeleted: detail.deletions,
      commentsCount: detail.comments + detail.review_comments,
      // Requer uma chamada adicional a /pulls/{n}/commits; não coletado nesta versão.
      firstCommitAt: null,
      openedAt: new Date(detail.created_at),
      mergedAt: detail.merged_at ? new Date(detail.merged_at) : null,
      closedAt: detail.closed_at ? new Date(detail.closed_at) : null,
      updatedAt: new Date(detail.updated_at),
    };
  }

  private mapToDiscoveredIdentity(user: GitHubUserRef, tenantId: string): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'github',
      externalUserId: String(user.id),
      externalUsername: user.login,
      externalAvatarUrl: user.avatar_url ?? null,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('github', GitHubProvider);
