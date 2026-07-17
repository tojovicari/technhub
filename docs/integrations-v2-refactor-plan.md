# Plano de Refatoracao do Modulo de Integracoes para a V2

Data: 2026-07-17
Status: proposta
Escopo: modulo de Integracoes como fundacao da V2 de analytics flexivel

## 1. Objetivo

Refatorar o modulo de Integracoes para que ele deixe de atuar principalmente como sincronizador direto para entidades de dominio e passe a operar como fundacao de dados da V2.

Na V2, o modulo deve ser responsavel por:

1. capturar dados de providers externos,
2. persistir objetos brutos de forma uniforme,
3. deduplicar e rastrear ingestao,
4. publicar eventos internos para canonizacao,
5. suportar replay e reprocessamento deterministico.

## 2. Problema atual

O formato atual do modulo atende bem a operacao de sync e webhook, mas tem limitacoes para a V2:

1. os conectores escrevem cedo demais em Task, Epic, Project e IncidentEvent,
2. o armazenamento bruto nao e uniforme entre sync e webhook,
3. nao existe trilha forte de lineage entre origem bruta e insight final,
4. webhook e sync seguem caminhos parcialmente diferentes,
5. a flexibilidade analitica por squad nao pode depender do shape atual do dominio.

## 3. Meta arquitetural

O modulo de Integracoes deve seguir este fluxo alvo:

```text
Provider API/Webhook -> Fetch Adapter -> Raw Object Store -> Canonicalization Queue -> Canonical Facts -> Consumers
```

Regras centrais:

1. conector nao escreve mais diretamente em entidades analiticas finais,
2. persistencia bruta passa a ser obrigatoria,
3. a canonizacao vira etapa explicita e versionada,
4. consumidores posteriores leem fatos canonicos, nao payloads de provider.

### 3.1 Diretriz de implementacao: package-first

Para Integracoes, a estrategia padrao da V2 sera package-first (buy before build):

1. priorizar bibliotecas maduras e mantidas para capacidades comuns,
2. implementar do zero apenas o que for diferencial de negocio ou lacuna comprovada,
3. evitar construir infraestrutura genérica que ja exista com boa qualidade no ecossistema.

Capacidades com preferencia forte por pacotes existentes:

1. retry, backoff e circuit breaking,
2. fila e job processing,
3. rate limiting e controle de concorrencia,
4. validacao de payload e schema,
5. observabilidade padrao (logs estruturados, metricas e traces),
6. paginacao/cursor helpers por provider quando disponiveis,
7. verificacao de assinatura e seguranca de webhook.

Criterios obrigatorios para adocao de pacote:

1. manutencao ativa e comunidade saudavel,
2. licenca compativel com o projeto,
3. previsibilidade de versoes e changelog,
4. cobertura minima de testes e uso em producao,
5. extensibilidade sem lock-in excessivo,
6. custo operacional aceitavel.

Quando nao adotar pacote:

1. registrar decisao no log arquitetural,
2. documentar motivo tecnico e alternativa avaliada,
3. definir plano de manutencao do codigo proprio.

## 4. Responsabilidades do modulo apos a refatoracao

O modulo de Integracoes passa a ser dono de:

1. conexao com providers,
2. autenticacao e rotacao de segredos,
3. sync full e incremental,
4. recepcao de webhooks,
5. deduplicacao de objetos externos,
6. persistencia bruta,
7. checkpoints de ingestao,
8. emissao de jobs para canonizacao.

O modulo deixa de ser dono de:

1. interpretacao de significado por squad,
2. classificacao semantica,
3. formulas de insights,
4. materializacao de metricas,
5. dashboards e explainability de negocio.

## 5. Mudancas estruturais necessarias

### 5.1 Separar fetch de persistencia de dominio

Hoje o fluxo faz fetch e ja normaliza para entidades como Task e Project.

Na V2, o fluxo deve ser:

1. fetch do provider,
2. persistencia do objeto bruto,
3. enfileiramento para canonizacao,
4. producao de fatos canonicos,
5. consumo por modulos de dominio e analytics.

### 5.2 Criar raw object store uniforme

Todos os dados ingeridos, vindos de webhook ou sync, devem convergir para o mesmo armazenamento bruto.

Campos minimos obrigatorios:

1. tenant_id,
2. connection_id,
3. provider,
4. entity_type,
5. external_id,
6. parent_external_id opcional,
7. event_type opcional,
8. payload,
9. payload_hash,
10. occurred_at,
11. ingested_at,
12. processing_status,
13. source_channel,
14. sequence_cursor opcional.

### 5.3 Introduzir canonizacao versionada

Cada provider deve produzir fatos canonicos por transformadores versionados.

Exemplos:

1. jira.issue -> work_item v1
2. jira.issue.status_history -> work_item_status_change v1
3. github.pull_request -> pull_request v1
4. incident_io.incident -> incident v1

Cada execucao precisa registrar:

1. transform_version,
2. mapping_version,
3. execution_time,
4. warnings,
5. lineage para o objeto bruto.

### 5.4 Unificar pipeline de webhook e sync

Webhook e sync nao podem ter semanticas diferentes na base analitica.

Ambos devem:

1. persistir bruto,
2. deduplicar,
3. publicar job de canonizacao,
4. gerar fatos canonicos pelo mesmo pipeline.

### 5.5 Inventario de campos observados

O modulo deve produzir um inventario observavel por provider e por entidade para suportar:

1. construtor de escopo,
2. construtor de classificadores,
3. auto-complete de campos,
4. analise de cobertura de dados.

## 6. Novos componentes do modulo

### 6.1 Ingestion Adapter

Camada fina por provider responsavel por:

1. autenticar,
2. buscar dados,
3. paginar,
4. interpretar cursores,
5. emitir objetos brutos.

### 6.2 Raw Persistence Service

Responsavel por:

1. persistir objetos brutos,
2. calcular hash,
3. deduplicar,
4. marcar origem sync ou webhook,
5. atualizar checkpoints.

### 6.3 Canonicalization Dispatcher

Responsavel por:

1. enfileirar processamento canonico,
2. controlar retry,
3. registrar falhas,
4. disparar replay quando necessario.

### 6.4 Canonical Transform Registry

Responsavel por:

1. registrar transformadores por provider e entidade,
2. resolver versao ativa,
3. permitir rollout seguro,
4. suportar rebuild historico.

### 6.5 Field Catalog Builder

Responsavel por:

1. indexar campos observados,
2. calcular frequencia de valores,
3. listar exemplos por provider,
4. alimentar UI de configuracao.

## 7. Entregaveis da refatoracao

### Fase A - Estrutura bruta

1. modelo de raw object store,
2. persistencia uniforme de webhook,
3. persistencia uniforme de sync,
4. checkpoint por conexao e entidade,
5. hashes e deduplicacao.
6. short-list de pacotes aprovados para retry, fila, validacao e webhook security.

### Fase B - Canonizacao

1. registry de transformadores,
2. canonicalization job,
3. fatos canonicos iniciais,
4. lineage basico,
5. warnings de transformacao.

### Fase C - Operacao e replay

1. replay por conexao,
2. replay por provider,
3. replay por janela temporal,
4. fila persistente com retry,
5. status observavel de processamento.

### Fase D - Descoberta para configuracao

1. catalogo de campos observados,
2. catalogo de entidades observadas,
3. estatisticas por campo,
4. API para simulacao e configuracao do lado analitico.

## 8. Compatibilidade e transicao

Durante a transicao, o sistema pode operar em modo dual:

1. fluxo legado continua populando dominio atual quando necessario,
2. novo fluxo persiste bruto e produz fatos canonicos,
3. comparacoes internas validam paridade minima,
4. desligamento do caminho legado ocorre por provider e por entidade.

Compatibilidade temporaria de rotas:

1. manter alias de rota para o endpoint antigo de sync enquanto o front ainda nao migrou,
2. redirecionar o alias para o mesmo orquestrador de sync do fluxo novo,
3. marcar o alias como transitorio e remover apos a migracao do front e validacao dos testes.

Ordem sugerida de migracao:

1. webhooks de incidentes,
2. Jira issues,
3. GitHub issues e pull requests,
4. deploy events,
5. fontes adicionais.

## 9. Criterios de aceite

1. Todo webhook recebido gera registro bruto rastreavel.
2. Todo sync incremental persiste objetos brutos antes de qualquer transformacao.
3. Um objeto bruto pode ser reprocessado sem nova chamada ao provider.
4. A canonizacao pode ser versionada sem alterar o conector.
5. O mesmo pipeline processa dados de webhook e sync.
6. O modulo expoe campos observados para suportar configuracao analitica.
7. Capacidades tecnicas comuns foram implementadas com pacotes aprovados, salvo excecoes justificadas.

## 10. Riscos e mitigacoes

1. Risco: duplicacao de custo de armazenamento.
   Mitigacao: compressao, retencao por tiers e deduplicacao por hash.
2. Risco: aumento de latencia operacional.
   Mitigacao: pipeline assíncrono com prioridade por entidade critica.
3. Risco: dual-write gerar divergencia temporaria.
   Mitigacao: rollout por provider e validacao comparativa.
4. Risco: inventario de campos crescer demais.
   Mitigacao: limites por cardinalidade e agregacao de amostras.
5. Risco: construir infraestrutura base do zero e elevar custo de manutencao.
   Mitigacao: aplicar diretriz package-first com criterios objetivos de selecao.

## 11. Decisao central

Sem refatorar Integracoes, a V2 fica acoplada ao modelo legado de dominio.

Com a refatoracao, Integracoes vira a camada de captura e preservacao de dados que a plataforma analitica precisa para dar autonomia real aos squads.
