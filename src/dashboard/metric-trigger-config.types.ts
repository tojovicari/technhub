import type { SemanticCategory } from '../enrichment/domain-context.types';

/**
 * Gatilhos configuráveis de DORA por time (Seção 6 da spec: "Valor da
 * Métrica = f(Evento Inicial, Evento Final, Filtro, Agrupamento)").
 *
 * Deliberadamente em `src/dashboard/`, não `src/enrichment/`: gatilho é
 * resolvido em tempo de query por `DashboardService`, não estampado por
 * linha em batch como `MappingRules`/`appliedRuleVersion` — preserva a
 * fronteira de camada ELT do CLAUDE.md (Enriched Layer é batch; DORA é
 * leitura agregada em cima dela).
 *
 * Guardado em `team_metric_configurations.metric_triggers` — coluna
 * própria, não uma chave dentro de `rules` (ver
 * `MappingRulesRepository.upsertTeamRules`/`upsertOrgRules`, que fazem
 * replace completo da coluna que gravam; misturar os dois nesse mesmo
 * JSONB arriscaria uma tela sobrescrever a outra).
 */

export type DeploymentFrequencyStartEvent = 'CICD_DEPLOY' | 'WORKFLOW_DONE_TRANSITION';

export interface DeploymentFrequencyTriggerConfig {
  readonly startEvent: DeploymentFrequencyStartEvent;
  /** Só usado com `startEvent: 'WORKFLOW_DONE_TRANSITION'` — sem filtro, conta toda categoria. */
  readonly categoryFilter?: readonly SemanticCategory[];
}

/** `CICD_DEPLOY` como fim é inferido por proximidade temporal (mesmo padrão do Change Failure Rate) — não existe vínculo PR→deploy explícito nos dados. */
export type LeadTimeStartEvent = 'PR_OPENED' | 'FIRST_COMMIT';
export type LeadTimeEndEvent = 'PR_MERGED' | 'CICD_DEPLOY';

export interface LeadTimeTriggerConfig {
  readonly startEvent: LeadTimeStartEvent;
  readonly endEvent: LeadTimeEndEvent;
}

export type MttrStartEvent = 'INCIDENT_TRIGGERED' | 'INCIDENT_ACKNOWLEDGED';

/** Sem `endEvent` configurável — `resolved_at` é o único sinal de "restaurado" nos dados, não uma omissão. */
export interface MttrTriggerConfig {
  readonly startEvent: MttrStartEvent;
}

export interface ChangeFailureRateTriggerConfig {
  readonly correlationWindowHours: number;
}

/** Corpo de `metric_triggers` — guardado em `team_metric_configurations.metric_triggers` (JSONB). */
export interface MetricTriggerConfig {
  readonly deploymentFrequency: DeploymentFrequencyTriggerConfig;
  readonly leadTime: LeadTimeTriggerConfig;
  readonly meanTimeToRestore: MttrTriggerConfig;
  readonly changeFailureRate: ChangeFailureRateTriggerConfig;
}

export type TriggerConfigPrecedenceSource = 'team' | 'org' | 'system_default';

/**
 * Config efetiva já resolvida pela precedência Time > Organização >
 * Fallback do Sistema — mesmo espírito de `EffectiveRules`
 * (`domain-context.types.ts`), mas expõe `source` (de qual nível resolveu),
 * que `EffectiveRules` não expõe hoje (ver plano, risco aberto #4).
 */
export interface EffectiveTriggerConfig {
  readonly config: MetricTriggerConfig;
  readonly source: TriggerConfigPrecedenceSource;
  readonly updatedAt: Date;
}

/**
 * Eco de "o que foi usado pra calcular este número" numa resposta de DORA —
 * Decisão 3a do plano de auditoria. Um `TriggerConfigSource` por métrica,
 * montado a partir do `EffectiveTriggerConfig` (que resolve as 4 de uma vez,
 * já que moram na mesma linha/coluna).
 */
export interface TriggerConfigSource<T> {
  readonly config: T;
  readonly source: TriggerConfigPrecedenceSource;
  readonly teamId: string | null;
  readonly updatedAt: string;
}
