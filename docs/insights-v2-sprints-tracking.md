# Acompanhamento de Sprints - Insights V2

Data de criacao: 2026-07-17
Status geral: em andamento
Owner sugerido: Tech Lead + Backend Lead + Data/Analytics Lead
Referencia principal: docs/insights-v2-flexible-analytics-plan.md
Referencias complementares:

1. docs/integrations-v2-refactor-plan.md
2. docs/insights-v2-data-foundation-schema.md

## 1. Objetivo deste documento

Centralizar o acompanhamento executivo e tecnico da implementacao da V2, mantendo historico de:

1. progresso por sprint,
2. mudancas de escopo,
3. decisoes arquiteturais,
4. riscos e mitigacoes,
5. evidencias de validacao.

Regra de uso:

1. cada sprint deve ser atualizada no fechamento com status e evidencias,
2. toda mudanca relevante deve ser registrada no historico de alteracoes,
3. toda decisao que impacta arquitetura, prazo ou escopo deve entrar no log de decisoes.

## 2. Convencoes de status

- nao_iniciado
- em_andamento
- bloqueado
- concluido

Semaforo sugerido:

- verde: no prazo, sem risco relevante
- amarelo: atencao, risco moderado
- vermelho: fora do plano, risco alto

## 3. Roadmap de sprints

## Sprint 1 - Fundacao de ingestao bruta (Semana 1)

Objetivo:

1. iniciar a refatoracao de Integracoes para persistencia bruta uniforme.

Escopo:

1. criar modelo inicial de RawObject, RawCheckpoint e RawIngestionRun,
2. adaptar webhook para persistir no raw store,
3. adaptar sync incremental para persistir no raw store,
4. deduplicacao por hash e external_id,
5. status de processamento bruto.

Status: concluido
Semaforo: verde

Checklist:

- [x] Migracoes de banco criadas e revisadas
- [x] Persistencia de webhook no raw store
- [x] Persistencia de sync incremental no raw store
- [x] Deduplicacao funcionando
- [x] Logs basicos de ingestao ativos
- [x] Testes minimos de persistencia e dedup
- [x] Curadoria package-first concluida para capacidades comuns de Integracoes

Criterio de pronto:

1. webhook e sync gravam no mesmo modelo bruto,
2. e possivel rastrear um objeto bruto por tenant, provider, entity_type e external_id.
3. dependencias base escolhidas com justificativa tecnica registrada.

Progresso atual:

1. schema Prisma atualizado com RawObject, RawCheckpoint e RawIngestionRun.
2. migration da Sprint 1 criada manualmente em modo offline por indisponibilidade de banco local.
3. webhook agora persiste payload bruto em RawObject com deduplicacao por payload_hash.
4. migration aplicada com banco local ativo e schema sincronizado.
5. sync de Jira, GitHub, incident.io e OpsGenie agora persiste lotes principais no RawObject antes da transformacao de dominio.
6. RawIngestionRun agora registra execucao de sync com status running/success/failed.
7. RawObject agora atualiza processingStatus para processed/failed no ciclo de sync.
8. testes minimos de persistencia e rastreabilidade executados com sucesso.
9. prisma generate e build TypeScript executados com sucesso apos as alteracoes.
10. pendente: iniciar a camada canônica da Sprint 2.
11. schema Prisma da Sprint 2 aplicado com migration canonical_fact_foundation.
12. dispatcher de canonizacao e testes minimos validados.

Backlog tecnico detalhado:

1. S1-T1 - Modelagem Prisma da camada raw
   - dono sugerido: backend lead
   - saida esperada: modelos RawObject, RawCheckpoint e RawIngestionRun no schema + migration
   - dependencia: nenhuma
   - status: concluido
2. S1-T2 - Persistencia de webhook no raw store
   - dono sugerido: backend
   - saida esperada: webhook route persiste payload bruto no modelo novo com deduplicacao
   - dependencia: S1-T1
   - status: concluido
3. S1-T3 - Persistencia de sync incremental no raw store
   - dono sugerido: backend
   - saida esperada: sync runner grava objetos brutos antes de qualquer transformacao
   - dependencia: S1-T1
   - status: concluido
4. S1-T4 - Dedupe e status de processamento
   - dono sugerido: backend
   - saida esperada: hash + chaves de dedupe + status queued/processed/failed
   - dependencia: S1-T2 e S1-T3
   - status: concluido
5. S1-T5 - Curadoria package-first
   - dono sugerido: backend lead + arquitetura
   - saida esperada: decisoes registradas no log para retry/fila/validacao/webhook security
   - dependencia: nenhuma
   - status: concluido
6. S1-T6 - Testes minimos e validacao de rastreabilidade
   - dono sugerido: backend + qa
   - saida esperada: evidencias de que webhook e sync convergem no mesmo modelo bruto
   - dependencia: S1-T2, S1-T3 e S1-T4
   - status: em_andamento

## Sprint 2 - Canonizacao inicial e lineage (Semana 2)

Objetivo:

1. introduzir fatos canonicos e trilha de lineage inicial.

Escopo:

1. criar CanonicalFact e CanonicalLineage,
2. criar dispatcher de canonizacao,
3. implementar primeiros transformadores: work_item, pull_request, incident,
4. registrar transform_version e warnings,
5. manter pipeline dual sem quebrar fluxo atual.

Status: concluido
Semaforo: verde

Checklist:

- [x] Tabelas canonicas criadas
- [x] Dispatcher de canonizacao funcional
- [x] Transformador work_item implementado
- [x] Transformador pull_request implementado
- [x] Transformador incident implementado
- [x] Lineage basico persistido

Criterio de pronto:

1. para cada fato canonico inicial, existe referencia rastreavel para origem bruta.

## Sprint 3 - Catalogo de campos e base para escopo (Semana 3)

Objetivo:

1. habilitar descoberta de campos observados para configuracao por squad.

Escopo:

1. catalogo de campos por provider e entity_type,
2. endpoint interno de consulta de campos observados,
3. agregacao de frequencia de valores,
4. validacao de cobertura de dados por provider.

Status: concluido
Semaforo: verde

Checklist:

- [x] Catalogo de campos derivado da camada canonica
- [x] API interna de consulta disponível
- [x] Estatisticas de frequencia implementadas
- [x] Evidencia de uso para Jira, GitHub e incidentes

Criterio de pronto:

1. equipe de produto consegue listar campos reais observados para montar regras.

## Sprint 4 - Escopo e classificacao por squad (Semana 4)

Objetivo:

1. iniciar camada semantica por squad.

Escopo:

1. criar entidades Squad, SquadScope e SquadClassifier,
2. implementar avaliacao de escopo,
3. implementar motor inicial de classificacao declarativa,
4. persistir ClassificationResult,
5. suporte a versao de classificador.

Status: concluido
Semaforo: verde

Checklist:

- [x] Entidades de squad criadas
- [x] Resolver de escopo implementado
- [x] Classificacao declarativa funcionando
- [x] Resultados de classificacao persistidos
- [x] Versionamento basico de classificador

Criterio de pronto:

1. um squad consegue classificar toil com regra declarativa propria.

## Sprint 5 - Formulas e materializacao inicial (Semana 5)

Objetivo:

1. habilitar calculo de metricas configuraveis e leitura materializada.

Escopo:

1. criar MetricFormula e MetricComputationRun,
2. implementar Formula Engine inicial,
3. materializar metricas em MaterializedInsight,
4. registrar explainability basica,
5. suportar recalculo por janela.

Status: em_andamento
Semaforo: verde

Checklist:

- [x] Entidades de formula e run criadas
- [x] Formula engine executando formulas basicas
- [x] Materializacao de metrica implementada
- [x] Explainability minima registrada
- [x] Recalculo por janela operacional

Progresso atual:

1. schema Prisma atualizado com MetricFormula, MetricComputationRun e MaterializedInsight.
2. migration da Sprint 5 criada para enums, tabelas, indices e foreign keys da camada de formulas/materializacao.
3. Formula Engine inicial implementada em servico dedicado com suporte a count, sum, average, ratio e difference.
4. materializacao por janela implementada com persistencia idempotente por formula e janela.
5. explainability basica registrada por metrica com componentes da formula e contagem de linhas de origem.
6. execucao de recalculo por janela implementada via materializeSquadMetrics(tenantId, squadId, windowStart, windowEnd).
7. testes unitarios da nova camada executados com sucesso.
8. build TypeScript da API executado com sucesso apos ajustes de tipagem.

Criterio de pronto:

1. ao menos 3 metricas customizadas funcionando por squad.

## Sprint 6 - APIs da plataforma V2 (Semana 6)

Objetivo:

1. expor contratos da V2 para configuracao, operacao e consumo.

Escopo:

1. CRUD de escopos, classificadores e formulas,
2. endpoints de simulacao,
3. endpoints de consulta materializada,
4. endpoint de explainability,
5. endpoint de disparo e status de reprocessamento,
6. alias temporario de compatibilidade para a rota antiga de sync.

Status: em_andamento
Semaforo: verde

Checklist:

- [x] APIs de configuracao publicadas
- [x] APIs de simulacao publicadas
- [x] APIs de consumo publicadas
- [x] APIs de reprocessamento publicadas
- [x] Alias temporario de rota antiga mantido
- [x] Contratos revisados

Progresso atual:

1. APIs de formulas por squad publicadas para listagem e criacao de draft.
2. endpoint de publicacao de formula por id disponibilizado com arquivamento da versao ativa anterior da mesma key.
3. endpoint de simulacao de formula implementado sem persistencia para validacao rapida de regras.
4. endpoint de consulta materializada por squad publicado com filtro por metric_key e janela.
5. endpoint de explainability por insight materializado publicado.
6. endpoint de disparo de recompute por squad e endpoint de status de run publicados.
7. registry de autorizacao atualizado com novos route bindings da camada de formulas/materializacao.
8. testes de rota de insights expandidos para cobrir os novos endpoints da Sprint 6.
9. testes focados e build TypeScript da API executados com sucesso.
10. APIs de configuracao por squad publicadas para scopes e classifiers (list/create/publish).
11. registry de autorizacao expandido para bindings de scopes e classifiers na camada de insights.
12. contratos HTTP de configuracao validados em testes de rotas com cenarios de leitura, criacao e publicacao.
13. hardening de contrato concluido para scopes/classifiers com cobertura negativa explicita de BAD_REQUEST, FORBIDDEN e NOT_FOUND.
14. especificacao OpenAPI de Insights atualizada com endpoints e schemas de scopes/classifiers para handoff do frontend em repositorio separado.
15. especificacao OpenAPI de Insights expandida para formulas/materialized/recompute por squad (list/create/publish/simulate/materialized/explainability/recompute/status) para fechamento do handoff de contrato.
16. checklist de validacao backend para frontend foi expandido com gate da Sprint 6 (contratos por squad + evidencias de teste/build) em docs/frontend/insights-backend-validation-gate-checklist.md.

Criterio de pronto:

1. consumidores conseguem operar a V2 via contratos publicados, com handoff para frontend em repositorio separado, sem dependencia manual de backend para cada ajuste.

Nota de escopo:

1. frontend e mantido em repositorio/time separado; este tracking cobre entrega backend, contratos e evidencias de validacao para handoff.

## Sprint 7 - UX operacional e governanca (Semana 7)

Objetivo:

1. melhorar governanca, rastreabilidade e experiencia de configuracao.

Escopo:

1. construtores visuais iniciais,
2. comparador de versoes,
3. trilha de auditoria operacional,
4. guardrails de publicacao,
5. dashboard de operacao do pipeline.

Status: nao_iniciado
Semaforo: verde

Checklist:

- [ ] Construtor de escopo disponivel
- [ ] Construtor de classificador disponivel
- [ ] Construtor de formula disponivel
- [ ] Auditoria operacional exibida
- [ ] Guardrails de publish ativos

Criterio de pronto:

1. squads configuram, publicam e auditam sem depender de alteracao de codigo.

## 4. Dependencias entre sprints

1. Sprint 2 depende da Sprint 1.
2. Sprint 3 depende da Sprint 1 e Sprint 2.
3. Sprint 4 depende da Sprint 2 e Sprint 3.
4. Sprint 5 depende da Sprint 4.
5. Sprint 6 depende da Sprint 5.
6. Sprint 7 depende da Sprint 6.

## 5. Log de decisoes arquiteturais

1. 2026-07-17
   - alteracao: Sprint 2 iniciada com canonizacao minima, lineage e pipeline dual raw + canonical
   - motivo: preservar a ingestao atual enquanto a base canonica entra em producao
   - autor: equipe do projeto

2. 2026-07-17

- alteracao: versionamento basico de SquadClassifier adicionado com incremento monotônico por squad e key
- motivo: concluir a Sprint 4 com suporte a multiplas versões de classificador
- autor: equipe do projeto

3. 2026-07-17
   - alteracao: foundation da Sprint 5 adicionada com modelos MetricFormula/MetricComputationRun/MaterializedInsight e Formula Engine inicial
   - motivo: habilitar calculo configuravel, materializacao e explainability basica por squad
   - autor: equipe do projeto

4. 2026-07-17

- alteracao: persistencia idempotente de ClassificationResult adicionada ao fluxo de classificacao
- motivo: fechar a etapa de persistencia dos resultados de classificacao da Sprint 4
- autor: equipe do projeto

2. 2026-07-17

- alteracao: kickoff da Sprint 4 com entidades de squad e resolvedor/classificador declarativo
- motivo: iniciar a camada semantica por squad com base reutilizavel para classificacao e escopo
- autor: equipe do projeto

2. 2026-07-17
   - alteracao: resumo de cobertura por provider adicionado ao catalogo de campos
   - motivo: registrar evidencia pratica de uso para Jira, GitHub e incidentes na Sprint 3
   - autor: equipe do projeto

3. 2026-07-17
   - alteracao: estatisticas de frequencia e cobertura adicionadas ao catalogo de campos
   - motivo: tornar o catalogo util para descoberta real de campos e priorizacao de escopo
   - autor: equipe do projeto

4. 2026-07-17
   - alteracao: APIs de formulas/materializacao por squad adicionadas (list/create/publish/simulate/materialized/explainability/recompute/status)
   - motivo: iniciar a Sprint 6 com contratos operacionais para consumo do frontend e operacao de recalculo
   - autor: equipe do projeto

## 6. Registro de progresso por sprint

Preencher ao final de cada sprint:

- sprint_id:
- status_final:
- semaforo_final:
- resumo_entregas:
- itens_nao_entregues:
- riscos_abertos:
- decisoes_tomadas:
- evidencias_tecnicas:
- proxima_sprint_confirmada:

## 7. Log de decisoes arquiteturais detalhado

Formato:

- data:
- decisao:
- contexto:
- impacto:
- tradeoff:
- responsavel:

Entradas:

1. 2026-07-17
   - decisao: adotar camada canonica comum com semantica por squad
   - contexto: squads com convencoes diferentes para conceitos como toil
   - impacto: reduz acoplamento ao provider e evita duplicacao da camada canonica
   - tradeoff: exige maior investimento inicial em canonizacao e lineage
   - responsavel: time de arquitetura

2. 2026-07-17
   - decisao: refatorar Integracoes antes de escopo/classificacao/formulas
   - contexto: sem persistencia bruta uniforme a V2 perde replay e auditabilidade
   - impacto: garante base consistente para crescimento da plataforma
   - tradeoff: aumenta trabalho de infra no inicio
   - responsavel: time de arquitetura + backend

3. 2026-07-17
   - decisao: adotar estrategia package-first em Integracoes
   - contexto: reduzir implementacao de infraestrutura generica do zero
   - impacto: acelera entrega e reduz custo de manutencao no medio prazo
   - tradeoff: exige governanca de dependencias e avaliacao de licencas
   - responsavel: backend lead + arquitetura

## 7. Historico de alteracoes do plano

Formato:

- data:
- alteracao:
- motivo:
- autor:

Entradas:

1. 2026-07-17
   - alteracao: criacao do documento de acompanhamento de sprints da V2
   - motivo: manter historico e evitar perda de contexto
   - autor: equipe do projeto

2. 2026-07-17
   - alteracao: catalogo de campos exposto em API interna com agregacao por provider, entity_type e fact_type
   - motivo: validar a base de descoberta de campos da Sprint 3 com dados canonicos existentes
   - autor: equipe do projeto

3. 2026-07-17
   - alteracao: kickoff da Sprint 1 com backlog tecnico detalhado
   - motivo: iniciar execucao com rastreabilidade de dono, dependencia e status
   - autor: equipe do projeto

4. 2026-07-17
   - alteracao: conclusao parcial da Sprint 1 (schema raw + webhook raw + build ok)
   - motivo: registrar progresso tecnico e pendencias de banco para continuidade
   - autor: equipe do projeto

5. 2026-07-17
   - alteracao: conclusao de S1-T3 com persistencia bruta no sync principal e validacao por build
   - motivo: manter rastreabilidade do avanço da Sprint 1
   - autor: equipe do projeto

6. 2026-07-17
   - alteracao: conclusao de S1-T4 com status operacional no RawObject e RawIngestionRun
   - motivo: registrar progresso funcional da camada raw com tratamento de sucesso e falha
   - autor: equipe do projeto

## 8. Riscos ativos

Formato:

- id:
- descricao:
- severidade:
- probabilidade:
- mitigacao:
- owner:
- status:

Itens iniciais:

1. R-001
   - descricao: Integracoes nao convergir webhook e sync no mesmo pipeline
   - severidade: alta
   - probabilidade: media
   - mitigacao: priorizar Sprint 1 e Sprint 2 com criterio de pronto estrito
   - owner: backend lead
   - status: aberto

2. R-002
   - descricao: custo de armazenamento bruto crescer acima do esperado
   - severidade: media
   - probabilidade: media
   - mitigacao: deduplicacao por hash, politica de retencao e compressao
   - owner: plataforma
   - status: aberto

3. R-003
   - descricao: formulas de alta complexidade degradarem performance
   - severidade: alta
   - probabilidade: media
   - mitigacao: limites de complexidade, materializacao e filas dedicadas
   - owner: analytics lead
   - status: aberto

4. R-004
   - descricao: excesso de implementacao do zero em Integracoes aumentar prazo e custo de manutencao
   - severidade: media
   - probabilidade: media
   - mitigacao: aplicar package-first com criterios objetivos e registro de excecoes
   - owner: backend lead
   - status: aberto

## 9. Proxima acao imediata

1. concluir S1-T1 com modelagem Prisma e migration da camada raw.
2. avançar para Sprint 2 com a camada canônica e lineage.
3. manter rastreabilidade da Sprint 1 como baseline de regressao.
