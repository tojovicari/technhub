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

const LINEAR_API_URL = 'https://api.linear.app/graphql';
const DEFAULT_PAGE_SIZE = 50;
/** Limite prático por página da API GraphQL do Linear. */
const SEARCH_MAX_PER_PAGE = 100;
/**
 * O schema central do Linear não tem um campo de "tipo de issue" (diferente
 * do Jira, que tem Story/Bug/Task) — categorização ali é só via labels.
 * `raw_issue_type` é NOT NULL na nossa tabela, então usamos o literal que o
 * próprio Linear usa pra nomear a entidade, em vez de inventar uma taxonomia
 * que a API não expõe.
 */
const LINEAR_ISSUE_TYPE = 'Issue';

const VIEWER_QUERY = `query Viewer { viewer { id } }`;

const ISSUES_QUERY = `
  query Issues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        identifier
        title
        state { name }
        labels { nodes { name } }
        assignee { id name avatarUrl email }
        team { key name }
        createdAt
        updatedAt
        history(first: 50) {
          nodes {
            id
            createdAt
            fromState { name }
            toState { name }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface LinearGraphQLResponse<T> {
  readonly data?: T;
  readonly errors?: readonly { readonly message: string }[];
}

interface LinearViewerResponse {
  readonly viewer: { readonly id: string };
}

interface LinearIssueNode {
  readonly identifier: string;
  readonly title: string;
  readonly state: { readonly name: string };
  readonly labels: { readonly nodes: readonly { readonly name: string }[] };
  readonly assignee: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly email: string | null;
  } | null;
  readonly team: { readonly key: string; readonly name: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Só a primeira página (limite prático) — issues com histórico muito
   * longo podem ter transições antigas faltando, limitação conhecida.
   */
  readonly history: { readonly nodes: readonly LinearHistoryNode[] };
}

interface LinearHistoryNode {
  readonly id: string;
  readonly createdAt: string;
  /**
   * `null` em entradas de histórico que não são de mudança de status (ex:
   * reatribuição) — não confirmado ao vivo pra esse caso específico, só
   * verificado pra uma transição de status real; filtrar por não-nulo é a
   * defesa contra isso.
   */
  readonly fromState: { readonly name: string } | null;
  readonly toState: { readonly name: string } | null;
}

interface LinearIssuesResponse {
  readonly issues: {
    readonly nodes: readonly LinearIssueNode[];
    readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
  };
}

/**
 * Conector de Issue Tracker para o Linear (API GraphQL).
 *
 * Traduz issues para `CanonicalWorkItem`, alimentando Flow Metrics
 * (Velocity, Distribution, Load, Time), SPACE (Activity) e métricas
 * operacionais (Toil, Retrabalho) — Seção 2 da spec.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class LinearProvider extends BaseProvider {
  readonly providerName = 'linear';
  readonly category: ProviderCategory = 'issue_tracker';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const apiToken = this.resolveApiToken(credentials);

      await this.graphqlRequest<LinearViewerResponse>(apiToken, VIEWER_QUERY, {});

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const apiToken = this.resolveApiToken(context.credentials);
      const teamKey = this.resolveTeamKey(context.credentials);
      const first = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, SEARCH_MAX_PER_PAGE);

      const filter: Record<string, unknown> = {};
      if (teamKey) {
        filter.team = { key: { eq: teamKey } };
      }
      if (context.since) {
        filter.updatedAt = { gte: context.since.toISOString() };
      }

      const data = await this.graphqlRequest<LinearIssuesResponse>(apiToken, ISSUES_QUERY, {
        filter,
        first,
        after: context.cursor ?? null,
      });

      const workItems = data.issues.nodes.map((node) => this.mapToCanonicalWorkItem(node, context.tenantId));
      const statusTransitions = data.issues.nodes.flatMap((node) =>
        this.mapToStatusTransitions(node, context.tenantId),
      );

      const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();
      for (const node of data.issues.nodes) {
        if (node.assignee) {
          const identity = this.mapToDiscoveredIdentity(node.assignee, context.tenantId);
          discoveredIdentities.set(identity.externalUserId, identity);
        }
      }

      return {
        success: true,
        nextCursor: data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null,
        fetchedCount: workItems.length,
        workItems,
        statusTransitions: statusTransitions.length > 0 ? statusTransitions : undefined,
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

  /**
   * Executa uma query GraphQL e devolve `data`, lançando se a resposta HTTP
   * não for OK ou se o payload trouxer `errors` (GraphQL frequentemente
   * responde 200 mesmo com erros de execução — precisa checar o corpo).
   */
  private async graphqlRequest<T>(
    apiToken: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: this.buildHeaders(apiToken),
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear respondeu ${response.status} ${response.statusText}.`);
    }

    const payload = (await response.json()) as LinearGraphQLResponse<T>;
    if (payload.errors && payload.errors.length > 0) {
      throw new Error(payload.errors.map((graphqlError) => graphqlError.message).join('; '));
    }
    if (!payload.data) {
      throw new Error('Resposta do Linear sem "data".');
    }

    return payload.data;
  }

  /**
   * Extrai o API key (`ProviderCredentials.apiToken`) já validado.
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
   * Escopa a busca a um único Team, quando informado. Opcional: ausente, a
   * busca varre todos os times visíveis à API key (mesmo modelo do GitHub,
   * escopado só pela organização) — o time de cada issue é então resolvido
   * depois, via `external_group_key`/`team_resource_links` (`resourceType`
   * `linear_team`), não mais só no cadastro da integração.
   */
  private resolveTeamKey(credentials: ProviderCredentials): string | undefined {
    const teamKey = credentials.extra?.teamKey;
    return typeof teamKey === 'string' && teamKey.length > 0 ? teamKey : undefined;
  }

  private buildHeaders(apiToken: string): Record<string, string> {
    return {
      // Linear recebe a API key direto no header, sem prefixo "Bearer".
      Authorization: apiToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private mapToCanonicalWorkItem(node: LinearIssueNode, tenantId: string): CanonicalWorkItem {
    return {
      tenantId,
      provider: 'linear',
      externalId: node.identifier,
      rawIssueType: LINEAR_ISSUE_TYPE,
      rawStatus: node.state.name,
      rawLabels: node.labels.nodes.map((label) => label.name),
      title: node.title,
      assigneeExternalId: node.assignee?.id ?? null,
      externalGroupKey: node.team.key,
      externalGroupName: node.team.name,
      createdAt: new Date(node.createdAt),
      updatedAt: new Date(node.updatedAt),
    };
  }

  /**
   * Filtra entradas de histórico sem `toState` (mudanças que não são de
   * status) — ver nota em `LinearHistoryNode.fromState` sobre isso não
   * estar 100% confirmado ao vivo pra esse caso específico.
   */
  private mapToStatusTransitions(node: LinearIssueNode, tenantId: string): CanonicalWorkItemStatusTransition[] {
    return node.history.nodes
      .filter((historyNode) => historyNode.toState !== null)
      .map((historyNode) => ({
        tenantId,
        provider: 'linear' as const,
        workItemExternalId: node.identifier,
        externalChangeId: historyNode.id,
        fromStatus: historyNode.fromState?.name ?? null,
        // Non-null garantido pelo filter acima.
        toStatus: (historyNode.toState as NonNullable<typeof historyNode.toState>).name,
        transitionedAt: new Date(historyNode.createdAt),
      }));
  }

  private mapToDiscoveredIdentity(
    assignee: NonNullable<LinearIssueNode['assignee']>,
    tenantId: string,
  ): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'linear',
      externalUserId: assignee.id,
      externalUsername: assignee.name,
      externalEmail: assignee.email,
      externalAvatarUrl: assignee.avatarUrl,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('linear', LinearProvider);
