import type { MetricTriggerConfig } from './metric-trigger-config.types';

/**
 * Fallback do Sistema pros gatilhos de DORA — 3º e último nível de
 * precedência (Time > Organização > Fallback do Sistema, mesmo modelo de
 * `system-default-rules.ts`).
 *
 * Reproduz **exatamente** o comportamento hardcoded que `dashboard.service.ts`
 * já tinha antes desta config existir — um tenant sem nada configurado em
 * nenhum nível não muda de número nenhum.
 */
export const SYSTEM_DEFAULT_TRIGGER_CONFIG: MetricTriggerConfig = {
  deploymentFrequency: { startEvent: 'CICD_DEPLOY' },
  leadTime: { startEvent: 'PR_OPENED', endEvent: 'PR_MERGED' },
  meanTimeToRestore: { startEvent: 'INCIDENT_TRIGGERED' },
  changeFailureRate: { correlationWindowHours: 1 },
};

/**
 * `updatedAt` usado quando nem time nem organização têm configuração —
 * mesmo raciocínio de `SYSTEM_DEFAULT_RULE_VERSION`: não existe `updated_at`
 * de banco pra esse caso, marco fixo representando "v1 do fallback
 * hardcoded". Data distinta de `SYSTEM_DEFAULT_RULE_VERSION` de propósito —
 * são dois fallbacks independentes, não deveriam parecer "a mesma versão"
 * só por coincidência de valor.
 */
export const SYSTEM_DEFAULT_TRIGGER_CONFIG_VERSION = new Date('2026-08-06T00:00:00.000Z');
