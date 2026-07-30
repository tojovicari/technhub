/**
 * Domain Context Engine — tipos do motor de mapeamento semântico.
 *
 * @see .spec/spec-engineering-intelligence.md — Seção 3.
 */

/** Operadores suportados nas condições de regra — os únicos exemplificados na spec. */
export type ConditionOperator = 'IN' | 'CONTAINS_ANY' | 'EQUALS';

/** 'ANY' = qualquer condição batendo já ativa a regra; 'ALL' = todas precisam bater. */
export type MatchMode = 'ANY' | 'ALL';

/** Campo do registro canônico avaliado por uma condição (work item, deploy ou incidente). */
export type RuleConditionField = 'issue_type' | 'labels' | 'environment' | 'severity';

export interface RuleCondition {
  readonly field: RuleConditionField;
  readonly operator: ConditionOperator;
  readonly values: readonly string[];
}

/** Categoria semântica de um work item (Seção 5 — `enriched_work_items.semantic_category`). */
export type SemanticCategory = 'BUG' | 'FEATURE' | 'TECHNICAL_DEBT' | 'TOIL' | 'RISK';

export interface WorkItemTypeRule {
  readonly targetCategory: SemanticCategory;
  readonly matchMode: MatchMode;
  readonly conditions: readonly RuleCondition[];
}

/** Estado semântico de workflow (Seção 5 — `enriched_work_items.semantic_state`). */
export type SemanticState = 'BACKLOG' | 'IN_PROGRESS' | 'WAITING_REVIEW' | 'DONE';

export interface WorkflowStateRule {
  readonly targetState: SemanticState;
  readonly isActiveTime: boolean;
  readonly rawStatusValues: readonly string[];
}

/** Ambiente semântico de um deploy (Seção 5 — `enriched_deployments.semantic_environment`). */
export type SemanticEnvironment = 'PRODUCTION' | 'STAGING' | 'OTHER';

export interface DeploymentEnvironmentRule {
  readonly targetEnvironment: SemanticEnvironment;
  readonly matchMode: MatchMode;
  readonly conditions: readonly RuleCondition[];
}

/** Classificação de um incidente pra fins de Change Failure Rate (Seção 5 — `enriched_incidents.failure_classification`). */
export type IncidentFailureClassification = 'COUNTS_AS_FAILURE' | 'INFORMATIONAL';

export interface IncidentSeverityRule {
  readonly targetClassification: IncidentFailureClassification;
  readonly matchMode: MatchMode;
  readonly conditions: readonly RuleCondition[];
}

/** Corpo de `mapping_rules` — guardado em `team_metric_configurations.rules` (JSONB). */
export interface MappingRules {
  readonly workItemType: readonly WorkItemTypeRule[];
  readonly workflowStates: readonly WorkflowStateRule[];
  readonly deploymentEnvironment: readonly DeploymentEnvironmentRule[];
  readonly incidentSeverity: readonly IncidentSeverityRule[];
}

/**
 * Regras efetivas já resolvidas pela precedência Time > Organização >
 * Fallback do Sistema, junto com a versão aplicada (usada em
 * `enriched_work_items.applied_rule_version`).
 */
export interface EffectiveRules {
  readonly rules: MappingRules;
  readonly appliedRuleVersion: Date;
}

/**
 * Espelha `enriched_work_items` (Seção 5). `teamId` é nullable — Jira/Linear
 * podem sincronizar o site/workspace inteiro sem `projectKey`/`teamKey`
 * (rodada de vínculo pós-sync), então nem todo work item tem um time
 * resolvido ainda (ver `EnrichedIncident`, mesmo modelo).
 */
export interface EnrichedWorkItem {
  readonly id: string;
  readonly tenantId: string;
  readonly teamId: string | null;
  readonly semanticCategory: SemanticCategory;
  readonly semanticState: SemanticState;
  readonly isActiveWork: boolean;
  readonly startedWorkingAt: Date | null;
  readonly completedAt: Date | null;
  readonly processedAt: Date;
  readonly appliedRuleVersion: Date;
}

/** Espelha `enriched_deployments` (Seção 5). */
export interface EnrichedDeployment {
  readonly id: string;
  readonly tenantId: string;
  /** Nullable desde o conector ArgoCD (resolução por deployment via `team_resource_links`, não mais só por integração inteira — mesmo espírito de `EnrichedIncident.teamId`). */
  readonly teamId: string | null;
  readonly semanticEnvironment: SemanticEnvironment;
  readonly processedAt: Date;
  readonly appliedRuleVersion: Date;
}

/**
 * Espelha `enriched_incidents` (Seção 5). `teamId` é nullable — ao
 * contrário de `EnrichedWorkItem`/`EnrichedDeployment`, o Waroom não segue
 * o modelo "1 integração = 1 time" (decisão de uma rodada anterior), então
 * nem sempre há um time resolvido pra um incidente.
 */
export interface EnrichedIncident {
  readonly id: string;
  readonly tenantId: string;
  readonly teamId: string | null;
  readonly failureClassification: IncidentFailureClassification;
  readonly processedAt: Date;
  readonly appliedRuleVersion: Date;
}
