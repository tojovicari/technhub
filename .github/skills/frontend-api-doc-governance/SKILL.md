---
name: frontend-api-doc-governance
description: "Use when creating or editing any external API contract to guarantee frontend-ready documentation with endpoints, payloads, permissions, statuses, and compatibility notes"
---

# Skill: Frontend API Documentation Governance

## Goal
Ensure every API exposed to external consumers (frontend, CLI, partners, BI) is documented completely and faithfully before merge.

## Scope
Apply this skill whenever an API contract is created or edited, including:
- New route, method, or endpoint deprecation.
- Request/response schema change.
- Permission or authorization rule change.
- Status/error contract changes.
- Pagination/filter/sort behavior changes.

## Definition of Done (mandatory)
A change is only approved if all items below are complete.

1. Endpoint contract completeness
- Method + path + version declared.
- Purpose and business semantics clearly stated.
- Request schema documented (required/optional fields, types, defaults).
- Response schema documented for success.
- Error schemas documented for 400/401/403/404/409/422/429 (as applicable).
- Status codes mapped per scenario.

2. Frontend consumption completeness
- Required permissions per route documented.
- Tenant/scope constraints documented (tenant/team/project/own).
- Idempotency behavior documented for write routes.
- Pagination/sorting/filtering contract documented for list routes.
- Field-level notes for nullable, enum, deprecated, and computed fields.
- At least one realistic request/response example per endpoint.

3. Fidelity checks (docs vs implementation)
- OpenAPI matches implemented route signature and payload.
- Authorization policy bindings match required permissions.
- Example payloads reflect real field names and real status behavior.
- Breaking changes include version bump and migration notes.

4. Change communication
- Changelog section with what changed and why.
- Frontend impact section with migration actions (if any).
- Backward-compatibility classification: non-breaking or breaking.

## Required Artifacts
For each API change, update:
- OpenAPI file in docs/openapi/
- Authorization contract/bindings if permission changed
- Module docs affected (architecture/integrations/entities/etc.)

## Review Workflow
1. Identify all touched endpoints.
2. Generate contract diff (before vs after) for paths/schemas/statuses.
3. Validate permissions and tenant scope against policy docs.
4. Validate examples against real schema.
5. Produce pass/fail verdict with blocking gaps.

## Output Template
- API change summary:
- Endpoints affected:
- Payload changes:
- Status/error changes:
- Permission/policy changes:
- Frontend impact:
- Compatibility: non-breaking | breaking
- Required migration actions:
- Missing documentation items:
- Gate verdict: pass | fail

## Hard Fail Conditions
- Endpoint changed without OpenAPI update.
- Permission changed without policy/binding update.
- Payload/status changed without example updates.
- Breaking change without versioning and migration notes.
