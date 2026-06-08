# Handover Frontend - Insights Calculation Policy - Fase 3

Data de referencia: 2026-06-08
Status do contrato: implementado-e-revisado (backend)
Escopo: frontend

## Objetivo da fase

Aplicar a policy de calculo no runtime dos endpoints de Insights e expor contexto de calculo para explainability.

## Permissoes da fase

1. insights.read (endpoints de leitura de insights)
2. insights.policy.read (continua necessario para telas de policy da Fase 2)

## Endpoints impactados nesta fase

1. GET /api/v1/insights/resource-groups/:group_id/overview
2. GET /api/v1/insights/resource-groups/:group_id/trends
3. GET /api/v1/insights/resource-groups/:group_id/backlog-quality
4. GET /api/v1/insights/resource-groups/:group_id/planning-confidence

Nao houve mudanca de rota, apenas enriquecimento de resposta e alteracao de regra de calculo quando existe policy ativa.

## Endpoint novo para montagem da policy no frontend

Para evitar lista hardcoded no multiselect de state_mapping, foi adicionado:

1. GET /api/v1/insights/resource-groups/:group_id/calculation-policy/candidates

Permissao:

1. insights.policy.read

Resposta:

1. resource_group_id
2. items: lista observada no grupo com provider, source_type e match
3. defaults.task_statuses: baseline de status aceitos pelo motor atual (backlog, todo, in_progress, review, done, cancelled)

Uso recomendado:

1. Preencher multiselect de match com items quando existir dado observado.
2. Completar com defaults.task_statuses para cobertura inicial.
3. Salvar no PUT de policy mantendo provider/source_type/match por entrada.

## Novo campo de resposta

Todos os 4 endpoints acima passam a retornar `calculation_context`:

```json
{
  "calculation_context": {
    "policy_source": "resource_group",
    "policy_id": "uuid-ou-null",
    "policy_version": 3,
    "delivery_sources_used": ["task_done", "pr_merged"],
    "aggregation_mode": "weighted",
    "state_mapping_hash": "sha256:2f2ec7c6de70b8d9",
    "fallback_used": false,
    "warnings": []
  }
}
```

Semantica dos campos:

1. policy_source: `resource_group`, `tenant_default` ou `legacy`.
2. policy_id/policy_version: preenchidos quando existe policy valida resolvida.
3. delivery_sources_used/aggregation_mode: informam como throughput foi agregado nesta resposta.
4. state_mapping_hash: hash curto do mapping aplicado (auditoria/explainability).
5. fallback_used: true quando backend precisou cair para defaults legados.
6. warnings: avisos tecnicos de policy (ex.: config invalida, fallback aplicado).

## Mudancas funcionais de calculo

1. Overview:
   - throughput_7d, throughput_30d e trend agora usam `delivery.sources` + `aggregation_mode` da policy.
   - tuning de penalties usa `metric_tuning.overview` quando configurado.
2. Trends:
   - serie de throughput passa a respeitar sources/aggregation da policy.
   - confidence continua derivada, agora sobre throughput agregado.
3. Backlog Quality:
   - classificacao de estados usa `state_mapping` configurado (com fallback legado).
   - score usa pesos de `metric_tuning.backlog_quality.weights` quando presentes.
4. Planning Confidence:
   - leitura de status de tasks para progresso (done/open) passa por state mapping configurado.
   - backlog penalty herda pesos da policy quando aplicavel.

## Compatibilidade e fallback

1. Compatibilidade de rota: sem breaking em paths/methods.
2. Compatibilidade de payload: adicao de campo novo (`calculation_context`), sem remocao de campos existentes.
3. Fallback legado:
   - quando nao existe policy ativa, o backend usa comportamento legado e marca `fallback_used=true`.
   - quando policy existe mas config invalida, backend aplica fallback legado e publica warning.

## Impacto esperado no frontend

1. UI pode exibir badge de origem do calculo (`policy_source`) e indicador de fallback.
2. UI pode exibir tooltip de explainability com `delivery_sources_used` e `aggregation_mode`.
3. Recomendado tratar `warnings` de `calculation_context` como banner nao bloqueante.
4. Comparativos historicos podem variar quando policy ativa passar a influenciar agregacao/mapeamento.

## Evidencias de validacao backend

1. Build da API: OK.
2. Testes policy service: 6/6.
3. Testes rotas insights: 33/33.
4. OpenAPI atualizado com `InsightsCalculationContext` e referencia nos 4 schemas impactados.
5. Novo endpoint de candidates validado em teste de rota (200/403/404).

## Checklist de aceite frontend da fase

1. Consumir `calculation_context` nos 4 endpoints impactados sem quebrar telas atuais.
2. Exibir (ou pelo menos logar) `policy_source`, `fallback_used` e warnings para suporte operacional.
3. Revisar mensagens de ajuda sobre variacao de metricas quando policy ativa.
4. Validar cenarios com `policy_source=legacy` e com policy ativa por resource group.

## Gate de encerramento da fase

- revisado_contra_codigo: true
- contrato_openapi_revisado: true
- implementacao_frontend_concluida: pendente
- status_final_fase_3: aguardando aprovacao
