# Plano da V2 - Plataforma Flexivel de Analytics por Squad

Data: 2026-07-17
Status: proposta
Foco: squads, tech managers e lideranca tecnica com autonomia configuravel
Acompanhamento de execucao: docs/insights-v2-sprints-tracking.md

## 1. Objetivo

Construir a V2 do sistema de Insights como uma plataforma analitica configuravel por squad, na qual:

1. Integracoes ingerem e persistem dados brutos de ferramentas externas.
2. O sistema transforma esses dados em fatos canonicos reutilizaveis.
3. Cada squad define seu proprio escopo analitico.
4. Cada squad define seus conceitos de negocio, como toil, debito tecnico, bug, feature e trabalho nao planejado.
5. Cada insight e calculado por formulas configuraveis e auditaveis.
6. Dashboards, alertas e series historicas passam a ser derivados dessa camada configuravel.

Resultado esperado:

1. O produto deixa de ser um conjunto fixo de metricas.
2. O produto passa a operar como uma plataforma de modelagem analitica para engenharia.

## 2. Problema que a V2 resolve

Na pratica, squads usam processos diferentes:

1. Um time pode marcar toil por issue type.
2. Outro pode marcar toil por label.
3. Outro pode usar componente, board, projeto ou combinacoes de campos.
4. O mesmo conceito pode ter significados diferentes entre squads.

O sistema atual de insights fixos nao modela bem essa variabilidade quando o objetivo e dar autonomia real aos times.

A V2 resolve isso separando cinco camadas:

1. ingestao,
2. fatos canonicos,
3. escopo do squad,
4. classificacao semantica,
5. formulas e visualizacoes.

## 3. Principios de produto e arquitetura

1. Autonomia do squad sem perda de governanca.
2. Dados brutos preservados para auditoria e reprocessamento.
3. Modelo canonico comum para evitar acoplamento com providers.
4. Interpretacao por squad, nao canonizacao por squad.
5. Formula declarativa, versionada e explicavel.
6. Reprocessamento historico deterministico.
7. Materializacao para leitura rapida.
8. Permissoes e ownership claros por tenant e por squad.
9. Comparabilidade entre squads opcional e explicitamente controlada.
10. Nenhuma logica critica dependente de codigo arbitrario executado por usuario.

## 4. Modelo conceitual da V2

```text
Providers -> Raw Events -> Canonical Facts -> Squad Scope -> Classifiers -> Metric Formulas -> Materialized Insights -> Views/Alerts
```

### 4.1 Ingestao

Responsavel por:

1. coletar dados via API, webhook ou sync incremental,
2. armazenar payload bruto original,
3. deduplicar por chave externa,
4. registrar metadados de origem,
5. publicar eventos internos para canonizacao.

### 4.2 Fatos canonicos

Responsavel por representar o que aconteceu, de forma padronizada e reutilizavel.

Exemplos iniciais de fatos:

1. work_item
2. work_item_field
3. work_item_label
4. work_item_status_change
5. pull_request
6. pull_request_review
7. deployment
8. incident
9. repository
10. service
11. environment
12. team_membership

Regra central:

1. a camada canonica nao decide o significado do dado para um squad;
2. ela apenas registra o fato observado de forma estavel.

### 4.3 Escopo do squad

Responsavel por dizer quais fatos pertencem ao universo analitico de cada squad.

Exemplos:

1. repositórios incluidos,
2. boards ou projetos Jira incluidos,
3. servicos de incidentes monitorados,
4. contas, tags ou ambientes AWS incluidos,
5. filtros por label, componente, time ou dominio.

### 4.4 Classificadores

Responsavel por traduzir fatos canonicos em conceitos de negocio do squad.

Exemplos de conceitos:

1. toil
2. debito_tecnico
3. bug
4. feature
5. suporte
6. retrabalho
7. trabalho_nao_planejado
8. operacao

Exemplos de regras:

1. toil quando issue_type = Support
2. toil quando labels contem ops-toil
3. debito tecnico quando componente = Platform e label = tech-debt
4. trabalho nao planejado quando created_at > sprint_start e status final = done

### 4.5 Formulas

Responsavel por agregar fatos e classificacoes em metricas e insights.

Exemplos:

1. toil_rate = work_items classificados como toil / total de work_items
2. debt_load_points = soma de story points classificados como debito tecnico
3. interrupt_index = incidentes criticos + itens de toil por periodo
4. unplanned_work_ratio = itens nao planejados concluidos / throughput total

### 4.6 Visualizacoes

Responsavel por apresentar o resultado para consumo humano.

Exemplos:

1. scorecards,
2. series temporais,
3. breakdown por conceito,
4. comparativos historicos,
5. alertas,
6. explainability por metrica,
7. tabelas drill-down com evidencias.

## 5. O que cada squad pode customizar

Cada squad pode customizar:

1. escopo dos dados,
2. classificacao dos conceitos,
3. formulas das metricas,
4. pesos e thresholds,
5. janelas de tempo,
6. agregacoes,
7. dashboards e visoes,
8. alertas e gatilhos.

Cada squad nao pode customizar livremente:

1. o formato dos dados brutos,
2. o contrato canonico,
3. o mecanismo de execucao,
4. a politica de auditoria,
5. o modelo de permissao,
6. a trilha de lineage dos calculos.

## 6. Componentes principais da arquitetura

### 6.1 Raw Data Store

Armazena:

1. payload bruto,
2. provider,
3. connection_id,
4. external_id,
5. timestamps de origem e ingestao,
6. hash para deduplicacao,
7. status de processamento.

### 6.2 Canonicalization Engine

Responsavel por:

1. transformar payload bruto em fatos canonicos,
2. versionar transformacoes,
3. manter lineage entre fato canonico e origem bruta,
4. isolar variacoes de provider em adaptadores de transformacao.

### 6.3 Scope Engine

Responsavel por:

1. resolver se um fato entra no universo de um squad,
2. suportar filtros por provider, projeto, repo, servico, ambiente e atributos,
3. permitir multiplos escopos por squad quando necessario.

### 6.4 Classification Engine

Responsavel por:

1. aplicar regras declarativas sobre fatos do escopo,
2. produzir rotulos semanticos,
3. explicar por que um fato foi classificado,
4. suportar multiplas versoes de classificador.

### 6.5 Formula Engine

Responsavel por:

1. executar formulas declarativas,
2. consumir fatos, escopos e classificacoes,
3. suportar agregacoes por periodo,
4. produzir metricas materializaveis,
5. expor explainability e lineage por resultado.

### 6.6 Materialization Layer

Responsavel por:

1. persistir resultados prontos para leitura,
2. manter snapshots por periodo,
3. recalcular sob demanda,
4. suportar invalidacao e reprocessamento historico.

### 6.7 Query and Presentation API

Responsavel por:

1. servir dashboards,
2. listar evidencias por insight,
3. consultar definicoes de escopo, classificadores e formulas,
4. expor status de jobs de reprocessamento.

## 7. Avaliacao do modulo de Integracoes atual

O modulo de Integracoes atual atende parcialmente a visao da V2.

### 7.1 O que ja atende

1. ownership correto da comunicacao com providers externos,
2. suporte a conexoes por provider,
3. suporte a sync full e incremental,
4. suporte a webhooks,
5. suporte a credenciais por conexao,
6. suporte inicial a escopo por conexao,
7. suporte basico a jobs de sync e eventos de webhook.

### 7.2 O que nao atende integralmente a V2

1. conectores escrevem cedo demais em entidades de dominio do produto atual,
2. nao existe raw store generico e uniforme para todos os objetos ingeridos,
3. webhook e sync nao convergem completamente para o mesmo pipeline analitico,
4. nao existe camada explicita de fatos canonicos versionados,
5. nao existe lineage forte entre payload bruto, fato canonico, classificacao e insight,
6. o reprocessamento atual e orientado a sync, nao a reconstruir historico analitico por versao de regra,
7. type mapping por conexao e util, mas insuficiente para suportar classificacao semantica rica por squad.

### 7.3 Decisao para a V2

Na V2, o modulo de Integracoes deve mudar de papel:

1. deixar de sincronizar diretamente para entidades finais de insight,
2. passar a ingerir, preservar e publicar dados para canonizacao,
3. alimentar uma base analitica generica em vez de um modelo rigido de dominio,
4. operar como fundacao de dados para escopo, classificacao e formulas por squad.

### 7.4 Ajustes necessarios no modulo de Integracoes

1. Criar um raw store generico para todos os objetos ingeridos por API e webhook.
2. Separar claramente as etapas de fetch, persistencia bruta, canonizacao e consumo.
3. Introduzir engine de canonizacao versionada por provider e por entidade.
4. Persistir fatos canonicos explicitamente, sem depender apenas de Task, Epic, Project ou IncidentEvent.
5. Unificar o pipeline de webhook e sync incremental para produzir a mesma trilha de processamento.
6. Adicionar lineage entre connection, payload bruto, fato canonico e resultado materializado.
7. Criar inventario de campos observados por provider e por entidade para alimentar os construtores de classificadores.
8. Suportar replay e reprocessamento deterministico a partir do dado bruto.
9. Manter adaptadores por provider isolados para que a variacao externa nao vaze para a DSL do squad.

### 7.5 Limite de responsabilidade entre Integracoes e V2

Integracoes deve responder por:

1. capturar,
2. autenticar,
3. persistir bruto,
4. deduplicar,
5. entregar material para canonizacao.

A plataforma V2 de analytics deve responder por:

1. canonizar,
2. escopar,
3. classificar,
4. calcular,
5. materializar,
6. explicar.

## 8. Modelo de dados inicial

### 8.1 Entidades de ingestao

1. RawEvent
2. RawEventCheckpoint
3. IntegrationConnection
4. IngestionJob

### 8.2 Entidades canonicas

1. CanonicalFact
2. CanonicalFactAttribute
3. CanonicalFactRelation
4. CanonicalFactLineage

### 8.3 Entidades de configuracao por squad

1. Squad
2. SquadScope
3. SquadScopeRule
4. SquadClassifier
5. SquadClassifierRule
6. MetricFormula
7. InsightView
8. AlertRule

### 8.4 Entidades de execucao e leitura

1. ClassificationResult
2. MetricComputationRun
3. MaterializedInsight
4. MaterializedInsightPoint
5. ReprocessingJob
6. ExplainabilityRecord

## 9. DSL proposta para configuracao

Para garantir seguranca, auditabilidade e previsibilidade, a V2 deve usar uma DSL declarativa para classificadores e formulas.

### 9.1 Exemplo de classificador

```json
{
  "key": "toil",
  "version": 1,
  "applies_to": "work_item",
  "rule": {
    "any": [
      {
        "field": "issue_type",
        "operator": "equals",
        "value": "Support"
      },
      {
        "field": "labels",
        "operator": "contains",
        "value": "ops-toil"
      }
    ]
  }
}
```

### 9.2 Exemplo de formula

```json
{
  "key": "toil_rate",
  "version": 1,
  "input": "work_item",
  "window": "30d",
  "expression": {
    "divide": [
      {
        "count": {
          "where": {
            "classifier": "toil"
          }
        }
      },
      {
        "count": {
          "where": {
            "scope": "current"
          }
        }
      }
    ]
  }
}
```

### 9.3 Operadores minimos da DSL

1. equals
2. not_equals
3. contains
4. not_contains
5. in
6. not_in
7. gt
8. gte
9. lt
10. lte
11. and
12. or
13. not
14. count
15. sum
16. avg
17. min
18. max
19. percentile
20. divide
21. multiply
22. subtract
23. ratio
24. group_by_time

## 10. Explainability e auditoria

Toda classificacao e toda metrica devem responder:

1. qual versao de regra foi aplicada,
2. quais fatos entraram no calculo,
3. quais filtros de escopo foram usados,
4. quais classificadores foram acionados,
5. qual janela temporal foi considerada,
6. qual formula foi executada,
7. quando o resultado foi materializado,
8. se houve fallback, warning ou dado faltante.

## 11. Reprocessamento historico

O sistema deve suportar reprocessamento quando houver:

1. mudanca de escopo,
2. mudanca de classificador,
3. mudanca de formula,
4. correcao de dado de origem,
5. onboarding de novo provider,
6. ajuste de transformacao canonica.

Capacidades obrigatorias:

1. reprocessamento por squad,
2. reprocessamento por intervalo de tempo,
3. reprocessamento por provider,
4. dry-run com estimativa de impacto,
5. fila persistente,
6. idempotencia,
7. job status consultavel.

## 12. API alvo da V2

### 12.1 Configuracao

1. CRUD de escopos por squad
2. CRUD de classificadores por squad
3. CRUD de formulas por squad
4. CRUD de views por squad
5. CRUD de alertas por squad

### 12.2 Operacao

1. listar fatos canonicos disponiveis para configuracao
2. listar campos observados por provider e por entidade
3. simular classificador
4. simular formula
5. disparar reprocessamento
6. consultar status de job

### 12.3 Consumo

1. buscar resultados materializados
2. buscar serie temporal por metrica
3. buscar breakdown por conceito
4. buscar explainability de um insight
5. buscar evidencias subjacentes ao numero exibido

## 13. Experiencia de produto esperada

Fluxo principal para um squad:

1. conectar ferramentas,
2. revisar fatos observados,
3. definir escopo,
4. definir conceitos do squad,
5. montar formulas,
6. simular resultado,
7. publicar versao,
8. materializar historico,
9. consumir dashboards e alertas.

Principios de UX:

1. construtor visual antes de edicao JSON,
2. JSON avancado apenas para usuarios experientes,
3. preview e explainability obrigatorios antes de publicar,
4. warnings de cobertura e ambiguidade,
5. rollback simples para versao anterior.

## 14. Roadmap de implementacao

### Fase 1 - Fundacao de dados

1. Refatorar o modulo de Integracoes para persistencia bruta generica.
2. Criar armazenamento de raw events e raw objects para sync e webhook.
3. Criar pipeline de canonizacao desacoplado dos conectores.
4. Definir conjunto inicial de fatos canonicos.
5. Implementar lineage basica entre origem bruta e fato canonico.
6. Implementar query interna de fatos e campos observados.

### Fase 2 - Escopo e classificacao

1. Criar entidades de squad scope.
2. Criar DSL inicial de classificadores.
3. Implementar engine de classificacao.
4. Implementar simulacao de classificadores.
5. Persistir resultados de classificacao.

### Fase 3 - Formulas e materializacao

1. Criar DSL inicial de formulas.
2. Implementar formula engine.
3. Materializar metricas por periodo.
4. Criar explainability por formula.
5. Implementar reprocessamento historico.

### Fase 4 - API e produto configuravel

1. Expor APIs de escopo, classificadores e formulas.
2. Expor APIs de simulacao e explainability.
3. Expor APIs de dashboards e series temporais.
4. Implementar versionamento e publicacao.
5. Implementar permissao por squad e tenant.

### Fase 5 - UX operacional e governanca

1. Criar construtor visual de escopo.
2. Criar construtor visual de classificadores.
3. Criar construtor visual de formulas.
4. Criar comparador entre versoes.
5. Criar trilha de auditoria operacional.

## 15. Criterios de aceite da V2

1. Um squad consegue definir escopo sem apoio manual de engenharia.
2. Um squad consegue definir o conceito de toil por suas proprias regras.
3. Um squad consegue publicar ao menos tres metricas customizadas.
4. Todo insight exibido possui explainability navegavel.
5. Reprocessamento de 90 dias pode ser disparado sem corromper resultados atuais.
6. Mudanca de classificador nao exige alterar ingestao ou fato canonico.
7. A plataforma suporta multiplos squads com semanticas diferentes sobre os mesmos fatos.
8. O modulo de Integracoes persiste objetos brutos de forma uniforme para sync e webhook.
9. Webhook e sync convergem para a mesma trilha de canonizacao e lineage.

## 16. Riscos e mitigacoes

1. Risco: liberdade excessiva gerar configuracoes inconsistentes.
   Mitigacao: DSL restrita, simulacao obrigatoria e validacoes de publish.
2. Risco: formulas caras degradarem o sistema.
   Mitigacao: limites de complexidade, materializacao e custo estimado por execucao.
3. Risco: semanticas conflitantes dificultarem comparacao entre squads.
   Mitigacao: metricas globais opcionais e taxonomias recomendadas.
4. Risco: modelo canonico insuficiente para alguns providers.
   Mitigacao: versionamento da canonizacao e extensoes controladas por entidade.
5. Risco: reprocessamento historico gerar alto custo computacional.
   Mitigacao: fila persistente, particionamento por janela e prioridades de job.
6. Risco: manter o modulo de Integracoes acoplado ao dominio atual atrasar a V2.
   Mitigacao: separar fetch bruto de consumo de dominio logo na primeira fase.

## 17. Fora de escopo da primeira entrega da V2

1. Execucao de codigo arbitrario escrito por usuario.
2. Editor completo de linguagem procedural.
3. Comparacao cross-tenant automatica.
4. Realtime analytics de baixa latencia para todos os providers.
5. Recomendações automáticas baseadas em IA sem explainability deterministica.

## 18. Decisao arquitetural central

A V2 deve assumir explicitamente este contrato:

1. Integracoes sao a origem dos dados.
2. Fatos canonicos sao a base compartilhada.
3. Squads definem significado e formula.
4. Insights sao resultados computados, nao entidades estaticas.
5. O produto e uma plataforma analitica configuravel, nao apenas um modulo de dashboards fixos.
6. O modulo de Integracoes precisa evoluir junto com a V2 para deixar de ser apenas sync para dominio e passar a ser a fundacao de dados brutos e canonizacao.
