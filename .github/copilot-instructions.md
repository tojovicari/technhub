# Copilot Instructions - CTO.ai

## Project Focus
This project builds a modular platform for Tech Managers and CTOs.
Primary domains: integrations, core entities, SLAs, DORA metrics, COGS, and executive analytics.

## Architecture Guardrails
- Keep modules independent by design.
- Never couple modules via direct database access.
- Exchange data only through:
  - versioned API contracts (REST/GraphQL)
  - versioned event contracts (message bus)
- Each module owns its storage and schema.
- Breaking changes require version bump and migration plan.

## Contract-First Development
When implementing cross-module behavior:
1. Define or update the contract first.
2. Add contract tests for producer and consumer.
3. Implement adapters/transformers, not direct data coupling.
4. Document payload version and compatibility notes.

## Data Ownership Rules
- Integrations module owns raw provider data and sync state.
- Core domain module owns canonical entities.
- SLA module owns SLA rules, instances, and compliance.
- Metrics module owns derived analytics and time-series snapshots.
- COGS module owns cost calculations and financial rollups.

## AI Usage Expectations
- Prefer proposing incremental, phase-aligned changes.
- Preserve architectural boundaries in all code suggestions.
- If a request violates module boundaries, propose a contract-based alternative.
- For planning tasks, produce clear artifacts: assumptions, scope, risks, and acceptance criteria.

## Documentation Expectations
For architecture-impacting changes, update:
- docs/architecture.md
- docs/integrations.md (if integration boundaries/contracts changed)
- docs/entities.md (if domain contracts changed)
- docs/roadmap.md (if sequencing changed)
