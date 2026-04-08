---
name: module-contracts
description: "Use when designing or reviewing interactions between modules, API/event contracts, ownership boundaries, and compatibility strategy in CTO.ai"
---

# Skill: Module Contracts

## Goal
Design safe, independent interoperability across modules without shared mutable data.

## Use When
- A feature requires data from another module.
- A team asks to read/write another module's tables directly.
- You need to add or change REST/GraphQL endpoints used across modules.
- You need to add or change domain events.

## Workflow
1. Identify producer module and owner of truth.
2. Define interaction type:
   - API request/response
   - async event publication
3. Specify contract schema and version:
   - endpoint or event name
   - payload fields and required semantics
   - compatibility constraints
4. Define failure model:
   - retries, idempotency, dead-letter strategy
5. Add contract tests:
   - producer contract test
   - consumer contract test
6. Document migration path for existing consumers.

## Output Template
- Producer module:
- Consumer module(s):
- Contract type: API | Event
- Contract ID/version:
- Request/event schema:
- Response/ack semantics:
- Idempotency key:
- Error handling strategy:
- Backward compatibility notes:
- Required tests:

## Anti-Patterns
- Direct SQL reads across modules.
- Reusing internal DTOs as public contracts.
- Introducing breaking changes without new version.
