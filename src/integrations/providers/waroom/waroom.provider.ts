import { BaseProvider } from '../../core/base.provider';
import { ProviderFactory } from '../../core/provider.factory';
import type {
  CanonicalDiscoveredIdentity,
  CanonicalIncident,
  CanonicalIncidentSeverity,
  CanonicalIncidentStatus,
  ProviderCategory,
  ProviderCredentials,
  SyncContext,
  SyncResult,
} from '../../core/canonical.types';

/**
 * A doc pública mostra exemplos de curl usando `app.waroom.co`, mas isso
 * está errado/desatualizado — confirmado ao vivo: `app.waroom.co` serve só
 * o build estático do SPA (S3 + CloudFront, sem API nenhuma atrás de
 * `/v1/*`); a API de verdade mora em `api.waroom.co`.
 */
const WAROOM_BASE_URL = 'https://api.waroom.co';
const DEFAULT_PAGE_SIZE = 50;
const SEARCH_MAX_PER_PAGE = 100;

const KNOWN_SEVERITIES: readonly CanonicalIncidentSeverity[] = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

/** Subconjunto tipado de um incidente retornado por `GET /v1/incidents`. */
interface WaroomIncident {
  readonly short_id: string;
  readonly title: string;
  readonly severity: string;
  readonly service_id: string | null;
  readonly started_at: string;
  readonly acknowledged_at: string | null;
  readonly mitigated_at: string | null;
  readonly resolved_at: string | null;
  readonly canceled_at: string | null;
  readonly role_assignments: readonly unknown[];
}

interface WaroomIncidentsResponse {
  readonly incidents: readonly WaroomIncident[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Subconjunto tipado de um serviço retornado por `GET /v1/services`. Times
 * no Waroom pertencem a serviços, não a incidentes diretamente — por isso a
 * sync busca isso à parte pra resolver `serviceName`/`externalTeamId`.
 *
 * `GET /v1/teams` confirmado ao vivo como array puro (sem envelope
 * `{ teams: [...] }`, diferente de `/v1/incidents`) — assumindo o mesmo
 * padrão aqui, já que nenhum dos dois pagina (sem `page`/`pageSize` na
 * doc). Nome exato do campo de time (`team_id`) ainda não confirmado com
 * dado real — a validar/ajustar ao vivo, mesmo padrão de "descobrir e
 * corrigir" já usado no resto do conector.
 */
interface WaroomService {
  readonly id: string;
  readonly name: string;
  readonly team_id: string | null;
}

type WaroomServicesResponse = readonly WaroomService[];

interface ServiceInfo {
  readonly name: string;
  readonly teamId: string | null;
}

/** Subconjunto tipado de um time retornado por `GET /v1/teams` (array puro, confirmado ao vivo). */
interface WaroomTeam {
  readonly id: string;
  readonly name: string;
}

type WaroomTeamsResponse = readonly WaroomTeam[];

/**
 * Conector de Incident Management para o Waroom (waroom.co).
 *
 * Traduz incidentes para `CanonicalIncident`, alimentando DORA (Change
 * Failure Rate, MTTR) — Seção 2 da spec.
 *
 * Sem escopo por time na sync: times no Waroom são "grupos de pessoas
 * relacionados a um serviço", não um recorte de dados — a sync busca todo o
 * histórico de incidentes visível à API key (já "scoped" pelo próprio
 * Waroom na criação da key) e resolve o time de cada incidente via seu
 * serviço, pra uso como dimensão de filtro depois (mapeamento pra
 * `teams.id` da plataforma fica pra uma rodada futura).
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class WaroomProvider extends BaseProvider {
  readonly providerName = 'waroom';
  readonly category: ProviderCategory = 'incident';

  async testConnection(
    credentials: ProviderCredentials,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const apiToken = this.resolveApiToken(credentials);

      const response = await fetch(this.buildIncidentsUrl(1, 1), {
        headers: this.buildHeaders(apiToken),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `Waroom respondeu ${response.status} ${response.statusText} em /v1/incidents.`,
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

      const page = context.cursor ? Number.parseInt(context.cursor, 10) : 1;
      const pageSize = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, SEARCH_MAX_PER_PAGE);

      const [serviceMap, teamMap] = await Promise.all([
        this.fetchServiceMap(apiToken),
        this.fetchTeamMap(apiToken),
      ]);

      const response = await fetch(this.buildIncidentsUrl(page, pageSize), {
        headers: this.buildHeaders(apiToken),
      });

      if (!response.ok) {
        return {
          success: false,
          fetchedCount: 0,
          errors: [
            `[${this.providerName}] Falha ao buscar incidentes: ${response.status} ${response.statusText}.`,
          ],
        };
      }

      const data = (await response.json()) as WaroomIncidentsResponse;
      const incidents = data.incidents.map((incident) =>
        this.mapToCanonicalIncident(incident, context.tenantId, serviceMap, teamMap),
      );

      const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();
      for (const incident of incidents) {
        if (incident.assigneeExternalId) {
          discoveredIdentities.set(
            incident.assigneeExternalId,
            this.mapToDiscoveredIdentity(incident.assigneeExternalId, context.tenantId),
          );
        }
      }

      const hasMorePages = page * pageSize < data.total;

      return {
        success: true,
        nextCursor: hasMorePages ? String(page + 1) : null,
        fetchedCount: incidents.length,
        incidents,
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
   * Busca `GET /v1/services` e monta um mapa `service_id -> {name, teamId}`
   * pra resolver `serviceName`/`externalTeamId` de cada incidente.
   *
   * Best-effort: a API key pode ter só o scope `incidents:read` (sem
   * `services:read`) — qualquer falha aqui degrada silenciosamente pra um
   * mapa vazio, sem abortar a sync de incidentes.
   */
  private async fetchServiceMap(apiToken: string): Promise<Map<string, ServiceInfo>> {
    const map = new Map<string, ServiceInfo>();

    try {
      const response = await fetch(`${WAROOM_BASE_URL}/v1/services`, {
        headers: this.buildHeaders(apiToken),
      });

      if (!response.ok) {
        return map;
      }

      const services = (await response.json()) as WaroomServicesResponse;
      for (const service of services) {
        map.set(service.id, { name: service.name, teamId: service.team_id });
      }
    } catch {
      // Best-effort — falha na resolução de serviços não deve abortar a sync de incidentes.
    }

    return map;
  }

  /**
   * Busca `GET /v1/teams` e monta um mapa `team_id -> nome`, só pra
   * exibição/debug — o join futuro com `teams.id` da plataforma usa
   * `externalTeamId` (o ID bruto), não esse nome.
   *
   * Best-effort, mesmo padrão de `fetchServiceMap`: falha aqui não aborta a
   * sync de incidentes.
   */
  private async fetchTeamMap(apiToken: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    try {
      const response = await fetch(`${WAROOM_BASE_URL}/v1/teams`, {
        headers: this.buildHeaders(apiToken),
      });

      if (!response.ok) {
        return map;
      }

      const teams = (await response.json()) as WaroomTeamsResponse;
      for (const team of teams) {
        map.set(team.id, team.name);
      }
    } catch {
      // Best-effort — falha na resolução de times não deve abortar a sync de incidentes.
    }

    return map;
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

  private buildHeaders(apiToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    };
  }

  /**
   * Sem filtro de time nem de data (`from`/`to`) de propósito: busca sempre
   * o histórico completo visível à API key. O filtro de data seria por
   * data de *criação*, não de atualização — usá-lo como `since` faria a
   * sync perder pra sempre a resolução de incidentes criados antes da
   * última execução, corrompendo exatamente o dado que MTTR/Change Failure
   * Rate precisam.
   */
  private buildIncidentsUrl(page: number, pageSize: number): URL {
    const url = new URL(`${WAROOM_BASE_URL}/v1/incidents`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));

    return url;
  }

  private normalizeSeverity(rawSeverity: string): CanonicalIncidentSeverity {
    const normalized = rawSeverity.toUpperCase();

    return (KNOWN_SEVERITIES as readonly string[]).includes(normalized)
      ? (normalized as CanonicalIncidentSeverity)
      : 'UNKNOWN';
  }

  /**
   * Deriva o status canônico dos timestamps (sempre presentes/ausentes de
   * forma inequívoca), não de `status_row.category` (taxonomia de workflow
   * configurável por org, cujos valores exatos não foram confirmados).
   */
  private resolveStatus(incident: WaroomIncident): CanonicalIncidentStatus {
    if (incident.canceled_at) return 'CANCELED';
    if (incident.resolved_at) return 'RESOLVED';
    if (incident.mitigated_at) return 'INVESTIGATING';
    if (incident.acknowledged_at) return 'ACKNOWLEDGED';
    return 'TRIGGERED';
  }

  /**
   * Formato exato de `role_assignments` não confirmado (veio vazio no
   * payload de exemplo), mas `POST /v1/incidents/:id/roles` usa `userId`
   * pra identificar o usuário — extração tenta esse nome de campo primeiro.
   * A confirmar/ajustar ao vivo quando houver incidente com responsável
   * atribuído de verdade.
   */
  private resolveAssigneeExternalId(roleAssignments: readonly unknown[]): string | null {
    const [first] = roleAssignments;
    if (typeof first !== 'object' || first === null) {
      return null;
    }

    const candidate = first as Record<string, unknown>;
    const userId = candidate.userId ?? candidate.user_id ?? candidate.userID;

    return typeof userId === 'string' ? userId : null;
  }

  private mapToCanonicalIncident(
    incident: WaroomIncident,
    tenantId: string,
    serviceMap: ReadonlyMap<string, ServiceInfo>,
    teamMap: ReadonlyMap<string, string>,
  ): CanonicalIncident {
    const service = incident.service_id ? serviceMap.get(incident.service_id) : undefined;
    const externalTeamId = service?.teamId ?? null;

    return {
      tenantId,
      provider: 'waroom',
      externalId: incident.short_id,
      title: incident.title,
      severity: this.normalizeSeverity(incident.severity),
      status: this.resolveStatus(incident),
      // Fallback pro service_id bruto quando a resolução via /v1/services falhou (sem scope, etc.).
      serviceName: service?.name ?? incident.service_id,
      externalTeamId,
      externalTeamName: externalTeamId ? (teamMap.get(externalTeamId) ?? null) : null,
      assigneeExternalId: this.resolveAssigneeExternalId(incident.role_assignments),
      triggeredAt: new Date(incident.started_at),
      acknowledgedAt: incident.acknowledged_at ? new Date(incident.acknowledged_at) : null,
      resolvedAt: incident.resolved_at ? new Date(incident.resolved_at) : null,
    };
  }

  /**
   * O Waroom não expõe nome/email do responsável de um incidente em nenhum
   * payload já buscado (`role_assignments` traz só o `userId`) — a
   * identidade descoberta fica limitada ao ID bruto. Isso também tende a
   * aparecer pouco na prática: o time raramente se autoatribui a
   * incidentes na ferramenta, não é uma limitação da extração.
   */
  private mapToDiscoveredIdentity(externalUserId: string, tenantId: string): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'waroom',
      externalUserId,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('waroom', WaroomProvider);
