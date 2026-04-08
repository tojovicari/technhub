## Summary

Describe the business intent and technical scope.

## External API Surface

- Endpoints added/changed/deprecated:
- Event contracts added/changed/deprecated:
- OpenAPI files touched:

## Authorization Impact

- Required permissions changed:
- Tenant/scope rules changed:
- 403 denial reasons impacted:

## Payload and Status Impact

- Request schema changes:
- Response schema changes:
- Status/error code changes:
- Frontend migration impact:

## Compatibility

- Classification: non-breaking | breaking
- Migration notes (if breaking):

## Documentation and Tests

- OpenAPI docs updated:
- Policy bindings updated:
- Contract tests updated:
- Consumer/frontend impact communicated:

## Frontend API Governance Checklist (Required for external API changes)

- [ ] No external API change in this PR
- [ ] Updated docs/openapi/* for every affected external endpoint/event
- [ ] Documented request/response payloads with realistic examples
- [ ] Documented required permissions and tenant/scope constraints
- [ ] Documented status/error contracts (400/401/403/404/409/422/429 as applicable)
- [ ] Marked compatibility as non-breaking or breaking
- [ ] Added migration notes for breaking changes
- [ ] Updated authorization policy/bindings when permissions changed

## Validation

- [ ] Ran skill frontend-api-doc-governance
- [ ] Ran skill contract-governance
- [ ] Ran prompt contract-governance-check.prompt.md
