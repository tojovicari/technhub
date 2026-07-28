import type { MappingRules } from './domain-context.types';

/**
 * Fallback do Sistema — 3º e último nível de precedência do Domain Context
 * Engine (Seção 3 da spec: Time > Organização > Fallback do Sistema).
 *
 * A spec descreve que esse fallback existe, mas não define suas regras
 * literalmente — este é um default razoável desenhado por nós, não uma
 * regra extraída da spec. Times e a organização podem sobrescrever tudo
 * isso via `team_metric_configurations`.
 *
 * Cobre nomenclatura padrão de board dos dois issue trackers já
 * implementados (Jira, Linear) — quando nenhuma condição bate, o motor de
 * avaliação (`rule-evaluator.ts`) cai num último fallback hardcoded
 * (`FEATURE` / `BACKLOG`), não precisa de uma regra "pega-tudo" aqui.
 */
export const SYSTEM_DEFAULT_RULES: MappingRules = {
  workItemType: [
    {
      targetCategory: 'BUG',
      matchMode: 'ANY',
      conditions: [
        { field: 'issue_type', operator: 'IN', values: ['Bug', 'Defect'] },
        { field: 'labels', operator: 'CONTAINS_ANY', values: ['bug'] },
      ],
    },
    {
      targetCategory: 'TECHNICAL_DEBT',
      matchMode: 'ANY',
      conditions: [
        { field: 'issue_type', operator: 'IN', values: ['Technical Debt', 'Debt'] },
        { field: 'labels', operator: 'CONTAINS_ANY', values: ['tech-debt', 'debt'] },
      ],
    },
    {
      targetCategory: 'TOIL',
      matchMode: 'ANY',
      conditions: [{ field: 'labels', operator: 'CONTAINS_ANY', values: ['toil'] }],
    },
  ],
  workflowStates: [
    {
      targetState: 'IN_PROGRESS',
      isActiveTime: true,
      rawStatusValues: ['In Progress', 'In Dev', 'Doing'],
    },
    {
      targetState: 'WAITING_REVIEW',
      isActiveTime: false,
      rawStatusValues: ['In Review', 'Review', 'Waiting QA', 'PR Opened'],
    },
    {
      targetState: 'DONE',
      isActiveTime: false,
      rawStatusValues: ['Done', 'Closed', 'Resolved', 'Merged', 'Canceled', 'Cancelled'],
    },
    {
      targetState: 'BACKLOG',
      isActiveTime: false,
      rawStatusValues: ['Backlog', 'To Do', 'Todo', 'Open'],
    },
  ],
  deploymentEnvironment: [
    {
      targetEnvironment: 'PRODUCTION',
      matchMode: 'ANY',
      conditions: [{ field: 'environment', operator: 'IN', values: ['production', 'prod', 'live'] }],
    },
    {
      targetEnvironment: 'STAGING',
      matchMode: 'ANY',
      conditions: [
        { field: 'environment', operator: 'IN', values: ['staging', 'stage', 'homolog', 'homologacao'] },
      ],
    },
  ],
  incidentSeverity: [
    {
      targetClassification: 'COUNTS_AS_FAILURE',
      matchMode: 'ANY',
      conditions: [{ field: 'severity', operator: 'IN', values: ['SEV1', 'SEV2'] }],
    },
  ],
};

/** Categoria/estado usados quando nenhuma regra (do time, da org ou do fallback) bate com o dado. */
export const ULTIMATE_FALLBACK_CATEGORY = 'FEATURE' as const;
export const ULTIMATE_FALLBACK_STATE = 'BACKLOG' as const;
export const ULTIMATE_FALLBACK_IS_ACTIVE_TIME = false;
export const ULTIMATE_FALLBACK_ENVIRONMENT = 'OTHER' as const;
export const ULTIMATE_FALLBACK_FAILURE_CLASSIFICATION = 'INFORMATIONAL' as const;

/**
 * `applied_rule_version` usado quando nem time nem organização têm
 * configuração — não existe `updated_at` de banco pra esse caso, então
 * usamos um marco fixo representando "v1 do fallback hardcoded".
 */
export const SYSTEM_DEFAULT_RULE_VERSION = new Date('2026-01-01T00:00:00.000Z');
