import type {
  IncidentFailureClassification,
  MappingRules,
  MatchMode,
  RuleCondition,
  RuleConditionField,
  SemanticCategory,
  SemanticEnvironment,
  SemanticState,
} from './domain-context.types';
import type { CanonicalWorkItemStatusTransition } from '../integrations/core/canonical.types';
import {
  ULTIMATE_FALLBACK_CATEGORY,
  ULTIMATE_FALLBACK_ENVIRONMENT,
  ULTIMATE_FALLBACK_FAILURE_CLASSIFICATION,
  ULTIMATE_FALLBACK_IS_ACTIVE_TIME,
  ULTIMATE_FALLBACK_STATE,
} from './system-default-rules';

/**
 * Avaliador puro do Domain Context Engine (Seção 3 da spec) — sem I/O, dado
 * um work item bruto e um conjunto de regras já resolvido pela precedência
 * (`MappingRulesRepository.getEffectiveRules`), devolve a classificação.
 */

function getFieldValues(
  field: RuleConditionField,
  rawIssueType: string,
  rawLabels: readonly string[],
): readonly string[] {
  return field === 'issue_type' ? [rawIssueType] : rawLabels;
}

/**
 * Os três operadores (`IN`, `EQUALS`, `CONTAINS_ANY`) fazem a mesma checagem
 * de interseção — a spec não distingue comportamento entre eles além do
 * nome. Tratamos o valor do campo como um conjunto (1 elemento pra
 * `issue_type`, N elementos pra `labels`) e checamos se algum valor do
 * campo aparece em `condition.values`. Comparação case-insensitive.
 */
function evaluateCondition(condition: RuleCondition, rawIssueType: string, rawLabels: readonly string[]): boolean {
  const fieldValues = getFieldValues(condition.field, rawIssueType, rawLabels).map((value) =>
    value.toLowerCase(),
  );
  const conditionValues = condition.values.map((value) => value.toLowerCase());

  return fieldValues.some((value) => conditionValues.includes(value));
}

function evaluateConditions(
  conditions: readonly RuleCondition[],
  matchMode: MatchMode,
  rawIssueType: string,
  rawLabels: readonly string[],
): boolean {
  if (conditions.length === 0) {
    return false;
  }

  return matchMode === 'ANY'
    ? conditions.some((condition) => evaluateCondition(condition, rawIssueType, rawLabels))
    : conditions.every((condition) => evaluateCondition(condition, rawIssueType, rawLabels));
}

/**
 * Avalia a categoria semântica de um work item. Regras avaliadas na ordem
 * declarada, primeira que bater vence. Sem nenhuma bater, cai no fallback
 * último (`FEATURE`) — nenhuma regra "pega-tudo" precisa existir na config.
 */
export function evaluateWorkItemType(
  rawIssueType: string,
  rawLabels: readonly string[],
  rules: MappingRules,
): SemanticCategory {
  for (const rule of rules.workItemType) {
    if (evaluateConditions(rule.conditions, rule.matchMode, rawIssueType, rawLabels)) {
      return rule.targetCategory;
    }
  }

  return ULTIMATE_FALLBACK_CATEGORY;
}

/** Avalia o estado semântico de workflow e se conta como tempo ativo de trabalho. */
export function evaluateWorkflowState(
  rawStatus: string,
  rules: MappingRules,
): { readonly state: SemanticState; readonly isActiveTime: boolean } {
  const normalizedStatus = rawStatus.toLowerCase();

  for (const rule of rules.workflowStates) {
    if (rule.rawStatusValues.some((value) => value.toLowerCase() === normalizedStatus)) {
      return { state: rule.targetState, isActiveTime: rule.isActiveTime };
    }
  }

  return { state: ULTIMATE_FALLBACK_STATE, isActiveTime: ULTIMATE_FALLBACK_IS_ACTIVE_TIME };
}

/**
 * Checagem de interseção pra regras com um único valor de entrada
 * (`environment`, `severity`) — ao contrário de work items, que avaliam
 * dois campos possíveis (`issue_type`/`labels`), essas regras sempre
 * comparam contra o mesmo valor, então não precisam despachar por
 * `condition.field`. Mesma semântica de case-insensitive dos operadores.
 */
function evaluateSingleValueCondition(condition: RuleCondition, value: string): boolean {
  const normalizedValue = value.toLowerCase();
  const conditionValues = condition.values.map((conditionValue) => conditionValue.toLowerCase());

  return conditionValues.includes(normalizedValue);
}

function evaluateSingleValueConditions(
  conditions: readonly RuleCondition[],
  matchMode: MatchMode,
  value: string,
): boolean {
  if (conditions.length === 0) {
    return false;
  }

  return matchMode === 'ANY'
    ? conditions.some((condition) => evaluateSingleValueCondition(condition, value))
    : conditions.every((condition) => evaluateSingleValueCondition(condition, value));
}

/**
 * Avalia o ambiente semântico de um deploy (ex: "prod-us-east" -> `PRODUCTION`).
 * Sem nenhuma regra bater, cai no fallback último (`OTHER`).
 *
 * `rules.deploymentEnvironment ?? []`: configs salvas antes desta rodada
 * (JSONB já persistido em `team_metric_configurations`) não têm essa chave
 * — o tipo `MappingRules` foi ampliado, mas dado antigo no banco não muda
 * retroativamente. Tratamos como "sem regra configurada" em vez de estourar.
 */
export function evaluateDeploymentEnvironment(environment: string, rules: MappingRules): SemanticEnvironment {
  for (const rule of rules.deploymentEnvironment ?? []) {
    if (evaluateSingleValueConditions(rule.conditions, rule.matchMode, environment)) {
      return rule.targetEnvironment;
    }
  }

  return ULTIMATE_FALLBACK_ENVIRONMENT;
}

/**
 * Avalia se um incidente conta como Change Failure. Sem nenhuma regra
 * bater, cai no fallback último (`INFORMATIONAL`). Mesma defesa contra
 * JSONB antigo descrita em `evaluateDeploymentEnvironment`.
 */
export function evaluateIncidentSeverity(
  severity: string,
  rules: MappingRules,
): IncidentFailureClassification {
  for (const rule of rules.incidentSeverity ?? []) {
    if (evaluateSingleValueConditions(rule.conditions, rule.matchMode, severity)) {
      return rule.targetClassification;
    }
  }

  return ULTIMATE_FALLBACK_FAILURE_CLASSIFICATION;
}

/**
 * Avalia quando um work item entrou em trabalho ativo e quando foi
 * concluído, a partir do histórico de transições de status (changelog do
 * Jira, `issue.history` do Linear) — alimenta
 * `enriched_work_items.started_working_at`/`completed_at` (Velocity, Cycle
 * Time). "Primeira" ocorrência em ambos os casos, não a última — cobre
 * reabertura sem contar tempo extra, convenção padrão de cycle time.
 *
 * O estado do item **entre a criação e a primeira transição registrada**
 * não aparece como uma "mudança" no changelog (não é uma transição, é o
 * estado inicial) — por isso usamos o `fromStatus` da primeira transição
 * (ou o status atual, se não há transição nenhuma) como o estado válido
 * desde `createdAt`, antes de percorrer as transições reais.
 */
export function evaluateWorkItemLifecycle(
  transitions: readonly CanonicalWorkItemStatusTransition[],
  currentRawStatus: string,
  createdAt: Date,
  rules: MappingRules,
): { readonly startedWorkingAt: Date | null; readonly completedAt: Date | null } {
  const sorted = [...transitions].sort((a, b) => a.transitionedAt.getTime() - b.transitionedAt.getTime());

  let startedWorkingAt: Date | null = null;
  let completedAt: Date | null = null;

  const initialStatus = sorted[0]?.fromStatus ?? currentRawStatus;
  const initial = evaluateWorkflowState(initialStatus, rules);
  if (initial.isActiveTime) {
    startedWorkingAt = createdAt;
  }
  if (initial.state === 'DONE') {
    completedAt = createdAt;
  }

  for (const transition of sorted) {
    const { state, isActiveTime } = evaluateWorkflowState(transition.toStatus, rules);

    if (startedWorkingAt === null && isActiveTime) {
      startedWorkingAt = transition.transitionedAt;
    }
    if (completedAt === null && state === 'DONE') {
      completedAt = transition.transitionedAt;
    }
  }

  return { startedWorkingAt, completedAt };
}
