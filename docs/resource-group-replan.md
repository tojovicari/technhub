# Replanejamento: Recursos e Grupos de Recursos

## Contexto

Hoje a camada chamada de Iniciativas concentra dois conceitos diferentes:

- Vínculo de fontes externas (Jira, GitHub, incidentes)
- Leitura executiva de métricas consolidadas

Isso gera ambiguidade de produto e de contrato. A proposta separa esses conceitos em dois módulos explícitos:

- Recursos: unidade de ingestão e rastreabilidade
- Grupos de Recursos: unidade de consolidação de métricas e decisão executiva

## Objetivos

- Renomear o conceito atual de Iniciativas para Recursos na experiência de frontend.
- Criar um novo agregador de negócio chamado Grupo de Recursos.
- Replanejar SLA, COGS e DORA para consolidarem métricas por Grupo de Recursos.
- Suportar vínculo de múltiplos times por grupo (N:N), incluindo casos de produtos grandes e monolitos.
- Permitir decisão de proporção de contribuição por recurso no grupo.

## Header de Contexto para Frontend

Usar este header no início de todo pacote de mudanças enviado ao frontend em cada sprint.

Template sugerido:

```markdown
## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: [preencher objetivo do módulo da sprint].
- Módulo alvo (único): [Recursos | SLA | DORA | COGS | Hardening].
- Status de contrato: [draft | aprovado | implementado].
- Impacto esperado no frontend: [baixo | médio | alto].
- Migração de telas: [sem mudança visual | ajuste de nomenclatura | nova UX].
- Risco principal de integração: [preencher].
- Ação esperada do frontend nesta sprint: [preencher lista curta].
```

Regra de uso:

- Sempre enviar o header acima antes da lista de modificações da sprint.
- Como o plano é sequencial por módulo, o campo Módulo alvo deve ter exatamente um valor por sprint.

## Pacote Frontend - Sprint 1 e 2 (Início)

- Prazo planejado: Sprint 1 e Sprint 2 (2 ciclos).
- Responsável frontend: definir owner da squad antes do kickoff técnico.

## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: separar semanticamente Recursos de agregação executiva e preparar a base de navegação e leitura para Resource Group.
- Módulo alvo (único): Recursos.
- Status de contrato: draft para validação cruzada backend/frontend.
- Impacto esperado no frontend: alto.
- Migração de telas: ajuste de nomenclatura + nova UX para entrada de Resource Group.
- Risco principal de integração: frontend continuar assumindo que vínculo de recurso já representa consolidação de métricas.
- Ação esperada do frontend nesta sprint: atualizar navegação, contratos de leitura e fluxos de criação/vínculo.

### Bloqueadores Esperados

- Contrato do módulo Resource Group ainda em status draft e sujeito a ajuste fino na validação cruzada.
- Dependência de confirmação final dos payloads de CRUD e vínculo (resources e teams) antes do merge final do frontend.
- Dependência de definição do identificador estável para exibição e busca (key vs id) nos fluxos novos.

### Contratos e Permissões para Frontend (Sprint 1 e 2)

Observação de linguagem:

- Para esta sprint, tratar integração como contrato versionado de backend + permissões de acesso.
- Evitar comunicação como "tem API" sem citar contrato e regra de autorização.

Formato padrão de resposta (envelope):

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.
- Campos de meta esperados: request_id, version, timestamp.

Autenticação e escopo:

- Todas as rotas exigem autenticação.
- Escopo de tenant é aplicado a partir do token do usuário autenticado.
- Frontend não deve enviar tenant_id em body para este módulo.

Matriz de contratos de API e permissões (Sprint 1 e 2):

1. Criar Resource Group
   - Método e rota: POST /api/v1/resource-groups
   - Permissão: resource_group.manage
   - Body:
     - key: string, 2-64, regex ^[a-z0-9][a-z0-9-]\*$
     - name: string, 1-120
     - description: string até 500, opcional, aceita nulo
     - status: planning | active | on_hold | done, opcional (default planning)
     - owner_user_id: uuid, opcional, aceita nulo
     - tags: string[], opcional (default [])
   - Resposta de sucesso: 201 com objeto completo do grupo
   - Erros principais: 400 body inválido, 401 não autenticado, 403 sem permissão

2. Listar Resource Groups
   - Método e rota: GET /api/v1/resource-groups
   - Permissão: resource_group.read
   - Query:
     - limit: inteiro 1-100, opcional (default 25)
     - cursor: uuid, opcional
     - status: planning | active | on_hold | done, opcional
   - Resposta de sucesso: 200 com data.items e data.next_cursor
   - Erros principais: 400 query inválida, 401 não autenticado, 403 sem permissão

3. Detalhar Resource Group
   - Método e rota: GET /api/v1/resource-groups/:group_id
   - Permissão: resource_group.read
   - Params:
     - group_id: uuid
   - Resposta de sucesso: 200 com grupo + recursos vinculados + times vinculados
   - Erros principais: 400 param inválido, 404 grupo não encontrado, 401 não autenticado, 403 sem permissão

4. Editar Resource Group
   - Método e rota: PATCH /api/v1/resource-groups/:group_id
   - Permissão: resource_group.manage
   - Params:
     - group_id: uuid
   - Body parcial:
     - key, name, description, status, owner_user_id, tags
   - Resposta de sucesso: 200 com grupo atualizado
   - Erros principais: 400 body/param inválido, 404 grupo não encontrado, 401 não autenticado, 403 sem permissão

5. Vincular recurso ao grupo
   - Método e rota: POST /api/v1/resource-groups/:group_id/resources
   - Permissão: resource_group.manage
   - Params:
     - group_id: uuid
   - Body:
     - project_id: uuid
     - role: primary | supporting | shared, opcional (default shared)
     - weight_mode: auto | manual, opcional (default auto)
     - manual_weight: number de 0 a 1, opcional e nulo permitido
   - Regra de validação:
     - se weight_mode for manual, manual_weight passa a ser obrigatório
   - Resposta de sucesso: 200 com vínculo criado/atualizado
   - Erros principais: 400 body/param inválido, 404 grupo não encontrado, 404 recurso não encontrado, 401 não autenticado, 403 sem permissão

6. Remover vínculo de recurso
   - Método e rota: DELETE /api/v1/resource-groups/:group_id/resources/:project_id
   - Permissão: resource_group.manage
   - Params:
     - group_id: uuid
     - project_id: uuid
   - Resposta de sucesso: 204 sem body
   - Erros principais: 400 param inválido, 404 vínculo não encontrado, 401 não autenticado, 403 sem permissão

7. Vincular time ao grupo
   - Método e rota: POST /api/v1/resource-groups/:group_id/teams
   - Permissão: resource_group.manage
   - Params:
     - group_id: uuid
   - Body:
     - team_id: uuid
     - role: owner | contributor | platform, opcional (default contributor)
     - allocation_percent: number de 0 a 100, opcional e nulo permitido
   - Resposta de sucesso: 200 com vínculo criado/atualizado
   - Erros principais: 400 body/param inválido, 404 grupo não encontrado, 404 time não encontrado, 401 não autenticado, 403 sem permissão

8. Remover vínculo de time
   - Método e rota: DELETE /api/v1/resource-groups/:group_id/teams/:team_id
   - Permissão: resource_group.manage
   - Params:
     - group_id: uuid
     - team_id: uuid
   - Resposta de sucesso: 204 sem body
   - Erros principais: 400 param inválido, 404 vínculo não encontrado, 401 não autenticado, 403 sem permissão

9. Ler summary de métricas do grupo
   - Método e rota: GET /api/v1/resource-groups/:group_id/metrics/summary
   - Permissão: resource_group.metrics.read
   - Params:
     - group_id: uuid
   - Resposta de sucesso: 200 com:
     - resource_group_id
     - resources_count
     - teams_count
     - providers_breakdown
     - weight_mode_breakdown
     - manual_overrides_count
     - generated_at
   - Erros principais: 400 param inválido, 404 grupo não encontrado, 401 não autenticado, 403 sem permissão

Mapeamento de permissões por papel padrão:

- manager: resource_group.read, resource_group.manage, resource_group.metrics.read
- viewer: resource_group.read, resource_group.metrics.read
- org_admin: acesso total

Regra de UX para erro de autorização:

- Sempre exibir estado sem permissão quando o contrato retornar 403.
- Não mascarar erro de permissão como lista vazia.
- Manter mensagens de ação orientadas à solicitação de acesso.

### Lista de Modificações para Frontend

1. Renomear a camada de Iniciativas para Recursos em navegação, títulos, breadcrumbs, tabs e textos auxiliares.
2. Manter a tela de Recursos focada em vínculo técnico e rastreabilidade, sem exibir promessa de métricas consolidadas.
3. Criar entrada de navegação para Resource Groups como novo objeto executivo.
4. Criar fluxo de listagem de Resource Groups com estados vazios e CTA de criação.
5. Criar fluxo de criação/edição de Resource Group com campos: key, name, description, status e tags.
6. Criar fluxo de vínculo de Recursos ao Resource Group (multi-seleção e remoção).
7. Criar fluxo de vínculo de Times ao Resource Group com suporte N:N e role no vínculo.
8. Preparar UI para proporção por recurso com modo automático e ajuste manual (placeholder visual nesta sprint, sem cálculo final obrigatório).
9. Ajustar tipagens e adapters de API para separar claramente Resource (entidade técnica) e Resource Group (entidade executiva).
10. Incluir banners de contexto nas telas novas: Recursos = operação técnica, Resource Group = consolidação gerencial.
11. Implementar feature flag para habilitar Resource Group sem bloquear a evolução incremental da interface.
12. Adicionar telemetria mínima de UX: criação de grupo, vínculo de recurso, vínculo de time e tentativa de ajuste manual de proporção.

### Critérios de Aceite para Frontend (Sprint 1 e 2)

- Terminologia de Iniciativas não aparece mais nas áreas migradas.
- Fluxo completo de Resource Group (listar, criar, editar, vincular recurso, vincular time) funcionando com contratos da sprint.
- Sem acoplamento de UI que interprete vínculo de recurso como métrica consolidada.
- Tipos e componentes preparados para evolução nas sprints de SLA, DORA e COGS sem quebra estrutural.

## Pacote Frontend - Sprint 3 (SLA)

- Prazo planejado: Sprint 3 (1 ciclo).
- Responsável frontend: mesmo owner da trilha de Resource Group.

## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: habilitar leitura de SLA consolidado por Resource Group e seus estados de risco/compliance.
- Módulo alvo (único): SLA.
- Status de contrato: draft para validação cruzada backend/frontend.
- Impacto esperado no frontend: médio.
- Migração de telas: nova UX de SLA no contexto de Resource Group.
- Risco principal de integração: frontend continuar lendo SLA por projeto técnico sem considerar o escopo de grupo.
- Ação esperada do frontend nesta sprint: adaptar consultas, componentes de compliance e alertas para o contexto de Resource Group.

### Bloqueadores Esperados

- Definição final do payload de snapshot SLA por Resource Group.
- Definição final dos campos de status de risco e violação para exibição consistente.
- Alinhamento do comportamento de fallback quando não houver dados suficientes no período.

### Lista de Modificações para Frontend

1. Adicionar leitura de SLA por Resource Group nas telas executivas.
2. Atualizar cards de compliance para usar escopo de grupo em vez de projeto técnico.
3. Exibir indicadores de at_risk e breached no nível de Resource Group.
4. Exibir período de referência do snapshot SLA na UI.
5. Ajustar tabelas/listagens para incluir origem dos dados por recurso quando necessário.
6. Atualizar filtros para suportar seleção por Resource Group e período.
7. Implementar estados de loading, vazio e indisponível para snapshots SLA.
8. Atualizar tooltips e textos de ajuda explicando cálculo de compliance por conjunto de recursos.
9. Atualizar tipagens e adapters para novo payload de SLA consolidado.
10. Incluir telemetria de UX para acesso ao painel SLA por Resource Group e interação com filtros.

### Critérios de Aceite para Frontend (Sprint 3)

- Painéis de SLA exibem dados por Resource Group sem dependência de visão por projeto isolado.
- Estados de risco e violação aparecem com consistência em cards, listas e detalhes.
- Filtros por grupo e período funcionam sem quebra de navegação.
- Fallback de dados insuficientes é exibido de forma explícita para o usuário.

## Pacote Frontend - Sprint 4 (DORA)

- Prazo planejado: Sprint 4 (1 ciclo).
- Responsável frontend: mesmo owner da trilha de Resource Group.

## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: habilitar leitura de DORA consolidado por Resource Group com scorecard no escopo do grupo.
- Módulo alvo (único): DORA.
- Status de contrato: implementado.
- Impacto esperado no frontend: médio.
- Migração de telas: nova UX de DORA no contexto de Resource Group.
- Risco principal de integração: frontend continuar usando scorecard por projeto isolado na visão executiva.
- Ação esperada do frontend nesta sprint: adaptar consultas, cards e filtros para scorecard por Resource Group.

### Bloqueadores Esperados

- Alinhar no frontend o tratamento de métricas nulas (sem dados) para não renderizar zero incorreto.
- Garantir consistência visual entre scorecard global e scorecard por grupo durante transição de telas.

### Contratos e Permissões para Frontend (Sprint 4)

Observação de linguagem:

- Para esta sprint, tratar integração como contrato versionado de backend + permissões de acesso.
- Evitar comunicação como "tem API" sem citar contrato e regra de autorização.

Formato padrão de resposta (envelope):

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.
- Campos de meta esperados: request_id, version, timestamp.

Autenticação e escopo:

- Todas as rotas exigem autenticação.
- Escopo de tenant é aplicado a partir do token do usuário autenticado.
- Frontend não deve enviar tenant_id em body para este módulo.

Matriz de contratos de API e permissões (Sprint 4):

1. Ler scorecard DORA por Resource Group
   - Método e rota: GET /api/v1/dora/resource-groups/:group_id/scorecard
   - Permissão: dora.read
   - Params:
     - group_id: uuid
   - Query:
     - window_days: inteiro 1-365, opcional (default 30)
     - environment: string, opcional (default production)
   - Resposta de sucesso: 200 com:
     - resource_group: id, key, name, project_count
     - window_days, window_start, window_end
     - overall_level
     - deployment_frequency
     - lead_time
     - mttr
     - mtta
     - incident_frequency
     - change_failure_rate
   - Erros principais: 400 param/query inválido, 404 grupo não encontrado, 401 não autenticado, 403 sem permissão

2. Ler scorecard DORA geral (compatível e ainda válido)
   - Método e rota: GET /api/v1/dora/scorecard
   - Permissão: dora.read
   - Query:
     - project_id: uuid, opcional
     - window_days: inteiro 1-365, opcional (default 30)
     - environment: string, opcional (default production)
   - Resposta de sucesso: 200 com scorecard no escopo solicitado
   - Erros principais: 400 query inválida, 401 não autenticado, 403 sem permissão

Exemplo de request para rota de grupo:

- GET /api/v1/dora/resource-groups/b2b2a93a-4156-4e60-9e5f-08f7b4f59dc0/scorecard?window_days=30&environment=production

Mapeamento de permissões por papel padrão:

- manager: dora.read
- viewer: dora.read
- org_admin: acesso total

Regra de UX para erro de autorização:

- Sempre exibir estado sem permissão quando o contrato retornar 403.
- Não mascarar erro de permissão como lista vazia.
- Manter mensagens de ação orientadas à solicitação de acesso.

Regras de UX para dados de DORA:

- Exibir métricas nulas como "sem dados suficientes" (não exibir zero).
- Exibir nível geral com fallback textual quando overall_level não puder ser calculado.
- Exibir período do scorecard sempre (window_start e window_end).

### Lista de Modificações para Frontend

1. Adicionar leitura de DORA por Resource Group nas telas executivas.
2. Atualizar cards de DORA para usar escopo de grupo em vez de projeto técnico.
3. Exibir DF, LT, MTTR e CFR no nível de Resource Group com nível consolidado.
4. Exibir período de referência do scorecard na UI.
5. Atualizar filtros para suportar seleção por Resource Group, window_days e environment.
6. Implementar estados de loading, vazio e indisponível para scorecard de DORA por grupo.
7. Atualizar tooltips e textos de ajuda explicando consolidação por conjunto de recursos.
8. Atualizar tipagens e adapters para payload de scorecard por Resource Group.
9. Incluir telemetria de UX para acesso ao painel DORA por Resource Group e interação com filtros.

### Critérios de Aceite para Frontend (Sprint 4)

- Painéis de DORA exibem scorecard por Resource Group sem dependência de visão por projeto isolado.
- Níveis e métricas de DORA aparecem com consistência em cards e detalhes.
- Filtros por grupo, janela e ambiente funcionam sem quebra de navegação.
- Fallback de dados insuficientes é exibido de forma explícita para o usuário.

## Princípios de Arquitetura

- Independência modular e integração por contrato versionado.
- Sem acesso cross-module ao storage interno de outro módulo.
- Cálculo pesado assíncrono com snapshots auditáveis.
- Data lineage obrigatório: fonte externa -> recurso -> grupo -> métrica.
- Priorizar clareza de modelo sobre retrocompatibilidade, pois o sistema ainda não está em produção.

## Modelo Alvo

### Módulo 1: Recursos

Responsabilidade:

- Registrar e manter entidades técnicas de origem externa.
- Guardar metadados de rastreabilidade por provider.
- Expor contexto técnico do recurso para telas operacionais.

Exemplos de recurso:

- Repositório GitHub
- Projeto Jira
- Serviço de incidentes

Observação:

- O conceito atual de Project e ProjectSource permanece como base inicial.
- A camada de UX passa a tratar esse conjunto como Recursos.

### Módulo 2: Grupos de Recursos

Responsabilidade:

- Agregar N recursos em uma visão executiva única.
- Consolidar métricas de SLA, DORA e COGS por período.
- Servir dashboards e scorecards com leitura de negócio.

Exemplos de grupo:

- Produto Conta Digital
- Plataforma Core
- Domínio Sinistros

## Entidades Novas e Relacionamentos

### ResourceGroup

Campos propostos:

- id
- tenant_id
- key (slug único por tenant)
- name
- description
- status (planning, active, on_hold, done)
- owner_user_id opcional
- tags
- created_at
- updated_at

### ResourceGroupResource

Associação N:N entre grupo e recurso:

- id
- tenant_id
- resource_group_id
- project_id (referência inicial ao projeto técnico já existente)
- role opcional (primary, supporting, shared)
- weight opcional (0.0-1.0 para distribuição de contribuição)
- created_at

Unique sugerida:

- resource_group_id + project_id

### ResourceGroupTeam

Associação N:N entre grupo e time:

- id
- tenant_id
- resource_group_id
- team_id
- role opcional (owner, contributor, platform)
- allocation_percent opcional
- created_at

Unique sugerida:

- resource_group_id + team_id

### ResourceGroupMetricSnapshot

Snapshot consolidado por grupo e período:

- id
- tenant_id
- resource_group_id
- period_key (exemplo: 2026-06 ou 2026-Q2)
- metric_type (dora, sla, cogs, health)
- payload (jsonb)
- lineage (jsonb com lista de recursos/fontes considerados)
- computed_at
- version

## Contratos Propostos (v1.1 incremental)

### Recursos

- Manter endpoints atuais de core para reduzir risco.
- Ajustar naming no frontend para Recursos sem mudar payload inicialmente.
- Adicionar contexto opcional de grupo em respostas de detalhe quando houver associação.

### Grupos de Recursos

Novas rotas propostas:

- POST /api/v1/resource-groups
- GET /api/v1/resource-groups
- GET /api/v1/resource-groups/:group_id
- PATCH /api/v1/resource-groups/:group_id
- POST /api/v1/resource-groups/:group_id/resources
- DELETE /api/v1/resource-groups/:group_id/resources/:project_id
- POST /api/v1/resource-groups/:group_id/teams
- DELETE /api/v1/resource-groups/:group_id/teams/:team_id
- GET /api/v1/resource-groups/:group_id/metrics/summary
- GET /api/v1/resource-groups/:group_id/metrics/timeseries
- POST /api/v1/resource-groups/:group_id/recompute

Permissões sugeridas:

- resource_group.read
- resource_group.manage
- resource_group.metrics.read
- resource_group.metrics.recompute

## Replanejamento por Módulo Analítico

### SLA

Estado atual:

- Regras e compliance focados em task, projeto e template.

Evolução:

- SLA passa a publicar snapshot consolidado por resource_group_id.
- Compliance do grupo considera união de tarefas dos recursos associados.
- Alertas de risco e breach passam a suportar escopo de grupo.

Regras de consolidação:

- Numerador: tasks no prazo no conjunto de recursos do grupo.
- Denominador: tasks elegíveis com SLA no mesmo conjunto e período.

### DORA

Estado atual:

- Métricas por projeto/time com base em eventos de deploy, PR e incidentes.

Evolução:

- DORA consolidado por grupo com agregação por recursos vinculados.
- MTTR e CFR passam a incluir incidentes correlacionados aos recursos do grupo.
- Scorecard final do grupo é derivado de snapshots por janela temporal.

Regras de consolidação:

- DF: soma de deploys do conjunto / janela.
- LT: percentis calculados sobre PRs do conjunto.
- MTTR: percentis sobre incidentes do conjunto.
- CFR: falhas / deploys do conjunto.

### COGS

Estado atual:

- Derivação e rollup por task, épico e projeto.

Evolução:

- Criar rollup oficial por resource_group_id.
- Custo consolidado inclui entradas derivadas e manuais dos recursos associados.
- Burn rate e planned vs actual passam a suportar visão por grupo.

Regras de consolidação:

- Soma de total_cost das entries do conjunto.
- Breakdown por categoria e por recurso.
- Visão de desperdício (cancelled_task) também no nível de grupo.

## Vínculo de Times (N:N)

Decisão:

- Um grupo pode ter múltiplos times.
- Um time pode participar de múltiplos grupos.

Motivação:

- Produtos grandes com squads especializados.
- Monolitos com ownership compartilhado.
- Times de plataforma como contribuidores transversais.

Diretrizes:

- Sempre registrar role do vínculo (owner, contributor, platform).
- Permitir allocation_percent para rateio opcional de capacidade/custo.
- Não obrigar soma de allocation_percent em 100 no primeiro release.

## Compatibilidade e Migração

### Fase 0: Preparação

- Congelar novos acoplamentos no conceito antigo de Iniciativa.
- Publicar documento de contrato v1.1 já no modelo novo (sem compromisso de compatibilidade legada).

### Fase 1: Naming de Frontend

- Renomear Iniciativas para Recursos na navegação e telas.
- Ajustar chamadas para o novo contrato de forma direta, sem camada de compatibilidade.

### Fase 2: Novo Módulo de Grupos

- Introduzir tabelas de ResourceGroup, ResourceGroupResource e ResourceGroupTeam.
- Expor CRUD e associações do novo módulo.

### Fase 3: Consolidação Analítica

- Incluir resource_group_id nos pipelines assíncronos de SLA, DORA e COGS.
- Persistir snapshots por grupo e período.

### Fase 4: Transição de UX e Contrato

- Dashboard executivo passa a usar grupos por padrão.
- Endpoints e campos antigos podem ser removidos durante a refatoração sem janela de convivência.

### Fase 5: Cleanup

- Remover ambiguidades de nomenclatura remanescentes.
- Remover rotas/campos antigos já substituídos no novo modelo.

## Plano de Entrega

Regra de execução:

- Trabalhar um módulo por vez.
- Não executar SLA, DORA e COGS em paralelo.
- Só iniciar o próximo módulo após aceite formal do módulo anterior.

### Sprint 1 e 2: Módulo Iniciativas/Recursos

- Renomear Iniciativas para Recursos no frontend.
- Refatorar contrato para modelo novo sem retrocompatibilidade.
- Entregar base de Resource Group (migrations + CRUD).
- Entregar vínculo Resource Group <-> Recursos.
- Entregar vínculo Resource Group <-> Times (N:N).
- Entregar endpoint de resumo base do grupo (sem consolidação completa de métricas analíticas).
- Validar fluxo ponta a ponta de cadastro, vínculo e leitura.

### Sprint 3: Módulo SLA

- Adaptar pipeline SLA para consolidar por resource_group_id.
- Publicar snapshot de compliance por grupo e período.
- Ajustar alertas de at_risk e breach para escopo de grupo.
- Validar métricas e contratos SLA no contexto do Resource Group.

### Sprint 4: Módulo DORA

- Adaptar pipeline DORA para consolidar por resource_group_id.
- Consolidar DF, LT, MTTR e CFR por grupo.
- Publicar scorecard por grupo com snapshots versionados.
- Validar consistência entre recursos vinculados e score do grupo.

### Sprint 5: Módulo COGS

- Implementar rollup oficial por resource_group_id.
- Aplicar proporção automática por Jira com ajuste manual por recurso.
- Consolidar burn rate e planned vs actual no nível de grupo.
- Validar rateio de custo para recursos compartilhados entre grupos.

### Sprint 6: Hardening e Fechamento

- Observabilidade, auditoria e performance tuning dos pipelines.
- Testes integrados de regressão por módulo (ordem: Recursos -> SLA -> DORA -> COGS).
- Ajustes finais de UX no dashboard executivo baseado em Resource Group.

## Critérios de Aceite

- Frontend exibe Recursos sem ambiguidade de objetivo.
- Grupo de Recursos consolida métricas de SLA, DORA e COGS com lineage rastreável.
- Casos N:N de time x grupo funcionam sem perda de isolamento por tenant.
- Recompute assíncrono executa sem bloquear rotas críticas.
- Dados financeiros continuam protegidos por permissões explícitas.

## Riscos e Mitigações

Risco: duplicidade conceitual entre Projeto técnico e Grupo.
Mitigação: nomenclatura explícita de domínio e UX orientada a contexto.

Risco: custo computacional de consolidação por grupo.
Mitigação: snapshots assíncronos, janelas de recompute e cache de leitura.

Risco: quebra de dashboards atuais.
Mitigação: refatorar frontend no mesmo ciclo do backend e validar fluxos ponta a ponta.

Risco: conflitos de ownership entre times.
Mitigação: role de vínculo e governança por permission profile.

## Decisões Confirmadas

- Nome final do novo agregador: Resource Group.
- Estratégia de rateio de COGS para recurso compartilhado: proporção de trabalho nos boards do Jira.
- Regra de proporção: automática por trabalho observado no Jira, com opção de ajuste manual por recurso.
- Contratos/histórico legados: não são requisito para a refatoração atual, pois o sistema não está em produção.

## Pendências em Linguagem Direta

- Nenhuma pendência aberta para definição de proporção.

## Próximos Passos Recomendados

- Definir detalhe de implementação da proporção no contrato:
  - cálculo automático por trabalho no Jira
  - sobrescrita manual por recurso
  - fallback para peso igual quando não houver dados confiáveis
- Aprovar contrato v1.1 em revisão cruzada backend/frontend.
- Quebrar implementação em tasks por sprint com owners por módulo.
