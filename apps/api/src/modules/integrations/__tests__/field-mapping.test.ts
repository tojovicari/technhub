import { describe, it, expect } from 'vitest';
import {
  resolveFieldMapping,
  mapSeverityToPriority,
  isProductionIncident,
  extractAffectedServices,
  isIncludedPriority,
} from '../connectors/field-mapping.js';

// ── resolveFieldMapping ───────────────────────────────────────────────────────

describe('resolveFieldMapping', () => {
  it('returns resolved mapping with all defaults applied', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { Critical: 'P1', Major: 'P2' },
      },
    };
    const mapping = resolveFieldMapping(scope);
    expect(mapping.severity_to_priority).toEqual({ Critical: 'P1', Major: 'P2' });
    expect(mapping.include_priorities).toEqual(['P1', 'P2']);
    expect(mapping.production_indicator).toEqual({ type: 'none' });
    expect(mapping.affected_service_field).toEqual({ type: 'none' });
    expect(mapping.opened_at_field).toBe('created_at');
  });

  it('preserves explicit values from scope', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { P1: 'P1' },
        include_priorities: ['P1', 'P2', 'P3'],
        production_indicator: { type: 'tag', values: ['prod'] },
        opened_at_field: 'impactStartDate',
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    expect(mapping.include_priorities).toEqual(['P1', 'P2', 'P3']);
    expect(mapping.production_indicator).toEqual({ type: 'tag', values: ['prod'] });
    expect(mapping.opened_at_field).toBe('impactStartDate');
  });

  it('throws when severity_to_priority is missing', () => {
    expect(() => resolveFieldMapping({})).toThrow(/severity_to_priority/);
  });

  it('throws when severity_to_priority is an empty object', () => {
    expect(() => resolveFieldMapping({ field_mapping: { severity_to_priority: {} } } as Record<string, unknown>)).toThrow(/severity_to_priority/);
  });

  it('handles null scope (returns error for missing mapping)', () => {
    expect(() => resolveFieldMapping(null)).toThrow(/severity_to_priority/);
  });
});

// ── mapSeverityToPriority ─────────────────────────────────────────────────────

describe('mapSeverityToPriority', () => {
  const mapping = resolveFieldMapping({
    field_mapping: {
      severity_to_priority: { Critical: 'P1', Major: 'P2', Minor: 'P3', SEV1: 'P1' },
    },
  });

  it('maps known severity to canonical priority', () => {
    expect(mapSeverityToPriority('Critical', mapping)).toBe('P1');
    expect(mapSeverityToPriority('Major', mapping)).toBe('P2');
    expect(mapSeverityToPriority('SEV1', mapping)).toBe('P1');
  });

  it('returns null for unknown severity names', () => {
    expect(mapSeverityToPriority('Unknown', mapping)).toBeNull();
    expect(mapSeverityToPriority('', mapping)).toBeNull();
  });
});

// ── isIncludedPriority ────────────────────────────────────────────────────────

describe('isIncludedPriority', () => {
  it('returns true for priorities in the include list', () => {
    const mapping = resolveFieldMapping({ field_mapping: { severity_to_priority: { A: 'P1' }, include_priorities: ['P1', 'P2'] } } as Record<string, unknown>);
    expect(isIncludedPriority('P1', mapping)).toBe(true);
    expect(isIncludedPriority('P2', mapping)).toBe(true);
  });

  it('returns false for priorities NOT in the include list', () => {
    const mapping = resolveFieldMapping({ field_mapping: { severity_to_priority: { A: 'P1' }, include_priorities: ['P1'] } } as Record<string, unknown>);
    expect(isIncludedPriority('P3', mapping)).toBe(false);
    expect(isIncludedPriority('P5', mapping)).toBe(false);
  });
});

// ── isProductionIncident ──────────────────────────────────────────────────────

describe('isProductionIncident', () => {
  it('returns true when production_indicator is "none" (all incidents pass)', () => {
    const mapping = resolveFieldMapping({ field_mapping: { severity_to_priority: { A: 'P1' } } });
    expect(isProductionIncident([], mapping)).toBe(true);
    expect(isProductionIncident(['staging'], mapping)).toBe(true);
  });

  it('returns true when any tag matches the production indicator (case-insensitive)', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { A: 'P1' },
        production_indicator: { type: 'tag', values: ['production', 'prod'] },
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    expect(isProductionIncident(['PRODUCTION', 'database'], mapping)).toBe(true);
    expect(isProductionIncident(['prod'], mapping)).toBe(true);
  });

  it('returns false when no tag matches', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { A: 'P1' },
        production_indicator: { type: 'tag', values: ['production'] },
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    expect(isProductionIncident(['staging', 'test'], mapping)).toBe(false);
    expect(isProductionIncident([], mapping)).toBe(false);
  });
});

// ── extractAffectedServices ───────────────────────────────────────────────────

describe('extractAffectedServices', () => {
  it('returns empty array when affected_service_field is "none"', () => {
    const mapping = resolveFieldMapping({ field_mapping: { severity_to_priority: { A: 'P1' } } });
    expect(extractAffectedServices({ impactedServices: ['svc-1'] }, mapping)).toEqual([]);
  });

  it('extracts impacted_services from OpsGenie payload', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { P1: 'P1' },
        affected_service_field: { type: 'impacted_services' },
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    expect(extractAffectedServices({ impactedServices: ['payment-api', 'checkout-api'] }, mapping)).toEqual(['payment-api', 'checkout-api']);
  });

  it('extracts from custom_field for incident.io', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { A: 'P1' },
        affected_service_field: { type: 'custom_field', field_id: 'field_abc' },
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    const payload = {
      custom_fields: [
        { id: 'field_abc', value: 'payments-service' },
        { id: 'other_field', value: 'ignored' },
      ],
    };
    expect(extractAffectedServices(payload, mapping)).toEqual(['payments-service']);
  });

  it('extracts from custom_field when value is an object with .name', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { A: 'P1' },
        affected_service_field: { type: 'custom_field', field_id: 'field_svc' },
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    const payload = {
      custom_fields: [{ id: 'field_svc', value: { name: 'order-api', id: 'svc-001' } }],
    };
    expect(extractAffectedServices(payload, mapping)).toEqual(['order-api']);
  });

  it('returns empty array when custom_field id not found in payload', () => {
    const scope = {
      field_mapping: {
        severity_to_priority: { A: 'P1' },
        affected_service_field: { type: 'custom_field', field_id: 'missing_field' },
      },
    };
    const mapping = resolveFieldMapping(scope as Record<string, unknown>);
    const payload = { custom_fields: [{ id: 'other_field', value: 'other' }] };
    expect(extractAffectedServices(payload, mapping)).toEqual([]);
  });
});
