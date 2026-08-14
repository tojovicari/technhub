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

const API_VERSION = '7.1';
const ENVIRONMENTS_API_VERSION = '7.1-preview.1';

interface AzureEnvironment {
  readonly id: number;
  readonly name: string;
}

interface AzureEnvironmentListResponse {
  readonly value: readonly AzureEnvironment[];
}

/** Subconjunto tipado de `GET .../environments/{id}/environmentdeploymentrecords`. */
interface AzureEnvironmentDeploymentRecord {
  readonly id: number;
  readonly result?: string;
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly owner?: { readonly name?: string };
}

interface AzureEnvironmentDeploymentRecordsResponse {
  readonly value: readonly AzureEnvironmentDeploymentRecord[];
}

interface AzureProject {
  readonly name: string;
}

interface AzureProjectListResponse {
  readonly value: readonly AzureProject[];
}

/**
 * Conector de CI/CD para o Azure Pipelines (Azure DevOps Services REST API)
 * — terceira fonte de `CanonicalDeployment`, ao lado do GitHub Actions e do
 * ArgoCD.
 *
 * **Cobre só o paradigma moderno de deploy (Environments), não Release
 * Management clássico** — mesmo princípio já usado pelo GitHub Actions
 * (nunca inferir deploy de heurística de execução de pipeline; só usar a
 * API que representa "isso foi marcado como deploy" de propósito). O Azure
 * DevOps tem dois sistemas de deploy que não conversam entre si: pipelines
 * YAML modernos publicam em `distributedtask/environments`; Release
 * Management clássico (`_apis/release/releases`) é um sistema à parte, fora
 * de escopo desta rodada — gap conhecido, não um esquecimento.
 *
 * `credentials.extra.project` **opcional**: informado, sincroniza só aquele
 * Project; omitido, descobre todos os Projects (`GET /_apis/projects`) e
 * itera um por vez — mesmo padrão "descobre depois anda" do
 * `AzureReposProvider`/`GitHubActionsProvider`. Sem paginação/cursor real
 * dentro de um Project — mesma decisão do ArgoCD: volume de deploys por
 * Environment é bem menor que PRs/work items, resync completo a cada
 * chamada, upsert idempotente cobre.
 *
 * **Não verificado ao vivo ainda** (mesma ressalva do ArgoCD/Azure Boards/
 * Azure Repos) — maior incerteza de todo o módulo Azure DevOps: não
 * confirmado se `environmentdeploymentrecords` carrega o SHA do commit
 * (`owner.name` é o melhor candidato encontrado na documentação, mas sem
 * confirmação) — se não carregar, `commitSha` fica sempre `null`,
 * degradação aceitável que não bloqueia o resto do mapeamento.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class AzurePipelinesProvider extends BaseProvider {
  readonly providerName = 'azure_pipelines';
  readonly category: ProviderCategory = 'cicd';

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

      const projects = project ? [project] : await this.fetchAllProjects(organization, headers);
      const errors: string[] = [];
      const deployments: CanonicalDeployment[] = [];

      for (const projectName of projects) {
        try {
          deployments.push(...(await this.fetchProjectDeployments(organization, projectName, headers, context.tenantId)));
        } catch (projectError) {
          errors.push(
            `[${this.providerName}] Falha ao processar Project "${projectName}": ${this.describeError(projectError)}`,
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

  private async fetchProjectDeployments(
    organization: string,
    project: string,
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<CanonicalDeployment[]> {
    const environments = await this.fetchEnvironments(organization, project, headers);
    const deploymentsByEnvironment = await Promise.all(
      environments.map((environment) =>
        this.fetchEnvironmentDeployments(organization, project, environment, headers, tenantId),
      ),
    );

    return deploymentsByEnvironment.flat();
  }

  private async fetchEnvironments(
    organization: string,
    project: string,
    headers: Record<string, string>,
  ): Promise<readonly AzureEnvironment[]> {
    const url = `https://dev.azure.com/${organization}/${project}/_apis/distributedtask/environments?api-version=${API_VERSION}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`GET ${url} retornou ${response.status} ${response.statusText}.`);
    }
    const { value } = (await response.json()) as AzureEnvironmentListResponse;
    return value;
  }

  private async fetchEnvironmentDeployments(
    organization: string,
    project: string,
    environment: AzureEnvironment,
    headers: Record<string, string>,
    tenantId: string,
  ): Promise<CanonicalDeployment[]> {
    const url = `https://dev.azure.com/${organization}/${project}/_apis/distributedtask/environments/${environment.id}/environmentdeploymentrecords?api-version=${ENVIRONMENTS_API_VERSION}`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      // Um Environment específico sem permissão/registro não pode travar os
      // outros — erro suave, mesmo espírito do `fetchRepositoryPageSafely` do GitHub Actions.
      return [];
    }
    const { value: records } = (await response.json()) as AzureEnvironmentDeploymentRecordsResponse;
    return records.map((record) => this.mapToCanonicalDeployment(record, environment.name, project, tenantId));
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
    return value.map((p) => p.name);
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

  private mapStatus(result: string | undefined): CanonicalDeploymentStatus {
    switch (result) {
      case 'succeeded':
        return 'SUCCESS';
      case 'failed':
        return 'FAILURE';
      case 'canceled':
        return 'CANCELLED';
      case 'inProgress':
      default:
        return 'IN_PROGRESS';
    }
  }

  private mapToCanonicalDeployment(
    record: AzureEnvironmentDeploymentRecord,
    environmentName: string,
    project: string,
    tenantId: string,
  ): CanonicalDeployment {
    return {
      tenantId,
      provider: 'azure_pipelines',
      externalId: String(record.id),
      // Cru, sem classificação semântica — quem decide "é produção" é a
      // Enriched Layer via mapping_rules, mesmo princípio do GitHub Actions.
      environment: environmentName,
      status: this.mapStatus(record.result),
      serviceName: environmentName,
      commitSha: record.owner?.name ?? null,
      triggeredByExternalId: null,
      startedAt: record.startTime ? new Date(record.startTime) : new Date(),
      finishedAt: record.finishTime ? new Date(record.finishTime) : null,
      // Nome do Project — mesma simplicidade do ArgoCD usando `spec.project`,
      // evita a ambiguidade de pipeline YAML com checkout multi-repo.
      externalGroupKey: project,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('azure_pipelines', AzurePipelinesProvider);
