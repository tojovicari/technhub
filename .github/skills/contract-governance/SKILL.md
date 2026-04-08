---
name: contract-governance
description: "Use when validating that API/event contracts, permissions, payload schemas, and docs remain consistent as modules evolve in CTO.ai"
---

# Skill: Contract Governance

## Goal
Create a repeatable quality gate so every backend change keeps API contracts, authorization policy, and payload documentation aligned.

## Use When
- A new endpoint is added or changed.
- A permission is added/renamed/removed.
- Event payload fields change.
- A module starts consuming a contract from another module.
- A PR touches `docs/openapi/*.yaml`, auth rules, or DTO schemas.

## Validation Gate (required)
1. Contract declaration
- API path/event name is versioned.
- Request/response (or event payload) has explicit required fields.
- Error model is defined (`401`, `403`, validation errors).

2. Authorization declaration
- Route binding has `required_permissions`.
- Tenant and scope constraints are explicit.
- `403` denial reasons are documented (`tenant_mismatch`, `missing_permission`, `scope_violation`).

3. Backward compatibility
- Non-breaking changes: additive only.
- Breaking changes: new version + migration notes.
- Deprecated fields are marked with replacement guidance.

4. Test coverage
- Producer contract test.
- Consumer contract test.
- Auth policy test for allow and deny paths.

5. Documentation sync
- OpenAPI updated in `docs/openapi/`.
- Architecture/domain docs updated when contracts change.
- Examples include realistic tenant-scoped payloads.

## Output Template
- Change summary:
- Contracts affected:
- Permissions affected:
- Compatibility classification: non-breaking | breaking
- Required migration actions:
- Missing tests:
- Missing docs:
- Final gate verdict: pass | fail

## Fast Review Checklist
- [ ] Versioned API/event contract
- [ ] Required permissions mapped per route
- [ ] Tenant/scope enforcement documented
- [ ] 401/403 error contracts documented
- [ ] Producer/consumer contract tests defined
- [ ] Migration notes for breaking changes
- [ ] OpenAPI + architecture docs synced
