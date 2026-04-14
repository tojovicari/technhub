// ── Field Mapping — shared normalisation layer for incident connectors ─────────
//
// Each IntegrationConnection for OpsGenie / incident.io stores a `field_mapping`
// object inside its `scope` JSON column. The FieldMappingResolver reads that
// config and applies it when transforming a provider payload → IncidentEvent.
//
// Both connectors use the same resolver so normalisation is consistent across
// providers.

export type ProductionIndicator =
  | { type: 'tag'; values: string[] }
  | { type: 'custom_field'; field_id: string; values?: string[] }
  | { type: 'none' }; // consider all incidents as production

export type AffectedServiceField =
  | { type: 'impacted_services' }               // OpsGenie native field
  | { type: 'custom_field'; field_id: string }  // incident.io custom field
  | { type: 'none' };                           // not available

/** Canonical priority levels used across the platform. */
export type NormalizedPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5';

/**
 * Field mapping config stored in IntegrationConnection.scope.field_mapping.
 * Provider-specific severity/priority names are mapped to the canonical P1–P5
 * scale. All other fields control how incident data is extracted.
 */
export type FieldMapping = {
  /**
   * Maps provider severity/priority names → canonical P1–P5.
   * Required. At minimum must cover the values used in `include_priorities`.
   * Example: { "Critical": "P1", "Major": "P2", "SEV1": "P1" }
   */
  severity_to_priority: Record<string, NormalizedPriority>;

  /**
   * Which normalised priorities feed into MTTR / MTTA calculations.
   * Default: ["P1", "P2"]
   */
  include_priorities: NormalizedPriority[];

  /**
   * How to detect that an incident is a production incident.
   * If omitted or { type: "none" }, all synced incidents are included.
   */
  production_indicator?: ProductionIndicator;

  /**
   * Where to find the affected service name/ID in the provider payload.
   * Used for auto-matching against Project names/keys in the core module.
   */
  affected_service_field?: AffectedServiceField;

  /**
   * Which provider timestamp to treat as the incident open time (openedAt).
   * Defaults are provider-specific: "created_at" for incident.io,
   * "impactStartDate" for OpsGenie incidents (falls back to "createdAt").
   */
  opened_at_field?: string;
};

const DEFAULT_INCLUDE_PRIORITIES: NormalizedPriority[] = ['P1', 'P2'];

/** Parsed + validated field mapping, always safe to read. */
export type ResolvedFieldMapping = Required<FieldMapping>;

/**
 * Parse and validate the `field_mapping` object from a connection scope.
 * Throws if `severity_to_priority` is absent or empty (it is required).
 */
export function resolveFieldMapping(scope: Record<string, unknown> | null | undefined): ResolvedFieldMapping {
  const raw = (scope?.field_mapping ?? {}) as Partial<FieldMapping>;

  if (!raw.severity_to_priority || Object.keys(raw.severity_to_priority).length === 0) {
    throw new Error(
      'field_mapping.severity_to_priority is required for incident connectors. ' +
      'Configure it in the connection setup wizard.'
    );
  }

  return {
    severity_to_priority: raw.severity_to_priority,
    include_priorities: raw.include_priorities ?? DEFAULT_INCLUDE_PRIORITIES,
    production_indicator: raw.production_indicator ?? { type: 'none' },
    affected_service_field: raw.affected_service_field ?? { type: 'none' },
    opened_at_field: raw.opened_at_field ?? 'created_at',
  };
}

/**
 * Map a provider severity/priority string to the canonical P1–P5 scale.
 * Returns null if the value is not in the map (incident should be skipped
 * or logged as an unmapped severity warning).
 */
export function mapSeverityToPriority(
  severityName: string,
  mapping: ResolvedFieldMapping,
): NormalizedPriority | null {
  return mapping.severity_to_priority[severityName] ?? null;
}

/**
 * Returns true if the normalised priority should be included in
 * MTTR / MTTA calculations per the connection's field mapping.
 */
export function isIncludedPriority(
  priority: NormalizedPriority,
  mapping: ResolvedFieldMapping,
): boolean {
  return mapping.include_priorities.includes(priority);
}

/**
 * Checks whether a set of provider tags satisfies the production_indicator.
 * Always returns true when production_indicator is "none".
 */
export function isProductionIncident(
  tags: string[],
  mapping: ResolvedFieldMapping,
): boolean {
  const indicator = mapping.production_indicator;
  if (indicator.type === 'none') return true;
  if (indicator.type === 'tag') {
    const lowerTags = tags.map((t) => t.toLowerCase());
    return indicator.values.some((v) => lowerTags.includes(v.toLowerCase()));
  }
  // custom_field: caller must pre-resolve the field value and pass it in tags[]
  return true;
}

/**
 * Extract affected service names from a provider payload using the configured
 * affected_service_field strategy.
 *
 * Returns an empty array when the field is not configured or not present.
 * The caller is responsible for passing the correct payload shape.
 */
export function extractAffectedServices(
  payload: Record<string, unknown>,
  mapping: ResolvedFieldMapping,
): string[] {
  const config = mapping.affected_service_field;

  if (config.type === 'none') return [];

  if (config.type === 'impacted_services') {
    // OpsGenie: impactedServices is string[] of service IDs/names
    const raw = payload['impactedServices'] ?? payload['impacted_services'];
    if (Array.isArray(raw)) return raw.map(String);
    return [];
  }

  if (config.type === 'custom_field') {
    // incident.io: custom_fields is array of { id, value: { ... } }
    const fields = payload['custom_fields'];
    if (!Array.isArray(fields)) return [];
    const field = fields.find(
      (f: Record<string, unknown>) => f['id'] === config.field_id,
    ) as Record<string, unknown> | undefined;
    if (!field) return [];
    // value can be a string, an object with .name, or an array
    const val = field['value'];
    if (typeof val === 'string') return [val];
    if (val && typeof val === 'object' && 'name' in val) return [String((val as Record<string,unknown>)['name'])];
    if (Array.isArray(val)) return val.map(String);
    return [];
  }

  return [];
}
