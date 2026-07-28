import { BaseProvider } from '../../core/base.provider';
import { ProviderFactory } from '../../core/provider.factory';
import type {
  CanonicalDiscoveredIdentity,
  CanonicalWorkItem,
  CanonicalWorkItemStatusTransition,
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

const DEFAULT_PAGE_SIZE = 50;
/** Limite prático por página da REST API v3 do Jira Cloud. */
const SEARCH_MAX_PER_PAGE = 100;

/**
 * Envelope de resposta de `GET /rest/api/3/search/jql`.
 *
 * A Atlassian descontinuou `GET /rest/api/3/search` (retorna `410 Gone`);
 * o endpoint atual usa paginação por cursor opaco (`nextPageToken`), não
 * mais `startAt`/`total`.
 */
interface JiraSearchResponse {
  readonly issues: readonly JiraIssue[];
  readonly nextPageToken?: string;
}

/** Subconjunto tipado de uma issue, limitado aos campos pedidos em `fields=`. */
interface JiraIssue {
  readonly key: string;
  readonly fields: {
    readonly issuetype: { readonly name: string };
    readonly status: { readonly name: string };
    readonly labels: readonly string[];
    readonly summary: string;
    // Jira Cloud identifica o usuário por accountId (não email/username), por causa de GDPR.
    readonly assignee: { readonly accountId: string } | null;
    readonly created: string;
    readonly updated: string;
    readonly project: { readonly key: string };
  };
  /**
   * Presente porque `buildSearchUrl` sempre pede `expand=changelog` — vem
   * embutido na própria resposta de busca, sem chamada extra por issue
   * (verificado ao vivo contra a API real). Só a primeira página de
   * histórico (limite prático do Jira); issues com histórico muito longo
   * podem ter transições antigas faltando — limitação conhecida.
   */
  readonly changelog?: {
    readonly total: number;
    readonly histories: readonly JiraChangelogHistory[];
  };
}

interface JiraChangelogHistory {
  readonly id: string;
  readonly created: string;
  readonly items: readonly {
    readonly field: string;
    readonly fromString: string | null;
    readonly toString: string | null;
  }[];
}

/**
 * Resposta de `GET /rest/api/3/user?accountId=`. Diferente do `assignee` do
 * endpoint de busca, este endpoint sempre devolve `displayName`, e
 * `emailAddress` quando a configuração de privacidade do usuário permite.
 */
interface JiraUserDetail {
  readonly accountId: string;
  readonly displayName: string;
  readonly emailAddress?: string;
  readonly avatarUrls?: { readonly '48x48'?: string };
}

/**
 * Conector de Issue Tracker para o Jira Cloud (REST API v3).
 *
 * Traduz issues para `CanonicalWorkItem`, alimentando Flow Metrics
 * (Velocity, Distribution, Load, Time), SPACE (Activity) e métricas
 * operacionais (Toil, Retrabalho) — Seção 2 da spec.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class JiraProvider extends BaseProvider {
  readonly providerName = 'jira';
  readonly category: ProviderCategory = 'issue_tracker';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const apiToken = this.resolveApiToken(credentials);
      const email = this.resolveEmail(credentials);
      const baseUrl = this.resolveBaseUrl(credentials);

      const response = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: this.buildHeaders(email, apiToken),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Jira respondeu ${response.status} ${response.statusText} em /myself.`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  /**
   * Enquanto `context.since` não existe, o backfill ainda não completou —
   * a busca é fatiada em janelas de tempo adaptativas (`backfill-window.ts`),
   * mesmo padrão do GitHub (ver `github.provider.ts:syncIncremental`). Uma
   * vez completo, volta ao modo simples de sempre.
   */
  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const apiToken = this.resolveApiToken(context.credentials);
      const email = this.resolveEmail(context.credentials);
      const baseUrl = this.resolveBaseUrl(context.credentials);
      const projectKey = this.resolveProjectKey(context.credentials);
      const headers = this.buildHeaders(email, apiToken);
      const maxResults = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, SEARCH_MAX_PER_PAGE);

      return context.since
        ? await this.syncSincePage(baseUrl, projectKey, headers, context, maxResults)
        : await this.syncBackfillPage(baseUrl, projectKey, headers, context, maxResults);
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
  }

  /** Modo simples de sempre — uma query, sem janela, escopada por `updated >= since`. */
  private async syncSincePage(
    baseUrl: string,
    projectKey: string | undefined,
    headers: Record<string, string>,
    context: SyncContext,
    maxResults: number,
  ): Promise<SyncResult> {
    const pageToken = context.cursor ?? undefined;
    const filterClauses = context.since ? [`updated >= "${this.formatJqlDateTime(context.since)}"`] : [];
    const jql = `${this.buildJql(projectKey, filterClauses)} ORDER BY updated DESC`.trim();
    const searchUrl = this.buildSearchUrl(baseUrl, jql, pageToken, maxResults);
    const searchResponse = await fetch(searchUrl, { headers });

    if (!searchResponse.ok) {
      const detail = await searchResponse.text().catch(() => '');
      return {
        success: false,
        fetchedCount: 0,
        errors: [
          `[${this.providerName}] Falha ao buscar issues: ${searchResponse.status} ${searchResponse.statusText}. ${detail}`.trim(),
        ],
      };
    }

    const searchResult = (await searchResponse.json()) as JiraSearchResponse;
    const { workItems, statusTransitions, discoveredIdentities, errors } = await this.processSearchItems(
      searchResult.issues,
      context,
      baseUrl,
      headers,
    );

    return {
      success: true,
      nextCursor: searchResult.nextPageToken ?? null,
      fetchedCount: workItems.length,
      workItems,
      statusTransitions: statusTransitions.length > 0 ? statusTransitions : undefined,
      discoveredIdentities: discoveredIdentities.length > 0 ? discoveredIdentities : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /** Backfill em janelas adaptativas — ver `backfill-window.ts` pro algoritmo geral. */
  private async syncBackfillPage(
    baseUrl: string,
    projectKey: string | undefined,
    headers: Record<string, string>,
    context: SyncContext,
    maxResults: number,
  ): Promise<SyncResult> {
    const floor = computeBackfillFloor();
    const parsedCursor = parseBackfillCursor(context.cursor);
    const windowEnd = parsedCursor?.windowEnd ?? new Date();
    const page = parsedCursor?.page ?? 1;
    const pageToken = parsedCursor?.pageToken ?? undefined;
    let windowSizeDays = parsedCursor?.windowSizeDays ?? DEFAULT_WINDOW_SIZE_DAYS;

    if (page === 1) {
      windowSizeDays = await resolveSafeWindowSizeDays(windowEnd, windowSizeDays, floor, (start, end) =>
        this.countIssues(baseUrl, projectKey, headers, start, end),
      );
    }

    const windowStart = computeWindowStart(windowEnd, windowSizeDays, floor);
    const filterClauses = [
      `created >= "${this.formatJqlDateTime(windowStart)}"`,
      `created <= "${this.formatJqlDateTime(windowEnd)}"`,
    ];
    const jql = `${this.buildJql(projectKey, filterClauses)} ORDER BY updated DESC`.trim();
    const searchUrl = this.buildSearchUrl(baseUrl, jql, pageToken, maxResults);
    const searchResponse = await fetch(searchUrl, { headers });

    if (!searchResponse.ok) {
      const detail = await searchResponse.text().catch(() => '');
      return {
        success: false,
        fetchedCount: 0,
        errors: [
          `[${this.providerName}] Falha ao buscar issues (backfill): ${searchResponse.status} ${searchResponse.statusText}. ${detail}`.trim(),
        ],
      };
    }

    const searchResult = (await searchResponse.json()) as JiraSearchResponse;
    const { workItems, statusTransitions, discoveredIdentities, errors } = await this.processSearchItems(
      searchResult.issues,
      context,
      baseUrl,
      headers,
    );

    // Diferente do GitHub, o endpoint com cursor do Jira (`/search/jql`) não
    // expõe um total — `nextPageToken` presente/ausente já é o sinal
    // completo de "tem mais página" dentro da janela.
    let nextCursor: string | null;
    if (searchResult.nextPageToken) {
      nextCursor = serializeBackfillCursor({
        windowEnd,
        windowSizeDays,
        page: page + 1,
        pageToken: searchResult.nextPageToken,
      });
    } else if (isAtBackfillFloor(windowStart, floor)) {
      nextCursor = null;
    } else {
      nextCursor = serializeBackfillCursor({ windowEnd: windowStart, windowSizeDays, page: 1, pageToken: null });
    }

    return {
      success: true,
      nextCursor,
      fetchedCount: workItems.length,
      workItems,
      statusTransitions: statusTransitions.length > 0 ? statusTransitions : undefined,
      discoveredIdentities: discoveredIdentities.length > 0 ? discoveredIdentities : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Contagem aproximada (`POST /rest/api/3/search/approximate-count`), sem
   * buscar os itens de verdade — usado por `resolveSafeWindowSizeDays` pra
   * descobrir o tamanho seguro de janela. Confirmado ao vivo: endpoint
   * dedicado introduzido junto com a paginação por cursor, existe e
   * responde `{"count": N}`.
   */
  private async countIssues(
    baseUrl: string,
    projectKey: string | undefined,
    headers: Record<string, string>,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<number> {
    const jql = this.buildJql(projectKey, [
      `created >= "${this.formatJqlDateTime(windowStart)}"`,
      `created <= "${this.formatJqlDateTime(windowEnd)}"`,
    ]);

    const response = await fetch(`${baseUrl}/rest/api/3/search/approximate-count`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql }),
    });

    if (!response.ok) {
      // Falha na contagem não deve travar o backfill inteiro — assume o pior
      // (teto cheio), o que força a próxima tentativa a encolher a janela.
      return BACKFILL_RESULT_CAP;
    }

    const body = (await response.json()) as { count: number };
    return body.count;
  }

  /**
   * Busca detalhe de identidade (accountId → nome/email/avatar) e monta os
   * registros canônicos — compartilhado entre `syncSincePage`/
   * `syncBackfillPage`, únicas duas formas de chegar numa página de
   * resultados de busca.
   */
  private async processSearchItems(
    issues: readonly JiraIssue[],
    context: SyncContext,
    baseUrl: string,
    headers: Record<string, string>,
  ): Promise<{
    readonly workItems: CanonicalWorkItem[];
    readonly statusTransitions: CanonicalWorkItemStatusTransition[];
    readonly discoveredIdentities: CanonicalDiscoveredIdentity[];
    readonly errors: string[];
  }> {
    const workItems = issues.map((issue) => this.mapToCanonicalWorkItem(issue, context.tenantId));
    const statusTransitions = issues.flatMap((issue) => this.mapToStatusTransitions(issue, context.tenantId));
    const { discoveredIdentities, identityErrors } = await this.resolveDiscoveredIdentities(
      workItems,
      context,
      baseUrl,
      headers,
    );

    return { workItems, statusTransitions, discoveredIdentities, errors: identityErrors };
  }

  /**
   * Extrai o API token (`ProviderCredentials.apiToken`) já validado.
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

  /** Jira Cloud autentica via Basic Auth (email + apiToken), não Bearer token. */
  private resolveEmail(credentials: ProviderCredentials): string {
    const email = credentials.extra?.email;

    if (!email || typeof email !== 'string') {
      throw new Error(`[${this.providerName}] credentials.extra.email ausente — obrigatório para Basic Auth.`);
    }

    return email;
  }

  /** Cada tenant tem seu próprio site Jira — sem default sensato como o GitHub. */
  private resolveBaseUrl(credentials: ProviderCredentials): string {
    this.validateRequiredCredentials(credentials, ['baseUrl']);

    const { baseUrl } = credentials;
    if (!baseUrl) {
      // Inalcançável: validateRequiredCredentials já lança acima quando ausente.
      throw new Error(`[${this.providerName}] baseUrl ausente.`);
    }

    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  /**
   * Escopa a busca a um único projeto, quando informado. Opcional: ausente,
   * a JQL varre o site inteiro (mesmo modelo já usado pelo GitHub, escopado
   * só pela organização) — o time de cada issue é então resolvido depois,
   * via `external_group_key`/`team_resource_links` (`resourceType`
   * `jira_project`), não mais só no cadastro da integração.
   */
  private resolveProjectKey(credentials: ProviderCredentials): string | undefined {
    const projectKey = credentials.extra?.projectKey;
    return typeof projectKey === 'string' && projectKey.length > 0 ? projectKey : undefined;
  }

  private buildHeaders(email: string, apiToken: string): Record<string, string> {
    const basicAuth = Buffer.from(`${email}:${apiToken}`).toString('base64');

    return {
      Authorization: `Basic ${basicAuth}`,
      Accept: 'application/json',
    };
  }

  /**
   * Monta as cláusulas comuns a toda busca/contagem: escopo de projeto
   * (quando informado) + os filtros específicos do chamador (`since` no
   * modo simples, `created >= X AND created <= Y` no modo backfill) +
   * `created <= now()` sempre por último.
   *
   * Jira Cloud rejeita JQL "sem restrição nenhuma" com 400 ("As consultas
   * JQL ilimitadas não são permitidas aqui") — sem projectKey e sem nenhum
   * filtro do chamador (primeira sync, sem `since`, fora do backfill —
   * inalcançável hoje já que `syncIncremental` sempre passa por um dos dois
   * modos, mas mantido como cinto de segurança). `created <= now()` é
   * sempre verdadeiro (nenhuma issue é criada no futuro), então funciona
   * como restrição válida sem afetar o resultado.
   */
  private buildJql(projectKey: string | undefined, filterClauses: readonly string[]): string {
    const projectClause = projectKey ? `project = "${projectKey}"` : '';
    const clauses = [projectClause, ...filterClauses, 'created <= now()'].filter((clause) => clause.length > 0);
    return clauses.join(' AND ');
  }

  private buildSearchUrl(baseUrl: string, jql: string, pageToken: string | undefined, maxResults: number): URL {
    const searchUrl = new URL(`${baseUrl}/rest/api/3/search/jql`);
    searchUrl.searchParams.set('jql', jql);
    searchUrl.searchParams.set('maxResults', String(maxResults));
    searchUrl.searchParams.set('fields', 'issuetype,status,labels,summary,assignee,created,updated,project');
    // Vem embutido na mesma resposta de busca, sem chamada extra por issue
    // (verificado ao vivo contra a API real) — alimenta started_working_at/
    // completed_at na Enriched Layer.
    searchUrl.searchParams.set('expand', 'changelog');
    if (pageToken) {
      searchUrl.searchParams.set('nextPageToken', pageToken);
    }

    return searchUrl;
  }

  /**
   * Formata em UTC, sem ajuste pro timezone do site Jira — imprecisão
   * pequena e conhecida, não justifica uma dependência de datas só pra isso.
   */
  private formatJqlDateTime(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  /**
   * Resolve nome/email/avatar só dos `accountId`s realmente novos deste lote
   * (ausentes de `context.knownExternalUserIds`) — o endpoint de busca de
   * issues omite essa informação por GDPR, então cada `accountId` novo custa
   * uma chamada extra a `/rest/api/3/user`. Quem já foi resolvido numa sync
   * anterior não gera chamada de novo.
   */
  private async resolveDiscoveredIdentities(
    workItems: readonly CanonicalWorkItem[],
    context: SyncContext,
    baseUrl: string,
    headers: Record<string, string>,
  ): Promise<{ discoveredIdentities: CanonicalDiscoveredIdentity[]; identityErrors: string[] }> {
    const knownIds = context.knownExternalUserIds ?? new Set<string>();
    const assigneeIds = new Set(
      workItems
        .map((item) => item.assigneeExternalId)
        .filter((id): id is string => id !== null && id !== undefined),
    );
    const newAccountIds = [...assigneeIds].filter((id) => !knownIds.has(id));

    const discoveredIdentities: CanonicalDiscoveredIdentity[] = [];
    const identityErrors: string[] = [];

    for (const accountId of newAccountIds) {
      try {
        const user = await this.fetchJiraUser(baseUrl, accountId, headers);
        discoveredIdentities.push(this.mapToDiscoveredIdentity(user, context.tenantId));
      } catch (itemError) {
        identityErrors.push(
          `[${this.providerName}] Falha ao resolver usuário accountId=${accountId}: ${this.describeError(itemError)}`,
        );
      }
    }

    return { discoveredIdentities, identityErrors };
  }

  private async fetchJiraUser(
    baseUrl: string,
    accountId: string,
    headers: Record<string, string>,
  ): Promise<JiraUserDetail> {
    const url = new URL(`${baseUrl}/rest/api/3/user`);
    url.searchParams.set('accountId', accountId);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GET ${url} retornou ${response.status} ${response.statusText}.`);
    }

    return (await response.json()) as JiraUserDetail;
  }

  private mapToDiscoveredIdentity(user: JiraUserDetail, tenantId: string): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'jira',
      externalUserId: user.accountId,
      externalUsername: user.displayName,
      externalEmail: user.emailAddress ?? null,
      externalAvatarUrl: user.avatarUrls?.['48x48'] ?? null,
    };
  }

  private mapToCanonicalWorkItem(issue: JiraIssue, tenantId: string): CanonicalWorkItem {
    return {
      tenantId,
      provider: 'jira',
      externalId: issue.key,
      rawIssueType: issue.fields.issuetype.name,
      rawStatus: issue.fields.status.name,
      rawLabels: issue.fields.labels,
      title: issue.fields.summary,
      assigneeExternalId: issue.fields.assignee?.accountId ?? null,
      externalGroupKey: issue.fields.project.key,
      createdAt: new Date(issue.fields.created),
      updatedAt: new Date(issue.fields.updated),
    };
  }

  /**
   * Extrai as transições de `status` do changelog embutido — o changelog
   * também traz mudanças de outros campos (Rank, Sprint, etc.), só as de
   * `field === 'status'` interessam pra ciclo de vida do item.
   */
  private mapToStatusTransitions(issue: JiraIssue, tenantId: string): CanonicalWorkItemStatusTransition[] {
    const histories = issue.changelog?.histories ?? [];

    return histories.flatMap((history) =>
      history.items
        .filter((item) => item.field === 'status' && item.toString !== null)
        .map((item) => ({
          tenantId,
          provider: 'jira' as const,
          workItemExternalId: issue.key,
          externalChangeId: history.id,
          fromStatus: item.fromString,
          // Non-null garantido pelo filter acima; TS não estreita `.toString` automaticamente.
          toStatus: item.toString as string,
          transitionedAt: new Date(history.created),
        })),
    );
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('jira', JiraProvider);
