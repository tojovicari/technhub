---
applyTo: "**"
description: "Use when planning, implementing, or reviewing features in moasy.tech; provides domain context, priorities, and architectural constraints"
---

# Project Context

## Product Intent
moasy.tech centralizes operational and strategic engineering data for technical leadership.
Audience: CTOs, Tech Managers, Staff+ engineers, and finance partners.

## Priority Outcomes
- Unified visibility of delivery, reliability, and cost.
- Trustworthy DORA and health metrics.
- Actionable SLA compliance monitoring.
- Cost transparency via COGS at task/epic/project levels.

## Non-Negotiables
- Modular independence and contract-first integration.
- No direct module-to-module data mutation.
- Auditable calculations for metrics and costs.
- Role-based access to sensitive financial data.

## Phase Lens
- Phase 1: integration reliability and canonical entities.
- Phase 2: DORA + SLA + operational health.
- Phase 3: COGS and financial observability.
- Phase 4: forecasting, anomaly detection, recommendations.

## Decision Heuristics
- Prefer simple, testable contracts over shared schema shortcuts.
- Prefer asynchronous processing for heavy analytics.
- Favor explainability for executive metrics over opaque formulas.
- Treat data lineage as first-class: source -> transform -> metric.
