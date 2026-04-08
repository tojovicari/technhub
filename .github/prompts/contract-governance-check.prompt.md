---
mode: ask
description: "Validate API contracts, permissions, payload schemas, and docs consistency for a proposed change"
---

# Contract Governance Check

Evaluate this change proposal with strict contract governance.

Input:
{{input:feature_or_pr_change}}

Return exactly:
1. Contracts touched (API/event + version)
2. Permission and policy impact (`required_permissions`, tenant/scope rules)
3. Payload/schema deltas (added/removed/changed fields)
4. Compatibility assessment (non-breaking/breaking) and migration notes
5. Required tests (producer/consumer/auth)
6. Documentation updates required (`docs/openapi/*`, architecture, entities)
7. Final verdict: pass/fail with blocking items
