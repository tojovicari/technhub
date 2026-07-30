import { BaseProvider } from '../../core/base.provider';
import { ProviderFactory } from '../../core/provider.factory';
import type {
  CanonicalDeployment,
  CanonicalDeploymentStatus,
  ProviderCategory,
  ProviderCredentials,
  SyncContext,
  SyncResult,
} from '../../core/canonical.types';

const DEFAULT_NAMESPACE = 'unknown';

/**
 * Subconjunto tipado de uma entrada de `status.history` — uma operação de
 * sync passada da Application. `id` é sequencial só dentro da própria app,
 * por isso `externalId` combina com o nome da app pra ser único no tenant.
 */
interface ArgoCDHistoryEntry {
  readonly id: number;
  readonly revision: string;
  readonly deployedAt: string;
  readonly deployStartedAt?: string;
}

/**
 * Subconjunto tipado de `status.operationState` — resultado da operação de
 * sync mais recente. Só a entrada mais nova de `status.history` usa isso
 * pra status real; entradas mais antigas assumem `SUCCESS` (uma entrada só
 * existe porque a sync seguinte já rodou por cima dela).
 */
interface ArgoCDOperationState {
  readonly phase: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

/** Subconjunto tipado de `GET /api/v1/applications`, um item de `items[]`. */
interface ArgoCDApplication {
  readonly metadata: { readonly name: string };
  readonly spec: {
    readonly project: string;
    readonly destination?: { readonly namespace?: string; readonly name?: string };
  };
  readonly status?: {
    readonly history?: readonly ArgoCDHistoryEntry[];
    readonly operationState?: ArgoCDOperationState;
  };
}

interface ArgoCDApplicationList {
  readonly items: readonly ArgoCDApplication[];
}

/**
 * Conector de CI/CD pro ArgoCD (GitOps) — segunda fonte de
 * `CanonicalDeployment`, ao lado do GitHub Actions.
 *
 * Diferente do GitHub Actions (1 integração = 1 repo = naturalmente 1
 * time), um servidor ArgoCD tipicamente gerencia Applications de vários
 * times ao mesmo tempo — por isso sincroniza tudo que o token enxerga, sem
 * escopo obrigatório, e carrega `spec.project` como `externalGroupKey` pro
 * vínculo pós-sync (`team_resource_links`, `resourceType: 'argocd_project'`),
 * mesmo padrão já usado por Jira/Linear/Waroom.
 *
 * **Não verificado ao vivo ainda** (diferente de todo outro conector desta
 * base de código) — construído em cima da API REST documentada do ArgoCD,
 * estável e bem conhecida, mas sem confirmação contra um servidor real.
 * Pontos de maior incerteza, marcados abaixo: se `GET /api/v1/applications`
 * pagina de alguma forma pra instâncias muito grandes (assumido que não,
 * dado o volume típico de Applications ser bem menor que PRs/issues de
 * outros conectores), e o shape exato de `status.history`/`operationState`.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class ArgoCDProvider extends BaseProvider {
  readonly providerName = 'argocd';
  readonly category: ProviderCategory = 'cicd';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const token = this.resolveApiToken(credentials);
      const baseUrl = this.resolveBaseUrl(credentials);

      const response = await fetch(`${baseUrl}/api/v1/session/userinfo`, {
        headers: this.buildHeaders(token),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `ArgoCD respondeu ${response.status} ${response.statusText} em /session/userinfo.`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  /**
   * Sem paginação/cursor: busca todas as Applications visíveis ao token
   * numa chamada só, sempre (`nextCursor` sempre `null`) — o volume típico
   * de Applications num ArgoCD é bem menor que PRs/issues de outros
   * conectores, e a API não expõe um filtro tipo `updated:>=X` pra
   * incremental de verdade. Cada sync reprocessa tudo; upsert idempotente
   * cobre isso sem duplicar nada, só um pouco mais de I/O que o ideal.
   */
  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const token = this.resolveApiToken(context.credentials);
      const baseUrl = this.resolveBaseUrl(context.credentials);
      const headers = this.buildHeaders(token);

      const response = await fetch(`${baseUrl}/api/v1/applications`, { headers });

      if (!response.ok) {
        return {
          success: false,
          fetchedCount: 0,
          errors: [
            `[${this.providerName}] Falha ao buscar applications: ${response.status} ${response.statusText}.`,
          ],
        };
      }

      const { items } = (await response.json()) as ArgoCDApplicationList;
      const errors: string[] = [];
      const deployments: CanonicalDeployment[] = [];

      for (const app of items) {
        try {
          deployments.push(...this.mapApplicationToDeployments(app, context.tenantId));
        } catch (itemError) {
          errors.push(
            `[${this.providerName}] Falha ao processar application "${app.metadata.name}": ${this.describeError(itemError)}`,
          );
        }
      }

      return {
        success: true,
        nextCursor: null,
        fetchedCount: deployments.length,
        deployments,
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
   * Extrai o token de acesso (`ProviderCredentials.apiToken`) já validado —
   * token de conta de serviço do ArgoCD (`argocd account generate-token`),
   * não login de usuário/senha.
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

  /** Cada tenant tem seu próprio servidor ArgoCD — sem default sensato. */
  private resolveBaseUrl(credentials: ProviderCredentials): string {
    this.validateRequiredCredentials(credentials, ['baseUrl']);

    const { baseUrl } = credentials;
    if (!baseUrl) {
      // Inalcançável: validateRequiredCredentials já lança acima quando ausente.
      throw new Error(`[${this.providerName}] baseUrl ausente.`);
    }

    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
  }

  /**
   * Uma Application pode virar vários `CanonicalDeployment` — um por
   * entrada de `status.history` (cada sync operation passada). Sem
   * histórico nenhum (app nova, nunca sincronizada), a lista vem vazia —
   * não é erro, só não há deploy pra reportar ainda.
   */
  private mapApplicationToDeployments(app: ArgoCDApplication, tenantId: string): CanonicalDeployment[] {
    const history = app.status?.history ?? [];
    const environment = app.spec.destination?.namespace ?? app.spec.destination?.name ?? DEFAULT_NAMESPACE;
    const lastIndex = history.length - 1;

    return history.map((entry, index) => {
      // Só a entrada mais recente usa o resultado real da operação — as
      // anteriores assumem SUCCESS (uma entrada só existe no histórico
      // porque a sync seguinte já rodou por cima dela).
      const isLatest = index === lastIndex;
      const operationState = isLatest ? app.status?.operationState : undefined;

      return {
        tenantId,
        provider: 'argocd',
        externalId: `${app.metadata.name}-${entry.id}`,
        environment,
        status: this.mapStatus(operationState?.phase),
        serviceName: app.metadata.name,
        commitSha: entry.revision,
        triggeredByExternalId: null,
        startedAt: new Date(entry.deployStartedAt ?? entry.deployedAt),
        finishedAt: new Date(operationState?.finishedAt ?? entry.deployedAt),
        externalGroupKey: app.spec.project,
      };
    });
  }

  private mapStatus(phase: string | undefined): CanonicalDeploymentStatus {
    switch (phase) {
      case undefined:
        // Sem operationState (entrada não é a mais recente): assume concluído com sucesso.
        return 'SUCCESS';
      case 'Succeeded':
        return 'SUCCESS';
      case 'Failed':
      case 'Error':
        return 'FAILURE';
      case 'Terminating':
        return 'CANCELLED';
      case 'Running':
      default:
        return 'IN_PROGRESS';
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('argocd', ArgoCDProvider);
