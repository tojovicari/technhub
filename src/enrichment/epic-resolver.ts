import type { PersistedWorkItem } from '../integrations/repositories/work-item.repository';
import type { MappingRules } from './domain-context.types';
import { evaluateIsEpicBoundary } from './rule-evaluator';

/**
 * Cobre com folga a hierarquia padrão mais funda conhecida (Azure Boards
 * CMMI: Task→Requirement→Feature→Epic, 3 saltos), sem risco de loop caro
 * em dado malformado/cíclico — o teto por si só já protege contra ciclo,
 * não precisa de um guard de "visitados" separado.
 */
const DEFAULT_MAX_HOPS = 5;

export interface ResolvedEpicGroup {
  readonly epicExternalId: string;
  readonly epicExternalName: string | null;
}

/**
 * Resolve o "épico" de um work item — pura, sem I/O, dado o item, um lookup
 * de todos os itens da mesma integração (`externalId` → item, já buscado
 * por `EnrichmentService.runWorkItemEnrichment`) e as regras efetivas
 * (Time > Org > Fallback do Sistema).
 *
 * `null` cobre dois casos diferentes de propósito, ambos "não participa da
 * quebra por épico": (a) o item não tem nenhum épico resolvido (trabalho de
 * verdade, sem vínculo — mesmo espírito do `team: null` já usado em
 * `person-profile.service.ts`, não é erro) e (b) o item É ele mesmo um
 * épico (container, não conta a si mesmo — decisão de produto confirmada).
 * Quem persiste (`EnrichmentService`) distingue os dois via
 * `evaluateIsEpicBoundary` separadamente, pra marcar `isEpicContainer`.
 *
 * Resolução por provider é assimétrica de propósito (ver Seção 3 da spec):
 * Linear resolve direto via `project` (não é outro work item, não tem
 * "tipo" pra checar fronteira); Jira/Azure Boards sobem a cadeia de
 * `parentExternalId` até achar um ancestral que seja fronteira de épico.
 * Resolução só dentro da mesma integração — parent em outro
 * projeto/integração fica fora de escopo (gap documentado no BACKLOG.md).
 */
export function resolveEpicGroup(
  item: PersistedWorkItem,
  itemsByExternalId: ReadonlyMap<string, PersistedWorkItem>,
  rules: MappingRules,
  maxHops: number = DEFAULT_MAX_HOPS,
): ResolvedEpicGroup | null {
  if (item.provider === 'linear') {
    return item.parentExternalId
      ? { epicExternalId: item.parentExternalId, epicExternalName: item.parentExternalName ?? null }
      : null;
  }

  let current: PersistedWorkItem = item;
  for (let hop = 0; hop < maxHops; hop++) {
    const parentExternalId = current.parentExternalId;
    if (!parentExternalId) {
      return null;
    }

    const parent = itemsByExternalId.get(parentExternalId);
    if (!parent) {
      // Pai fora deste lote (outra integração/projeto, ou ainda não sincronizado) — não dá pra resolver.
      return null;
    }

    if (evaluateIsEpicBoundary(parent.rawIssueType, parent.rawLabels, rules)) {
      return { epicExternalId: parent.externalId, epicExternalName: parent.title };
    }

    current = parent;
  }

  return null;
}
