# Handoff Frontend - Sprint 6 (Hardening e Fechamento)

Data de referencia: 2026-06-03
Status do contrato: implementado no backend
Escopo: frontend

## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: fechar estabilidade operacional, auditoria e performance da trilha Resource Group.
- Modulo alvo (unico): Hardening.
- Impacto esperado no frontend: baixo.
- Migracao de telas: sem mudanca visual obrigatoria.
- Risco principal de integracao: frontend assumir mudanca de payload onde nao houve mudanca de contrato.
- Acao esperada do frontend nesta sprint: validar fluxo fim a fim com contratos atuais e manter tratamento correto de erros/permissoes.

## Resumo Executivo

- Nao houve mudanca de contrato externo (rotas, params, payloads e permissoes permanecem compativeis).
- Houve fortalecimento de runtime no backend:
  - observabilidade padronizada por request (duracao e sinalizacao de lentidao);
  - trilha de auditoria para operacoes mutaveis;
  - otimizar caminhos de agregacao por Resource Group sem dados.
- Regressao integrada da trilha concluida com sucesso.

## Envelope de resposta

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.
- Campos de meta esperados: request_id, version, timestamp.

## Autenticacao e escopo

- Todas as rotas da trilha seguem exigindo autenticacao por Bearer JWT.
- Escopo de tenant segue aplicado a partir do token do usuario autenticado.
- Frontend nao deve enviar tenant_id em body/query.

## Contratos e permissoes (Sprint 6)

### 1) Compatibilidade de contrato

- Nenhuma rota nova publicada para frontend nesta sprint.
- Nenhum payload existente foi quebrado nesta sprint.
- Nenhuma permissao nova foi exigida para os fluxos existentes.

### 2) Rotas da trilha validadas em regressao

- Resource Groups
  - GET /api/v1/resource-groups
  - POST /api/v1/resource-groups
  - POST /api/v1/resource-groups/:group_id/resources
  - GET /api/v1/resource-groups/:group_id/metrics/summary
- SLA
  - POST /api/v1/sla/templates
  - PATCH /api/v1/sla/templates/:id
  - DELETE /api/v1/sla/templates/:id
  - GET /api/v1/sla/compliance
  - GET /api/v1/sla/resource-groups/:group_id/compliance
- DORA
  - POST /api/v1/dora/deploys
  - POST /api/v1/dora/lead-time
  - GET /api/v1/dora/scorecard
  - GET /api/v1/dora/resource-groups/:group_id/scorecard
  - GET /api/v1/dora/history/:metric_name
- COGS
  - POST /api/v1/cogs/entries
  - GET /api/v1/cogs/rollup
  - GET /api/v1/cogs/resource-groups/:group_id/rollup
  - POST /api/v1/cogs/budgets
  - GET /api/v1/cogs/burn-rate
  - POST /api/v1/cogs/initiatives/:project_id/generate
  - GET /api/v1/cogs/initiatives/:project_id/summary

## Entregas de Hardening no Backend

### 1) Observabilidade padronizada

- Logging padronizado de conclusao de request com:
  - method, path, status_code, duration_ms, tenant_id, user_id.
- Sinalizacao de request lenta por threshold configuravel:
  - env: SLOW_REQUEST_THRESHOLD_MS (default 500ms).

### 2) Auditoria operacional

- Eventos de auditoria adicionados para operacoes mutaveis em:
  - Resource Group
  - SLA templates
  - DORA ingest (deploy e lead time)
  - COGS (entries, budgets, generation)
- Objetivo: rastreabilidade de ator, acao e contexto de alteracao.

### 3) Performance e consistencia de agregacao

- Early return para agregacoes por Resource Group sem vinculos (evita consultas desnecessarias).
- Ajuste no rollup de COGS por grupo para considerar tanto vinculos por projeto quanto por time.

## Regras de UX (mantidas)

- Sempre exibir estado sem permissao para 403.
- Nao mascarar erro de permissao como estado vazio.
- Tratar campos metricos nulos como sem dados suficientes, nunca como zero implicito.
- Manter exibicao de periodo/filtros aplicados quando retornados pelo contrato.

## Checklist de implementacao frontend (Sprint 6)

1. Revalidar fluxos das telas de Resource Group, SLA, DORA e COGS sem alterar adapters de contrato.
2. Confirmar que estados 401/403/404 continuam mapeados corretamente em cada tela.
3. Confirmar que componentes nao assumem mudanca de payload nesta sprint.
4. Validar regressao de navegacao e filtros com os contratos atuais.
5. Opcional: incluir no monitoramento frontend correlacao por request_id para troubleshooting.

## Evidencias de validacao tecnica

- Regressao integrada executada:
  - 4 arquivos de teste
  - 76 testes
  - 0 falhas
- Build TypeScript da API:
  - status: aprovado

## Criterios de aceite (Sprint 6)

- Trilha Resource Group + SLA + DORA + COGS validada sem regressao de contrato.
- Telemetria e auditoria ativas para operacoes criticas da trilha.
- Agregadores por Resource Group estaveis e com comportamento previsivel para grupos vazios.

## Referencias

- docs/resource-group-replan.md
- docs/frontend/sprint-4-dora-resource-group-handoff.md
- docs/frontend/sprint-5-cogs-resource-group-handoff.md
- docs/frontend/cogs-api.md
- docs/frontend/dora-api.md
- docs/frontend/sla-api.md
