# Checklist de Validacao Backend - Insights por Resource Group e Squad

Data de criacao: 2026-06-05
Status: aprovado para frontend e rollout
Owner sugerido: Backend + API Governance + Frontend Lead

## Objetivo

Padronizar o gate de liberacao backend por sprint para o modulo de Insights por Resource Group e Squad.

Nota de escopo:

1. O frontend e mantido em repositorio/time separado.
2. Este documento cobre validacao backend, contrato OpenAPI e handoff para consumo no frontend.

Regra principal:

1. Sprint N so libera frontend quando o checklist da Sprint N estiver aprovado.
2. Sprint N+1 so inicia quando a Sprint N estiver aprovada e corrigida.

## Evidencias obrigatorias por sprint

Preencher em cada sprint:

- commit_revisado: b6e1e54
- openapi_revisado: docs/openapi/insights-v1.yaml@1.0.0
- ambiente_validacao: local (apps/api)
- request_ids_amostra: req-g, req-j, req-m
- data_revisao: 2026-06-05
- revisores: backend, api-governance

---

## Sprint A - Gate de Liberacao

Escopo esperado:

1. GET /api/v1/insights/resource-groups/:group_id/overview
2. GET /api/v1/insights/resource-groups/:group_id/incidents
3. Permissao insights.read

Checklist:

- [x] Contrato de rota confere com implementacao real.
- [x] Path/query params batem com o handoff.
- [x] Payload 200 real confere com campos documentados.
- [x] Erros 400/401/403/404 validados.
- [x] Tenant scoping confirmado (sem tenant_id vindo do cliente).
- [x] Metricas nulas exibem warning, nao falso zero.
- [x] Testes de contrato passando para as duas rotas.
- [x] OpenAPI atualizado e versionado.
- [x] Handoff da Sprint A atualizado com payload real.

Decisao:

- [x] Aprovado para frontend
- [ ] Reprovado (com correcoes)

Correcao obrigatoria se reprovado:

- lista_de_divergencias:
- plano_de_correcao:
- novo_commit_validado:
- nova_data_validacao:

---

## Sprint B - Gate de Liberacao

Pre-condicao:

- [x] Sprint A aprovada e sem pendencias abertas.

Escopo esperado:

1. GET /api/v1/insights/resource-groups/:group_id/planning-confidence
2. GET /api/v1/insights/resource-groups/:group_id/backlog-quality
3. Permissao insights.read

Checklist:

- [x] Contrato de rota confere com implementacao real.
- [x] Campos de planning_confidence e roadmap_confidence presentes.
- [x] Campos de backlog_quality presentes com warnings quando proxy.
- [x] Sem inferencia de historico inexistente (proxy sinalizado).
- [x] Erros 400/401/403/404 validados.
- [x] Testes de contrato passando para as rotas da sprint.
- [x] OpenAPI atualizado e versionado.
- [x] Handoff da Sprint B atualizado com payload real.

Decisao:

- [x] Aprovado para frontend
- [ ] Reprovado (com correcoes)

Correcao obrigatoria se reprovado:

- lista_de_divergencias:
- plano_de_correcao:
- novo_commit_validado:
- nova_data_validacao:

---

## Sprint C - Gate de Liberacao

Pre-condicao:

- [x] Sprint B aprovada e sem pendencias abertas.

Escopo esperado:

1. GET /api/v1/insights/resource-groups/:group_id/trends
2. POST /api/v1/insights/resource-groups/:group_id/recompute
3. Overview com freshness e data quality warnings
4. Permissoes insights.read e insights.recompute

Checklist:

- [x] Contrato de trends confere com implementacao real.
- [x] Contrato de recompute confere com implementacao real.
- [x] Fluxo 202 (queued) e 409 (conflito) validado.
- [x] Freshness e data_quality_warnings expostos no overview.
- [x] Erros 400/401/403/404/409 validados.
- [x] Testes de contrato passando para as rotas da sprint.
- [x] OpenAPI atualizado e versionado.
- [x] Handoff da Sprint C atualizado com payload real.

Decisao:

- [x] Aprovado para frontend
- [ ] Reprovado (com correcoes)

Correcao obrigatoria se reprovado:

- lista_de_divergencias:
- plano_de_correcao:
- novo_commit_validado:
- nova_data_validacao:

---

## Sprint 6 - Gate de Liberacao (Contratos por Squad)

Pre-condicao:

- [x] Sprint C aprovada e sem pendencias abertas.

Escopo esperado:

1. GET /api/v1/insights/squads/:squad_id/scopes
2. POST /api/v1/insights/squads/:squad_id/scopes
3. POST /api/v1/insights/squads/:squad_id/scopes/:scope_id/publish
4. GET /api/v1/insights/squads/:squad_id/classifiers
5. POST /api/v1/insights/squads/:squad_id/classifiers
6. POST /api/v1/insights/squads/:squad_id/classifiers/:classifier_id/publish
7. GET /api/v1/insights/squads/:squad_id/formulas
8. POST /api/v1/insights/squads/:squad_id/formulas
9. POST /api/v1/insights/squads/:squad_id/formulas/:formula_id/publish
10. POST /api/v1/insights/squads/:squad_id/formulas/simulate
11. GET /api/v1/insights/squads/:squad_id/materialized
12. GET /api/v1/insights/squads/:squad_id/materialized/:insight_id/explainability
13. POST /api/v1/insights/squads/:squad_id/recompute
14. GET /api/v1/insights/squads/:squad_id/recompute/:run_id
15. Permissoes insights.policy.read/write/publish, insights.read e insights.recompute

Checklist:

- [x] Contratos de scopes/classifiers conferem com implementacao real.
- [x] Contratos de formulas/materialized/recompute por squad conferem com implementacao real.
- [x] Validacoes de params/query/body alinhadas com schemas (UUID, limites e enums).
- [x] Erros 400/403/404 cobertos em testes de contrato para rotas de configuracao (scopes/classifiers).
- [x] Fluxos de sucesso 200/201/202 cobertos para configuracao e operacao por squad.
- [x] Tenant scoping confirmado no backend sem tenant_id vindo do cliente.
- [x] Route bindings de autorizacao atualizados para os novos endpoints por squad.
- [x] OpenAPI atualizado com endpoints e schemas de squad (scopes/classifiers/formulas/materialized/recompute).
- [x] Evidencia de teste e build backend registrada (vitest + tsc).

Evidencias desta sprint:

- commit_revisado: n/a (workspace local)
- openapi_revisado: docs/openapi/insights-v1.yaml@1.0.0
- ambiente_validacao: local (apps/api)
- resultado_testes: 59 testes passando (insights routes + services)
- resultado_build: tsc -p tsconfig.json sem erros

Decisao:

- [x] Aprovado para frontend
- [ ] Reprovado (com correcoes)

Correcao obrigatoria se reprovado:

- lista_de_divergencias:
- plano_de_correcao:
- novo_commit_validado:
- nova_data_validacao:

---

## Criterio final de encerramento do modulo

- [x] Sprint A aprovada
- [x] Sprint B aprovada
- [x] Sprint C aprovada
- [x] Sprint 6 aprovada
- [x] Sem divergencia aberta entre handoff e implementacao
- [x] Frontend validou parsing de payload real em todas as rotas

Status final:

- [x] Pronto para rollout
- [ ] Bloqueado para rollout

Bloqueios finais:

- bloqueios: nenhum
- owner_do_bloqueio: n/a
- eta_remocao: n/a
