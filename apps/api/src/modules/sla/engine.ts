import type { SlaConditionGroup, SlaRule } from './schema.js';

// ────────────────────────────────────────────────────────────────────────────────
// Condition evaluator
// ────────────────────────────────────────────────────────────────────────────────

function isLeafRule(rule: SlaRule | SlaConditionGroup): rule is SlaRule {
  return 'field' in rule && 'op' in rule;
}

function getFieldValue(event: Record<string, unknown>, field: string): unknown {
  return event[field];
}

function evaluateRule(rule: SlaRule, event: Record<string, unknown>): boolean {
  const val = getFieldValue(event, rule.field);

  switch (rule.op) {
    case 'eq':
      return val === rule.value;
    case 'in': {
      const arr = Array.isArray(rule.value) ? rule.value : [rule.value as string];
      return arr.includes(val as string);
    }
    case 'contains': {
      if (!Array.isArray(val)) return false;
      const target = rule.value;
      return Array.isArray(target)
        ? (target as string[]).some((t) => (val as string[]).includes(t))
        : (val as string[]).includes(target as string);
    }
    case 'any': {
      if (!Array.isArray(val)) return false;
      const targets = Array.isArray(rule.value) ? (rule.value as string[]) : [rule.value as string];
      return targets.some((t) => (val as string[]).includes(t));
    }
    case 'gte':
      return typeof val === 'number' && val >= (rule.value as number);
    case 'lte':
      return typeof val === 'number' && val <= (rule.value as number);
    default:
      return false;
  }
}

export function evaluateCondition(
  condition: SlaConditionGroup,
  event: Record<string, unknown>
): boolean {
  const results = condition.rules.map((rule) => {
    if (isLeafRule(rule)) {
      return evaluateRule(rule, event);
    }
    return evaluateCondition(rule, event);
  });

  return condition.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

// ────────────────────────────────────────────────────────────────────────────────
// SLA clock calculations
// ────────────────────────────────────────────────────────────────────────────────

export type SlaStatus = 'running' | 'met' | 'at_risk' | 'breached';

export interface SlaClockResult {
  status: SlaStatus;
  elapsed_minutes: number;
  deadline_at: Date;
  breach_minutes: number | null;
}

export function computeSlaStatus(
  startedAt: Date,
  targetMinutes: number,
  warningAtPercent: number,
  now: Date = new Date()
): SlaClockResult {
  const elapsedMs = now.getTime() - startedAt.getTime();
  const elapsedMinutes = elapsedMs / 60_000;
  const deadlineAt = new Date(startedAt.getTime() + targetMinutes * 60_000);
  const warningThreshold = (warningAtPercent / 100) * targetMinutes;

  let status: SlaStatus;
  let breachMinutes: number | null = null;

  if (elapsedMinutes >= targetMinutes) {
    status = 'breached';
    breachMinutes = Math.round(elapsedMinutes - targetMinutes);
  } else if (warningAtPercent > 0 && elapsedMinutes >= warningThreshold) {
    status = 'at_risk';
  } else {
    status = 'running';
  }

  return {
    status,
    elapsed_minutes: Math.round(elapsedMinutes),
    deadline_at: deadlineAt,
    breach_minutes: breachMinutes
  };
}


