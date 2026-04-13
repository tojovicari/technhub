---
mode: ask
description: "Review a proposed feature for module-boundary safety and propose API/event contracts"
---

# Contract Review Prompt

Review this proposal under moasy.tech architecture constraints.

Input:
{{input:feature_or_change}}

Return:
1. Boundary violations detected (if any)
2. Proposed contract-first design (API and/or events)
3. Versioning and compatibility strategy
4. Test plan (contract tests + integration tests)
5. Migration notes
