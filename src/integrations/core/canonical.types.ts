/**
 * Camada Canônica de Ingestão (Canonical Layer).
 *
 * Define a "Língua Franca" do sistema: modelos comuns para os quais todos os
 * conectores (`BaseProvider`) traduzem os payloads brutos da Raw Layer antes
 * de seguirem para a Enriched Layer, onde as regras semânticas por time são
 * aplicadas.
 *
 * Este módulo não deve depender de nenhum provedor específico nem de
 * bibliotecas externas — apenas tipos puros, consumidos por `BaseProvider`
 * (src/integrations/core/base.provider.ts) e pelo `sync.orchestrator.ts`.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2, 5 e 7.
 */

/** Categorias de origem suportadas, conforme a Matriz de Cobertura (Seção 2). */
export type ProviderCategory =
  | 'issue_tracker'
  | 'vcs'
  | 'cicd'
  | 'incident'
  | 'communication';

/** Issue Trackers suportados no MVP. */
export type IssueTrackerProvider = 'jira' | 'linear' | 'azure_boards';

/** Provedores de Version Control suportados no MVP. */
export type VcsProvider = 'github' | 'gitlab' | 'azure_repos';

/** Provedores de CI/CD suportados no MVP. */
export type CicdProvider = 'github_actions' | 'argocd' | 'azure_pipelines';

/** Provedores de Incident Management suportados no MVP. */
export type IncidentProvider = 'waroom' | 'pagerduty';

/** Provedores de Comunicação suportados no MVP. */
export type CommunicationProvider = 'slack' | 'teams';

/** União de todos os identificadores de provedor conhecidos pelo sistema. */
export type AnyProvider =
  | IssueTrackerProvider
  | VcsProvider
  | CicdProvider
  | IncidentProvider
  | CommunicationProvider;

/**
 * Credenciais de acesso a um provedor externo.
 *
 * Como cada integração exige um conjunto distinto de segredos (token simples,
 * par OAuth2, instância self-hosted com `baseUrl` própria, etc.), a interface
 * mantém os campos mais comuns como opcionais e reserva `extra` para
 * parâmetros específicos de um conector sem recorrer a `any`.
 */
export interface ProviderCredentials {
  /** Chave de API estática (ex: PagerDuty, Incident.io). */
  readonly apiKey?: string;
  /** Token pessoal/de aplicação (ex: GitHub PAT, Jira API Token). */
  readonly apiToken?: string;
  /** Access token de fluxo OAuth2 (ex: Slack, GitHub App, Teams). */
  readonly accessToken?: string;
  /** Refresh token associado ao `accessToken`, quando aplicável. */
  readonly refreshToken?: string;
  /** Data de expiração do `accessToken`, quando aplicável. */
  readonly expiresAt?: Date;
  /** Identificador de cliente OAuth2 (client credentials flow). */
  readonly clientId?: string;
  /** Segredo de cliente OAuth2 (client credentials flow). */
  readonly clientSecret?: string;
  /** URL base para instâncias self-hosted (ex: Jira Server, GitLab CE, ArgoCD). */
  readonly baseUrl?: string;
  /** Identificador do workspace/organização remota (ex: Slack Team ID). */
  readonly workspaceId?: string;
  /** Parâmetros adicionais específicos de um conector, sem uso de `any`. */
  readonly extra?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Parâmetros de execução de uma sincronização incremental (`syncIncremental`).
 *
 * Carrega o cursor opaco devolvido pela execução anterior (via `SyncResult`)
 * para permitir retomada, além de limites de janela temporal e paginação.
 */
export interface SyncContext {
  /**
   * `providerName` do conector responsável por esta integração (ex: 'github'),
   * usado pelo `sync.orchestrator.ts` para resolvê-lo via `ProviderFactory`.
   */
  readonly providerName: string;
  /** Tenant (organização) para o qual a sincronização é executada. */
  readonly tenantId: string;
  /**
   * `id` da linha em `provider_integrations` que originou esta sincronização
   * — um tenant pode ter várias integrações do mesmo provider (ex: dois
   * boards Jira), então isso identifica qual delas, não só qual provider.
   * Repassado pelo `SyncOrchestrator` para estampar `provider_integration_id`
   * em cada registro canônico persistido (work items, deploys).
   */
  readonly integrationId: string;
  /** Time associado à integração, quando a conexão é escopada por time. */
  readonly teamId?: string;
  /** Credenciais de acesso ao provedor. */
  readonly credentials: ProviderCredentials;
  /**
   * Cursor opaco retornado pelo último `SyncResult.nextCursor`.
   * `null`/`undefined` indica que este é o início de uma sincronização.
   */
  readonly cursor?: string | null;
  /** Limite inferior (inclusive) de `updated_at` para a busca incremental. */
  readonly since?: Date;
  /** Limite superior (inclusive) de `updated_at` para a busca incremental. */
  readonly until?: Date;
  /** Tamanho de página sugerido ao provedor remoto. */
  readonly pageSize?: number;
  /** Indica uma carga histórica completa (primeira execução), sem `cursor`. */
  readonly isFirstSync?: boolean;
  /**
   * `external_user_id`s já conhecidos (`discovered_identities`) para este
   * tenant+provider, populado pelo `SyncOrchestrator` antes de invocar
   * `syncIncremental`. Usado por conectores cuja resolução de identidade
   * exige uma chamada extra por usuário (ex: Jira `accountId`), pra não
   * reprocessar quem já é conhecido. Provedores que capturam identidade
   * inline (GitHub, Linear, GitHub Actions, Waroom) podem ignorar.
   */
  readonly knownExternalUserIds?: ReadonlySet<string>;
  /** Quem disparou esta sync — `'manual'` (rota `.../sync`) ou `'cron'` (`/internal/sync`). Usado só para o histórico de execução (`integration_run_history`); default `'manual'` se omitido. */
  readonly triggeredBy?: 'manual' | 'cron';
  /**
   * Estado derivado cacheado por integração, análogo a `cursor` mas sem
   * relação com paginação — hoje só usado pelo Jira pra guardar o id do
   * custom field de Epic Link em projetos company-managed (descoberto uma
   * vez via `GET /rest/api/3/field`, ver `jira.provider.ts`).
   * `undefined` = nunca resolvido; `null` = já tentou resolver, o site não
   * tem esse campo (não tenta de novo toda sync).
   */
  readonly epicLinkFieldId?: string | null;
}

/**
 * Item de trabalho canônico, originado de Issue Trackers (Jira, Linear).
 *
 * Espelha `canonical_work_items` (Seção 5). Campos `raw*` preservam a
 * nomenclatura nativa do provedor — a tradução semântica (categoria, estado)
 * só ocorre na Enriched Layer, conforme o Domain Context Engine (Seção 3).
 *
 * Carrega `tenantId` pelo mesmo motivo de `CanonicalPullRequest`: instâncias
 * self-hosted/multi-tenant do provedor (ex: dois sites Jira diferentes)
 * podem coincidir em `externalId`, então a unicidade real é por tenant.
 */
export interface CanonicalWorkItem {
  readonly tenantId: string;
  readonly provider: IssueTrackerProvider;
  /** Identificador externo único no provedor (ex: 'JIRA-123'). */
  readonly externalId: string;
  /** Tipo de issue tal como reportado pelo provedor (ex: 'Story', 'Defect'). */
  readonly rawIssueType: string;
  /** Status tal como reportado pelo provedor (ex: 'In Dev'). */
  readonly rawStatus: string;
  /** Labels/tags nativas do provedor (ex: ['tech-debt', 'checkout']). */
  readonly rawLabels: readonly string[];
  readonly title: string;
  /** Identificador externo do responsável, resolvido posteriormente via alias. */
  readonly assigneeExternalId?: string | null;
  /**
   * "Grupo de origem" da issue no provedor — chave do projeto no Jira, key
   * do time no Linear. Nome neutro de propósito (nem "project" nem "team"):
   * "team" colidiria com o `teamId` da própria plataforma. Alimenta o
   * vínculo pós-sync via `team_resource_links` (`resourceType`
   * `jira_project`/`linear_team`), mesmo padrão de `canonical_pull_requests.repository`.
   */
  readonly externalGroupKey?: string | null;
  /** Nome de exibição do grupo de origem (nome do projeto no Jira, nome do time no Linear) — companheiro de `externalGroupKey`, `null` quando o provider não expõe. */
  readonly externalGroupName?: string | null;
  /**
   * Referência de 1 salto ao "pai/container" do item, traduzida do jeito
   * nativo de cada provider (Jira: `parent.key`, só team-managed — épico
   * clássico via custom field fica de fora, ver docs/BACKLOG.md; Linear:
   * `project.id`, que já é terminal, não é outro work item; Azure Boards:
   * id do work item pai via `System.LinkTypes.Hierarchy-Reverse`). Camada
   * Canônica só traduz — quem decide "isso já é o épico ou preciso subir
   * mais" é a Camada Enriquecida (`src/enrichment/epic-resolver.ts`).
   */
  readonly parentExternalId?: string | null;
  /** Só populado quando o provider dá o nome de graça sem chamada extra (hoje só Linear, via `project.name`) — Jira/Azure resolvem o nome do épico via self-join na Enriquecida, não aqui. */
  readonly parentExternalName?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Estado canônico de um Pull/Merge Request. */
export type CanonicalPullRequestState = 'OPEN' | 'MERGED' | 'CLOSED';

/**
 * Pull/Merge Request canônico, originado de sistemas de Version Control
 * (GitHub, GitLab).
 *
 * Alimenta DORA (Lead Time for Changes), SPACE (Activity, Communication &
 * Collaboration) e métricas operacionais de Code Churn/Retrabalho (Seção 2).
 *
 * Diferente de `canonical_work_items` na spec (Seção 5), este tipo carrega
 * `tenantId`: para provedores self-hosted (ex: GitLab CE), o `externalId`
 * só é único dentro da instância de um tenant — dois tenants diferentes
 * podem ter, por coincidência, o mesmo número de PR na mesma `repository`.
 * Sem `tenantId` na chave de unicidade, dados de tenants diferentes
 * colidiriam e se sobrescreveriam na Camada Canônica.
 */
export interface CanonicalPullRequest {
  readonly tenantId: string;
  readonly provider: VcsProvider;
  /** Identificador externo único no provedor (ex: número do PR). */
  readonly externalId: string;
  /** Repositório de origem, no formato 'owner/repo'. */
  readonly repository: string;
  readonly title: string;
  readonly state: CanonicalPullRequestState;
  readonly authorExternalId?: string | null;
  readonly reviewerExternalIds: readonly string[];
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly commentsCount: number;
  /**
   * Caminhos dos arquivos tocados pelo PR — alimenta a detecção de
   * Retrabalho/Code Churn (arquivo tocado de novo por um PR posterior).
   * Só a primeira página da API (até 100 arquivos) — PRs maiores que isso
   * perdem cobertura nos excedentes, limitação conhecida.
   */
  readonly changedFiles: readonly string[];
  /** Timestamp do primeiro commit, usado como possível marco de Lead Time. */
  readonly firstCommitAt?: Date | null;
  readonly openedAt: Date;
  readonly mergedAt?: Date | null;
  readonly closedAt?: Date | null;
  readonly updatedAt: Date;
}

/** Status canônico de uma execução de deploy. */
export type CanonicalDeploymentStatus =
  | 'SUCCESS'
  | 'FAILURE'
  | 'IN_PROGRESS'
  | 'CANCELLED';

/**
 * Deploy canônico, originado de sistemas de CI/CD (GitHub Actions, ArgoCD).
 *
 * Base para o cálculo de Deployment Frequency (DORA), cujo gatilho exato
 * (pipeline vs. transição de card) é definido pela configuração semântica do
 * time (Seção 6).
 */
export interface CanonicalDeployment {
  readonly tenantId: string;
  readonly provider: CicdProvider;
  /** Identificador externo único no provedor (ex: run ID, revision). */
  readonly externalId: string;
  /** Ambiente de destino do deploy (ex: 'production', 'staging'). */
  readonly environment: string;
  readonly status: CanonicalDeploymentStatus;
  readonly serviceName?: string | null;
  readonly commitSha?: string | null;
  readonly triggeredByExternalId?: string | null;
  readonly startedAt: Date;
  readonly finishedAt?: Date | null;
  /**
   * "Grupo de origem" do deploy no provedor — projeto do ArgoCD
   * (`spec.project` da Application). Nome neutro de propósito, mesmo
   * padrão de `CanonicalWorkItem.externalGroupKey`: alimenta o vínculo
   * pós-sync via `team_resource_links` (`resourceType: 'argocd_project'`).
   * Sempre `null` pro GitHub Actions (modelo simples de sempre, 1 integração = 1 time).
   */
  readonly externalGroupKey?: string | null;
}

/** Severidade canônica de um incidente. */
export type CanonicalIncidentSeverity =
  | 'SEV1'
  | 'SEV2'
  | 'SEV3'
  | 'SEV4'
  | 'UNKNOWN';

/**
 * Status canônico do ciclo de vida de um incidente. `CANCELED` foi
 * adicionado junto com o primeiro conector real de incidentes (Waroom) —
 * a spec original não previa esse valor porque foi escrita antes de
 * qualquer provider desta categoria existir, mas cancelamento é conceito
 * de primeira classe em ferramentas reais do setor.
 */
export type CanonicalIncidentStatus =
  | 'TRIGGERED'
  | 'ACKNOWLEDGED'
  | 'INVESTIGATING'
  | 'RESOLVED'
  | 'CANCELED';

/**
 * Incidente canônico, originado de ferramentas de Incident Management
 * (Waroom, PagerDuty).
 *
 * Base para Change Failure Rate e MTTR (DORA), calculados a partir do
 * intervalo entre `triggeredAt` e `resolvedAt` (Seção 2).
 */
export interface CanonicalIncident {
  readonly tenantId: string;
  readonly provider: IncidentProvider;
  /** Identificador externo único no provedor. */
  readonly externalId: string;
  readonly title: string;
  readonly severity: CanonicalIncidentSeverity;
  readonly status: CanonicalIncidentStatus;
  readonly serviceName?: string | null;
  /** Identificador de time no provedor de origem — bruto, não mapeado pra `teams.id` da plataforma ainda. */
  readonly externalTeamId?: string | null;
  /** Nome de exibição do time no provedor de origem — só pra exibição/debug, o join futuro usa `externalTeamId`. */
  readonly externalTeamName?: string | null;
  readonly assigneeExternalId?: string | null;
  readonly triggeredAt: Date;
  readonly acknowledgedAt?: Date | null;
  readonly resolvedAt?: Date | null;
}

/**
 * Métricas agregadas de comunicação, originadas de Slack/Microsoft Teams.
 *
 * Espelha `canonical_chat_stats` (Seção 5). Por Privacidade por Design
 * (Seção 1, Princípio 4), representa exclusivamente contagens agregadas por
 * usuário/canal/dia — nunca o corpo de mensagens.
 */
export interface CanonicalChatStat {
  readonly provider: CommunicationProvider;
  readonly userExternalId: string;
  readonly channelExternalId?: string | null;
  /** Data de referência da agregação, no formato ISO 'YYYY-MM-DD'. */
  readonly date: string;
  readonly messagesSentCount: number;
  readonly offHoursMessagesCount: number;
  readonly mentionsReceivedCount: number;
  readonly supportThreadsAnsweredCount: number;
}

/**
 * Identidade externa descoberta durante o sync (autor de PR, assignee de
 * issue/incidente, quem disparou um deploy) que ainda não tem um `User`
 * correspondente na plataforma. Alimenta `discovered_identities` — staging
 * table lida por GET /tenants/:tenantId/discovered-users para que um ADMIN
 * a converta num `User` real (POST /tenants/:tenantId/users) e a vincule
 * via alias (POST /tenants/:tenantId/users/:userId/aliases).
 */
export interface CanonicalDiscoveredIdentity {
  readonly tenantId: string;
  readonly provider: AnyProvider;
  readonly externalUserId: string;
  readonly externalUsername?: string | null;
  readonly externalEmail?: string | null;
  readonly externalAvatarUrl?: string | null;
}

/**
 * Resultado de uma execução de `BaseProvider.syncIncremental`.
 *
 * Carrega os lotes normalizados de cada tipo canônico coletado nesta
 * execução (tipicamente apenas um deles é populado, de acordo com a
 * categoria do provedor) e o cursor a ser reutilizado na próxima chamada.
 */
export interface SyncResult {
  readonly success: boolean;
  /** Cursor opaco a ser enviado no próximo `SyncContext.cursor`. */
  readonly nextCursor?: string | null;
  /** Quantidade total de registros retornados nesta execução. */
  readonly fetchedCount: number;
  readonly workItems?: readonly CanonicalWorkItem[];
  readonly pullRequests?: readonly CanonicalPullRequest[];
  readonly deployments?: readonly CanonicalDeployment[];
  readonly incidents?: readonly CanonicalIncident[];
  readonly chatStats?: readonly CanonicalChatStat[];
  readonly discoveredIdentities?: readonly CanonicalDiscoveredIdentity[];
  /** Transições de status de work items (changelog do Jira, `issue.history` do Linear) — só issue trackers. */
  readonly statusTransitions?: readonly CanonicalWorkItemStatusTransition[];
  /** Mensagens de erro não fatais ocorridas durante a coleta do lote. */
  readonly errors?: readonly string[];
  /**
   * `success: false` cujo motivo é um cursor de paginação que o provider
   * rejeitou como inválido/expirado (ex: Jira `nextPageToken` de uma janela
   * de backfill velha demais) — não adianta reter e reusar `last_cursor`
   * (o padrão pra falha comum, ver doc de `markSyncOutcome`), porque
   * reenviar o mesmo cursor vai falhar do mesmo jeito pra sempre. Sinaliza
   * pro repositório limpar `last_cursor` mesmo com `success: false`, pra
   * próxima tentativa recomeçar a janela — mesmo comportamento
   * autocorretivo que `parseBackfillCursor` já tem pra cursor malformado/
   * ausente (ver `backfill-window.ts`), só que disparado deliberadamente
   * em vez de por acaso.
   */
  readonly cursorInvalidated?: boolean;
  /** Análogo a `nextCursor`, pra `SyncContext.epicLinkFieldId` — só preenchido quando o provider resolve/confirma esse estado pela primeira vez. */
  readonly epicLinkFieldId?: string | null;
}

/**
 * Uma transição de status de um work item (Camada Canônica). Correlaciona
 * com `CanonicalWorkItem` por chave natural (`provider` + `workItemExternalId`,
 * mais `providerIntegrationId` na persistência) — não por FK direto, mesmo
 * padrão de `team_resource_links`. Alimenta `started_working_at`/
 * `completed_at` na Enriched Layer (ver `rule-evaluator.ts:evaluateWorkItemLifecycle`).
 */
export interface CanonicalWorkItemStatusTransition {
  readonly tenantId: string;
  readonly provider: IssueTrackerProvider;
  readonly workItemExternalId: string;
  /** Id da entrada de changelog/history no provider — idempotência de sync. */
  readonly externalChangeId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly transitionedAt: Date;
}
