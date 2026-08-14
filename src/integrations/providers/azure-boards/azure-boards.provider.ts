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
  DEFAULT_WINDOW_SIZE_DAYS,
} from '../../core/backfill-window';

const API_VERSION = '7.1';
/** Limite documentado do WIQL do Azure DevOps — acima disso a API corta o resultado sem paginação nenhuma. */
const WIQL_RESULT_CAP = 20000;
/** Limite documentado de ids por chamada de `workitemsbatch`. */
const BATCH_MAX_PER_PAGE = 200;

const WORK_ITEM_FIELDS = [
  'System.WorkItemType',
  'System.State',
  'System.Tags',
  'System.Title',
  'System.AssignedTo',
  'System.TeamProject',
  'System.CreatedDate',
  'System.ChangedDate',
] as const;

interface AzureIdentityRef {
  readonly id: string;
  readonly displayName: string;
  readonly uniqueName?: string;
  readonly imageUrl?: string;
}

interface AzureWiqlResponse {
  readonly workItems: readonly { readonly id: number }[];
}

interface AzureWorkItem {
  readonly id: number;
  readonly fields: {
    readonly 'System.WorkItemType': string;
    readonly 'System.State': string;
    readonly 'System.Tags'?: string;
    readonly 'System.Title': string;
    readonly 'System.AssignedTo'?: AzureIdentityRef;
    readonly 'System.TeamProject': string;
    readonly 'System.CreatedDate': string;
    readonly 'System.ChangedDate': string;
  };
}

interface AzureWorkItemBatchResponse {
  readonly value: readonly AzureWorkItem[];
}

/** Subconjunto tipado de `GET .../workitems/{id}/updates` — uma entrada de revisão do item. */
interface AzureWorkItemUpdate {
  readonly id: number;
  readonly revisedDate: string;
  readonly fields?: {
    readonly 'System.State'?: { readonly oldValue?: string; readonly newValue?: string };
  };
}

interface AzureWorkItemUpdatesResponse {
  readonly value: readonly AzureWorkItemUpdate[];
}

/**
 * Conector de Issue Tracker para o Azure Boards (Azure DevOps Services REST API).
 *
 * Traduz work items para `CanonicalWorkItem`, alimentando Flow Metrics
 * (Velocity, Distribution, Load, Time), SPACE (Activity) e métricas
 * operacionais (Toil, Retrabalho) — mesmo papel do Jira/Linear (Seção 2).
 *
 * Diferente do Jira (busca por `updated`/`created` com paginação por
 * cursor), o WIQL do Azure DevOps devolve só uma lista de ids **sem
 * paginação nenhuma** (cap de 20000, sem token de continuação) — a
 * paginação de verdade é client-side: a lista de ids da janela atual é
 * fatiada em lotes de até 200 pra `workitemsbatch`, com o offset dentro
 * dessa lista viajando no campo `pageToken` do cursor de backfill
 * (reaproveitado como string numérica, não como token opaco do provider —
 * única diferença de uso desse campo em relação ao Jira).
 *
 * **Não verificado ao vivo ainda** (mesma ressalva já usada no ArgoCD) —
 * construído em cima da API REST documentada da Microsoft. Pontos de maior
 * incerteza, marcados abaixo: (1) se o endpoint de WIQL em nível de
 * organização (`https://dev.azure.com/{org}/_apis/wit/wiql`, sem segmento
 * de projeto) aceita mesmo consulta cross-project — assumido que sim,
 * filtrando por `[System.TeamProject]` quando um projeto é informado, mesmo
 * espírito do `project = "KEY"` do Jira; (2) o shape exato de
 * `updates[].fields['System.State'].oldValue/.newValue` em
 * `GET .../workitems/{id}/updates`, usado pras transições de status.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class AzureBoardsProvider extends BaseProvider {
  readonly providerName = 'azure_boards';
  readonly category: ProviderCategory = 'issue_tracker';

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

  /**
   * Enquanto `context.since` não existe, o backfill ainda não completou —
   * a busca é fatiada em janelas de tempo adaptativas (`backfill-window.ts`),
   * mesmo padrão do Jira/GitHub. Uma vez completo, volta ao modo simples.
   */
  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const apiToken = this.resolveApiToken(context.credentials);
      const organization = this.resolveOrganization(context.credentials);
      const project = this.resolveProject(context.credentials);
      const headers = this.buildHeaders(apiToken);

      return context.since
        ? await this.syncSincePage(organization, project, headers, context)
        : await this.syncBackfillPage(organization, project, headers, context);
    } catch (error) {
      return {
        success: false,
        fetchedCount: 0,
        errors: [`[${this.providerName}] Falha na sincronização: ${this.describeError(error)}`],
      };
    }
  }

  /** Modo simples de sempre — uma WIQL, sem janela, escopada por `System.ChangedDate >= since`. */
  private async syncSincePage(
    organization: string,
    project: string | undefined,
    headers: Record<string, string>,
    context: SyncContext,
  ): Promise<SyncResult> {
    const offset = context.cursor ? Number(context.cursor) : 0;
    const wiql = this.buildWiql(project, [`[System.ChangedDate] >= '${(context.since as Date).toISOString()}'`]);
    const ids = await this.runWiql(organization, headers, wiql);
    const pageIds = ids.slice(offset, offset + BATCH_MAX_PER_PAGE);

    if (pageIds.length === 0) {
      return { success: true, nextCursor: null, fetchedCount: 0 };
    }

    const items = await this.fetchWorkItemsBatch(organization, headers, pageIds);
    const { workItems, statusTransitions, discoveredIdentities, errors } = await this.processItems(
      items,
      context,
      organization,
      headers,
    );

    const nextOffset = offset + BATCH_MAX_PER_PAGE;

    return {
      success: true,
      nextCursor: nextOffset < ids.length ? String(nextOffset) : null,
      fetchedCount: workItems.length,
      workItems,
      statusTransitions: statusTransitions.length > 0 ? statusTransitions : undefined,
      discoveredIdentities: discoveredIdentities.length > 0 ? discoveredIdentities : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /** Backfill em janelas adaptativas — ver `backfill-window.ts` pro algoritmo geral. */
  private async syncBackfillPage(
    organization: string,
    project: string | undefined,
    headers: Record<string, string>,
    context: SyncContext,
  ): Promise<SyncResult> {
    const floor = computeBackfillFloor();
    const parsedCursor = parseBackfillCursor(context.cursor);
    const windowEnd = parsedCursor?.windowEnd ?? new Date();
    const page = parsedCursor?.page ?? 1;
    const offset = parsedCursor?.pageToken ? Number(parsedCursor.pageToken) : 0;
    let windowSizeDays = parsedCursor?.windowSizeDays ?? DEFAULT_WINDOW_SIZE_DAYS;

    if (page === 1) {
      windowSizeDays = await resolveSafeWindowSizeDays(windowEnd, windowSizeDays, floor, (start, end) =>
        this.countWorkItems(organization, project, headers, start, end),
      );
    }

    const windowStart = computeWindowStart(windowEnd, windowSizeDays, floor);
    const wiql = this.buildWiql(project, [
      `[System.CreatedDate] >= '${windowStart.toISOString()}'`,
      `[System.CreatedDate] <= '${windowEnd.toISOString()}'`,
    ]);
    const ids = await this.runWiql(organization, headers, wiql);
    const pageIds = ids.slice(offset, offset + BATCH_MAX_PER_PAGE);
    const items = pageIds.length > 0 ? await this.fetchWorkItemsBatch(organization, headers, pageIds) : [];
    const { workItems, statusTransitions, discoveredIdentities, errors } = await this.processItems(
      items,
      context,
      organization,
      headers,
    );

    const nextOffsetInWindow = offset + BATCH_MAX_PER_PAGE;
    let nextCursor: string | null;
    if (nextOffsetInWindow < ids.length) {
      nextCursor = serializeBackfillCursor({
        windowEnd,
        windowSizeDays,
        page: page + 1,
        pageToken: String(nextOffsetInWindow),
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
   * Sem endpoint de contagem aproximada dedicado (diferente do Jira,
   * `/search/approximate-count`) — roda a WIQL de verdade e usa o tamanho da
   * lista de ids devolvida. Mais caro que o ideal (a mesma chamada seria
   * refeita no fetch de verdade da página 1), mas simples e correto; o cap
   * de 20000 do próprio WIQL age como teto de segurança extra.
   */
  private async countWorkItems(
    organization: string,
    project: string | undefined,
    headers: Record<string, string>,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<number> {
    const wiql = this.buildWiql(project, [
      `[System.CreatedDate] >= '${windowStart.toISOString()}'`,
      `[System.CreatedDate] <= '${windowEnd.toISOString()}'`,
    ]);

    try {
      const ids = await this.runWiql(organization, headers, wiql);
      return ids.length;
    } catch {
      // Falha na contagem não deve travar o backfill inteiro — assume o pior
      // (teto cheio), o que força a próxima tentativa a encolher a janela.
      return WIQL_RESULT_CAP;
    }
  }

  private async runWiql(organization: string, headers: Record<string, string>, wiql: string): Promise<readonly number[]> {
    const response = await fetch(`https://dev.azure.com/${organization}/_apis/wit/wiql?api-version=${API_VERSION}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: wiql }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`WIQL retornou ${response.status} ${response.statusText}. ${detail}`.trim());
    }

    const body = (await response.json()) as AzureWiqlResponse;
    return body.workItems.slice(0, WIQL_RESULT_CAP).map((item) => item.id);
  }

  private async fetchWorkItemsBatch(
    organization: string,
    headers: Record<string, string>,
    ids: readonly number[],
  ): Promise<readonly AzureWorkItem[]> {
    const response = await fetch(
      `https://dev.azure.com/${organization}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, fields: WORK_ITEM_FIELDS }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`workitemsbatch retornou ${response.status} ${response.statusText}. ${detail}`.trim());
    }

    const body = (await response.json()) as AzureWorkItemBatchResponse;
    return body.value;
  }

  /**
   * Monta os registros canônicos + identidades descobertas + transições de
   * status de uma página já buscada. Diferente do Jira, `System.AssignedTo`
   * já vem inline no batch (nome/id/uniqueName) — sem chamada extra por
   * usuário pra resolver identidade, mesmo estilo "inline" do GitHub/Linear.
   */
  private async processItems(
    items: readonly AzureWorkItem[],
    context: SyncContext,
    organization: string,
    headers: Record<string, string>,
  ): Promise<{
    readonly workItems: CanonicalWorkItem[];
    readonly statusTransitions: CanonicalWorkItemStatusTransition[];
    readonly discoveredIdentities: CanonicalDiscoveredIdentity[];
    readonly errors: string[];
  }> {
    const workItems = items.map((item) => this.mapToCanonicalWorkItem(item, context.tenantId));

    const knownIds = context.knownExternalUserIds ?? new Set<string>();
    const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();
    for (const item of items) {
      const assignee = item.fields['System.AssignedTo'];
      if (assignee && !knownIds.has(assignee.id) && !discoveredIdentities.has(assignee.id)) {
        discoveredIdentities.set(assignee.id, this.mapToDiscoveredIdentity(assignee, context.tenantId));
      }
    }

    const errors: string[] = [];
    const statusTransitionsNested = await Promise.all(
      items.map((item) => this.fetchStatusTransitions(item, context.tenantId, organization, headers, errors)),
    );

    return {
      workItems,
      statusTransitions: statusTransitionsNested.flat(),
      discoveredIdentities: [...discoveredIdentities.values()],
      errors,
    };
  }

  /**
   * Transições de `System.State` do histórico de revisões do item — chamada
   * extra por item (N+1, mesmo padrão já aceito no GitHub pra detail/files/
   * commits do PR). Erros por item viram entrada em `errors`, nunca
   * derrubam a página inteira (mesmo espírito de `fetchRepositoryPageSafely`
   * do GitHub Actions).
   */
  private async fetchStatusTransitions(
    item: AzureWorkItem,
    tenantId: string,
    organization: string,
    headers: Record<string, string>,
    errors: string[],
  ): Promise<CanonicalWorkItemStatusTransition[]> {
    try {
      const response = await fetch(
        `https://dev.azure.com/${organization}/_apis/wit/workitems/${item.id}/updates?api-version=${API_VERSION}`,
        { headers },
      );

      if (!response.ok) {
        errors.push(
          `[${this.providerName}] Falha ao buscar histórico do work item ${item.id}: ${response.status} ${response.statusText}.`,
        );
        return [];
      }

      const body = (await response.json()) as AzureWorkItemUpdatesResponse;
      return body.value
        .filter((update) => update.fields?.['System.State']?.newValue !== undefined)
        .map((update) => ({
          tenantId,
          provider: 'azure_boards' as const,
          workItemExternalId: String(item.id),
          externalChangeId: String(update.id),
          fromStatus: update.fields?.['System.State']?.oldValue ?? null,
          // Non-null garantido pelo filter acima.
          toStatus: update.fields?.['System.State']?.newValue as string,
          transitionedAt: new Date(update.revisedDate),
        }));
    } catch (error) {
      errors.push(
        `[${this.providerName}] Erro ao buscar histórico do work item ${item.id}: ${this.describeError(error)}`,
      );
      return [];
    }
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

  /**
   * Escopa a WIQL a um único Project, quando informado. Opcional: ausente,
   * varre a organização inteira (mesmo modelo do `projectKey` do Jira) — o
   * time de cada item é então resolvido depois via `external_group_key`/
   * `team_resource_links` (`resourceType: 'azure_boards_project'`).
   */
  private resolveProject(credentials: ProviderCredentials): string | undefined {
    const project = credentials.extra?.project;
    return typeof project === 'string' && project.length > 0 ? project : undefined;
  }

  /** Azure DevOps autentica PAT via Basic Auth com usuário vazio (`:` + token). */
  private buildHeaders(apiToken: string): Record<string, string> {
    const basicAuth = Buffer.from(`:${apiToken}`).toString('base64');
    return { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' };
  }

  private buildWiql(project: string | undefined, filterClauses: readonly string[]): string {
    const projectClause = project ? `[System.TeamProject] = '${project}'` : '';
    const clauses = [projectClause, ...filterClauses].filter((clause) => clause.length > 0);
    const whereClause = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    return `SELECT [System.Id] FROM WorkItems${whereClause} ORDER BY [System.ChangedDate] DESC`;
  }

  private mapToCanonicalWorkItem(item: AzureWorkItem, tenantId: string): CanonicalWorkItem {
    const tags = item.fields['System.Tags'];

    return {
      tenantId,
      provider: 'azure_boards',
      externalId: String(item.id),
      rawIssueType: item.fields['System.WorkItemType'],
      rawStatus: item.fields['System.State'],
      // Azure DevOps guarda tags como string separada por "; ", não array (diferença real do Jira).
      rawLabels: tags ? tags.split(';').map((tag) => tag.trim()).filter(Boolean) : [],
      title: item.fields['System.Title'],
      assigneeExternalId: item.fields['System.AssignedTo']?.id ?? null,
      // Azure DevOps não distingue key curta vs. nome longo do Project como o
      // Jira (project.key vs. project.name) — os dois campos recebem o mesmo valor.
      externalGroupKey: item.fields['System.TeamProject'],
      externalGroupName: item.fields['System.TeamProject'],
      createdAt: new Date(item.fields['System.CreatedDate']),
      updatedAt: new Date(item.fields['System.ChangedDate']),
    };
  }

  private mapToDiscoveredIdentity(assignee: AzureIdentityRef, tenantId: string): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'azure_boards',
      externalUserId: assignee.id,
      externalUsername: assignee.displayName,
      externalEmail: assignee.uniqueName ?? null,
      externalAvatarUrl: assignee.imageUrl ?? null,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('azure_boards', AzureBoardsProvider);
