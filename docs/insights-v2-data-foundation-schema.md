# Schema Inicial da Fundacao de Dados da V2

Data: 2026-07-17
Status: proposta
Escopo: raw store, canonical facts, lineage e entidades de suporte da V2

## 1. Objetivo

Definir o schema inicial da fundacao de dados da V2 para suportar:

1. ingestao bruta uniforme,
2. canonizacao versionada,
3. classificacao semantica por squad,
4. formulas configuraveis,
5. materializacao de insights,
6. lineage e auditoria ponta a ponta.

## 2. Camadas de persistencia

```text
Raw Ingestion Layer
-> Canonical Facts Layer
-> Squad Semantics Layer
-> Metric Execution Layer
-> Materialized Insights Layer
```

## 3. Raw Ingestion Layer

### 3.1 RawObject

Representa qualquer objeto bruto vindo de provider, independentemente de ser webhook ou sync.

Campos sugeridos:

1. id
2. tenant_id
3. connection_id
4. provider
5. entity_type
6. external_id
7. parent_external_id opcional
8. event_type opcional
9. source_channel: webhook | sync_full | sync_incremental
10. payload
11. payload_hash
12. occurred_at opcional
13. ingested_at
14. first_seen_at
15. last_seen_at
16. sequence_cursor opcional
17. processing_status
18. processing_error opcional
19. schema_hint opcional

Indices sugeridos:

1. tenant_id + provider + entity_type
2. tenant_id + connection_id + entity_type
3. tenant_id + provider + external_id
4. processing_status + ingested_at
5. payload_hash

### 3.2 RawCheckpoint

Guarda progresso por conexao e entidade.

Campos sugeridos:

1. id
2. tenant_id
3. connection_id
4. provider
5. entity_type
6. cursor_value opcional
7. last_success_at
8. last_attempt_at
9. status
10. metadata

### 3.3 RawIngestionRun

Representa uma execucao de ingestao.

Campos sugeridos:

1. id
2. tenant_id
3. connection_id
4. provider
5. mode
6. started_at
7. finished_at
8. status
9. objects_received
10. objects_inserted
11. objects_deduplicated
12. error_summary opcional
13. metadata

## 4. Canonical Facts Layer

### 4.1 CanonicalFact

Entidade generica para fatos canonicos observados.

Campos sugeridos:

1. id
2. tenant_id
3. fact_type
4. fact_key
5. provider
6. source_entity_type
7. source_external_id
8. occurred_at opcional
9. valid_from opcional
10. valid_to opcional
11. payload
12. canonical_version
13. transform_version
14. quality_score opcional
15. warnings opcional
16. created_at
17. updated_at

Chaves e indices:

1. unique tenant_id + fact_type + fact_key + canonical_version
2. index tenant_id + fact_type + occurred_at
3. index provider + source_entity_type

### 4.2 CanonicalFactAttribute

Permite expor atributos de forma indexavel para filtros e descoberta.

Campos sugeridos:

1. id
2. tenant_id
3. fact_id
4. attribute_name
5. value_type
6. value_string opcional
7. value_number opcional
8. value_boolean opcional
9. value_datetime opcional
10. value_json opcional
11. is_multivalue

Indices sugeridos:

1. fact_id + attribute_name
2. tenant_id + attribute_name + value_string
3. tenant_id + attribute_name + value_number

### 4.3 CanonicalFactRelation

Representa relacoes entre fatos.

Campos sugeridos:

1. id
2. tenant_id
3. from_fact_id
4. relation_type
5. to_fact_id
6. metadata opcional

Exemplos:

1. work_item belongs_to repository
2. work_item linked_to incident
3. pull_request related_to work_item
4. deployment affects service

### 4.4 CanonicalLineage

Relaciona fatos canonicos aos objetos brutos que os originaram.

Campos sugeridos:

1. id
2. tenant_id
3. raw_object_id
4. fact_id
5. transform_version
6. extraction_path opcional
7. created_at

## 5. Tipos iniciais de fatos canonicos

### 5.1 work_item

Representa ticket, issue ou card.

Payload canonico minimo:

1. provider
2. external_id
3. title
4. description opcional
5. issue_type opcional
6. status_raw
7. assignee_ref opcional
8. reporter_ref opcional
9. labels
10. components
11. story_points opcional
12. created_at
13. updated_at
14. completed_at opcional

### 5.2 work_item_status_change

Representa mudanca de status observada ou inferida.

Payload canonico minimo:

1. work_item_ref
2. from_status opcional
3. to_status
4. changed_at
5. actor_ref opcional

### 5.3 pull_request

Payload canonico minimo:

1. repository_ref
2. external_id
3. title
4. author_ref opcional
5. base_branch opcional
6. head_branch opcional
7. state
8. created_at
9. merged_at opcional
10. closed_at opcional
11. labels

### 5.4 deployment

Payload canonico minimo:

1. repository_ref opcional
2. service_ref opcional
3. environment_ref opcional
4. status
5. started_at
6. finished_at opcional
7. version_ref opcional

### 5.5 incident

Payload canonico minimo:

1. external_id
2. title
3. status
4. severity opcional
5. priority opcional
6. affected_services
7. opened_at
8. acknowledged_at opcional
9. resolved_at opcional
10. closed_at opcional
11. tags

### 5.6 repository

Payload canonico minimo:

1. provider
2. external_id
3. full_name
4. owner
5. is_archived
6. default_branch opcional

### 5.7 service

Payload canonico minimo:

1. provider
2. external_id
3. name
4. environment opcional
5. tags

## 6. Squad Semantics Layer

### 6.1 Squad

Campos sugeridos:

1. id
2. tenant_id
3. key
4. name
5. status
6. created_at
7. updated_at

### 6.2 SquadScope

Define o recorte do universo analitico do squad.

Campos sugeridos:

1. id
2. tenant_id
3. squad_id
4. name
5. status
6. version
7. rule_json
8. created_by
9. updated_by
10. created_at
11. updated_at

### 6.3 SquadClassifier

Define um conceito semantico do squad.

Campos sugeridos:

1. id
2. tenant_id
3. squad_id
4. key
5. label
6. applies_to_fact_type
7. version
8. rule_json
9. status
10. created_by
11. updated_by
12. created_at
13. updated_at

### 6.4 ClassificationResult

Resultado da classificacao de um fato por uma versao de classificador.

Campos sugeridos:

1. id
2. tenant_id
3. squad_id
4. fact_id
5. classifier_id
6. classifier_version
7. matched
8. evidence_json
9. computed_at

## 7. Metric Execution Layer

### 7.1 MetricFormula

Campos sugeridos:

1. id
2. tenant_id
3. squad_id
4. key
5. label
6. input_fact_type
7. version
8. expression_json
9. window_definition
10. status
11. created_by
12. updated_by
13. created_at
14. updated_at

### 7.2 MetricComputationRun

Campos sugeridos:

1. id
2. tenant_id
3. squad_id
4. formula_id
5. formula_version
6. window_start
7. window_end
8. status
9. facts_scanned
10. duration_ms opcional
11. warnings opcional
12. created_at
13. finished_at opcional

## 8. Materialized Insights Layer

### 8.1 MaterializedInsight

Snapshot agregada de uma metrica.

Campos sugeridos:

1. id
2. tenant_id
3. squad_id
4. formula_id
5. formula_version
6. period_key
7. value_number opcional
8. value_json opcional
9. confidence opcional
10. warnings opcional
11. computed_at

### 8.2 MaterializedInsightPoint

Pontos de serie temporal ou breakdown.

Campos sugeridos:

1. id
2. materialized_insight_id
3. point_key
4. point_time opcional
5. dimension_key opcional
6. value_number opcional
7. value_json opcional

### 8.3 ExplainabilityRecord

Trilha explicativa para um insight materializado.

Campos sugeridos:

1. id
2. tenant_id
3. materialized_insight_id
4. scope_version
5. classifier_versions
6. formula_version
7. fact_ids
8. raw_object_ids
9. warnings opcional
10. created_at

## 9. Relacoes principais

```text
IntegrationConnection -> RawObject -> CanonicalLineage -> CanonicalFact
CanonicalFact -> CanonicalFactAttribute
CanonicalFact -> CanonicalFactRelation -> CanonicalFact
Squad -> SquadScope
Squad -> SquadClassifier -> ClassificationResult -> CanonicalFact
Squad -> MetricFormula -> MetricComputationRun -> MaterializedInsight
MaterializedInsight -> ExplainabilityRecord -> CanonicalFact / RawObject
```

## 10. Consideracoes de modelagem

1. O schema precisa equilibrar flexibilidade e indexacao.
2. O payload canonico pode ficar em JSON, mas atributos consultaveis devem ser projetados para colunas auxiliares.
3. Fact types devem ser extensiveis sem migracao estrutural frequente.
4. O versionamento de transformacao, classificador e formula deve ser independente.
5. Multi-tenancy deve existir em todas as tabelas centrais.

## 11. Ordem sugerida de implementacao do schema

1. IntegrationConnection existente reaproveitada.
2. RawObject, RawCheckpoint e RawIngestionRun.
3. CanonicalFact, CanonicalFactAttribute, CanonicalFactRelation e CanonicalLineage.
4. Squad, SquadScope e SquadClassifier.
5. ClassificationResult e MetricFormula.
6. MetricComputationRun, MaterializedInsight e ExplainabilityRecord.

## 12. Decisao central

O schema da V2 deve ser orientado a fatos e semantica configuravel, nao a entidades finais fixas do produto atual.

Essa decisao e o que permite que dois squads usem os mesmos dados ingeridos, mas produzam significados e insights diferentes sem duplicar a camada canonica.
