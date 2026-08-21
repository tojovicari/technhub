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

const INCIDENT_IO_BASE_URL = 'https://api.incident.io';
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 250;

/** Categorias confirmadas nos docs públicos (`docs.incident.io/api-reference`) — enum fixo, não configurável por workspace (diferente do nome de severidade/status). */
type IncidentIoStatusCategory =
  | 'triage'
  | 'declined'
  | 'merged'
  | 'canceled'
  | 'live'
  | 'learning'
  | 'closed'
  | 'paused';

interface IncidentIoSeverity {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
}

interface IncidentIoStatus {
  readonly id: string;
  readonly name: string;
  readonly category: IncidentIoStatusCategory;
}

interface IncidentIoRoleAssignment {
  readonly role: {
    readonly role_type: 'lead' | 'reporter' | 'custom';
  };
  readonly assignee: {
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
  } | null;
}

/** Subconjunto tipado de um incidente retornado por `GET /v2/incidents`. */
interface IncidentIoIncident {
  readonly id: string;
  readonly name: string;
  readonly severity: IncidentIoSeverity | null;
  readonly incident_status: IncidentIoStatus;
  readonly incident_role_assignments: readonly IncidentIoRoleAssignment[];
  readonly created_at: string;
  readonly updated_at: string;
}

interface IncidentIoIncidentsResponse {
  readonly incidents: readonly IncidentIoIncident[];
  readonly pagination_meta: { readonly after: string | null };
}

/** Categorias terminais (o incidente já acabou, de um jeito ou de outro) — usado só pra aproximar `resolvedAt`, ver docstring da classe. */
const TERMINAL_CATEGORIES: readonly IncidentIoStatusCategory[] = ['learning', 'closed', 'declined', 'canceled', 'merged'];
const CANCELED_CATEGORIES: readonly IncidentIoStatusCategory[] = ['declined', 'canceled', 'merged'];

/**
 * Conector de Incident Management pra incident.io (incident.io).
 *
 * Traduz incidentes para `CanonicalIncident`, alimentando DORA (Change
 * Failure Rate, MTTR) — Seção 2 da spec. Mirror estrutural do conector
 * Waroom (`waroom.provider.ts`), mesma categoria (`incident`).
 *
 * **Construído contra a documentação pública da API (confirmada via
 * fetch dos docs, não por memória), sem credencial real pra testar** —
 * mesmo regime já aceito pra ArgoCD/Azure Boards/Repos/Pipelines nesta
 * base de código. Duas partes do modelo de dados da incident.io são
 * genuinamente configuráveis por workspace, não uma incerteza de
 * pesquisa:
 *
 * 1. **Severidade** (`severity.name`) é nome livre por workspace
 *    (defaults comuns "Minor"/"Major"/"Critical", não "SEV1".."4") —
 *    normalizado por palavra-chave (`normalizeSeverity`), heurística a
 *    ajustar no primeiro teste ao vivo.
 * 2. **Não existe campo fixo de "resolvido em"** — a API rastreia isso
 *    via `incident_timestamp_values`, também configurável por workspace
 *    (sem ID padrão confiável sem uma chamada extra a
 *    `GET /v2/incident_timestamps` por workspace). `resolvedAt` aqui é
 *    uma aproximação: `updated_at` quando a categoria do status já é
 *    terminal, `null` caso contrário — mesmo espírito de aproximação já
 *    aceito no `resolveStatus` do Waroom.
 *
 * Resolução de serviço/time (`serviceName`/`externalTeamId`) fica de
 * fora desta rodada — incident.io modela isso via Catalog/custom fields
 * configuráveis, sem um campo fixo equivalente ao `service_id` do
 * Waroom; revisitar com credencial real.
 *
 * @see .spec/spec-engineering-intelligence.md — Seções 2 e 7.
 */
export class IncidentIoProvider extends BaseProvider {
  readonly providerName = 'incident_io';
  readonly category: ProviderCategory = 'incident';

  async testConnection(credentials: ProviderCredentials): Promise<{ success: boolean; message?: string }> {
    try {
      const apiKey = this.resolveApiKey(credentials);

      const response = await fetch(this.buildIncidentsUrl(null, 1), {
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        return {
          success: false,
          message: `incident.io respondeu ${response.status} ${response.statusText} em /v2/incidents.`,
        };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: this.describeError(error) };
    }
  }

  /**
   * Paginação por cursor (`after` = `id` do último incidente da página
   * anterior, confirmado nos docs) — sem filtro de data de propósito,
   * mesmo racional do Waroom: filtrar por `created_at` como `since`
   * corromperia a resolução de incidentes antigos ainda não
   * sincronizados.
   */
  async syncIncremental(context: SyncContext): Promise<SyncResult> {
    try {
      const apiKey = this.resolveApiKey(context.credentials);
      const pageSize = Math.min(context.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

      const response = await fetch(this.buildIncidentsUrl(context.cursor ?? null, pageSize), {
        headers: this.buildHeaders(apiKey),
      });

      if (!response.ok) {
        return {
          success: false,
          fetchedCount: 0,
          errors: [`[${this.providerName}] Falha ao buscar incidentes: ${response.status} ${response.statusText}.`],
        };
      }

      const data = (await response.json()) as IncidentIoIncidentsResponse;
      const incidents = data.incidents.map((incident) => this.mapToCanonicalIncident(incident, context.tenantId));

      const discoveredIdentities = new Map<string, CanonicalDiscoveredIdentity>();
      for (let i = 0; i < data.incidents.length; i += 1) {
        const assignee = this.resolveAssignee(data.incidents[i].incident_role_assignments);
        if (assignee) {
          discoveredIdentities.set(assignee.id, this.mapToDiscoveredIdentity(assignee, context.tenantId));
        }
      }

      return {
        success: true,
        nextCursor: data.pagination_meta.after,
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
   * Extrai a API key já validada (`ProviderCredentials.apiKey` — campo
   * pensado pra isso, ver docblock do tipo).
   *
   * @throws {Error} Quando `apiKey` não foi informado.
   */
  private resolveApiKey(credentials: ProviderCredentials): string {
    this.validateRequiredCredentials(credentials, ['apiKey']);

    const { apiKey } = credentials;
    if (!apiKey) {
      // Inalcançável: validateRequiredCredentials já lança acima quando ausente.
      throw new Error(`[${this.providerName}] apiKey ausente.`);
    }

    return apiKey;
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };
  }

  private buildIncidentsUrl(cursor: string | null, pageSize: number): URL {
    const url = new URL(`${INCIDENT_IO_BASE_URL}/v2/incidents`);
    url.searchParams.set('page_size', String(pageSize));
    if (cursor) {
      url.searchParams.set('after', cursor);
    }

    return url;
  }

  /**
   * Nome de severidade é livre por workspace — normaliza por
   * palavra-chave (case insensitive). Heurística, não verificada contra
   * um workspace real (ver docstring da classe).
   */
  private normalizeSeverity(severity: IncidentIoSeverity | null): CanonicalIncidentSeverity {
    if (!severity) return 'UNKNOWN';

    const name = severity.name.toLowerCase();
    if (name.includes('crit')) return 'SEV1';
    if (name.includes('major') || name.includes('high')) return 'SEV2';
    if (name.includes('minor') || name.includes('medium')) return 'SEV3';
    if (name.includes('low')) return 'SEV4';
    return 'UNKNOWN';
  }

  /** `category` é enum fixo confirmado nos docs (diferente do nome de severidade/status, que é livre). */
  private resolveStatus(category: IncidentIoStatusCategory): CanonicalIncidentStatus {
    if (category === 'triage') return 'TRIGGERED';
    if (category === 'live' || category === 'paused') return 'INVESTIGATING';
    if (category === 'learning' || category === 'closed') return 'RESOLVED';
    return 'CANCELED'; // declined | merged | canceled
  }

  /**
   * `updated_at` como aproximação de "resolvido em" quando a categoria
   * já é terminal — sem campo fixo na API pra isso (ver docstring da
   * classe). `null` enquanto o incidente ainda está em andamento.
   */
  private resolveResolvedAt(incident: IncidentIoIncident): Date | null {
    return TERMINAL_CATEGORIES.includes(incident.incident_status.category) ? new Date(incident.updated_at) : null;
  }

  /** Prefere o `lead` (incident commander); cai pro `reporter` se não houver. */
  private resolveAssignee(
    assignments: readonly IncidentIoRoleAssignment[],
  ): { readonly id: string; readonly name: string | null; readonly email: string | null } | null {
    const lead = assignments.find((a) => a.role.role_type === 'lead' && a.assignee);
    const reporter = assignments.find((a) => a.role.role_type === 'reporter' && a.assignee);
    const chosen = lead ?? reporter;

    if (!chosen?.assignee) return null;

    return { id: chosen.assignee.id, name: chosen.assignee.name ?? null, email: chosen.assignee.email ?? null };
  }

  private mapToCanonicalIncident(incident: IncidentIoIncident, tenantId: string): CanonicalIncident {
    const assignee = this.resolveAssignee(incident.incident_role_assignments);

    return {
      tenantId,
      provider: 'incident_io',
      externalId: incident.id,
      title: incident.name,
      severity: this.normalizeSeverity(incident.severity),
      status: this.resolveStatus(incident.incident_status.category),
      // Resolução de serviço/time fica de fora desta rodada — ver docstring da classe.
      serviceName: null,
      externalTeamId: null,
      externalTeamName: null,
      assigneeExternalId: assignee?.id ?? null,
      triggeredAt: new Date(incident.created_at),
      acknowledgedAt: null,
      resolvedAt: this.resolveResolvedAt(incident),
    };
  }

  private mapToDiscoveredIdentity(
    assignee: { readonly id: string; readonly name: string | null; readonly email: string | null },
    tenantId: string,
  ): CanonicalDiscoveredIdentity {
    return {
      tenantId,
      provider: 'incident_io',
      externalUserId: assignee.id,
      externalUsername: assignee.name,
      externalEmail: assignee.email,
    };
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

ProviderFactory.register('incident_io', IncidentIoProvider);
