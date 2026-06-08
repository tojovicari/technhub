# Handover Frontend - Insights Calculation Policy - Fase 2

Data de referencia: 2026-06-08
Status do contrato: implementado-e-revisado (backend)
Escopo: frontend

## Objetivo da fase

Expor ciclo de vida de policy de calculo por Resource Group, sem ainda alterar os calculos de Insights em runtime.

## Permissoes da fase

1. insights.policy.read
2. insights.policy.write
3. insights.policy.publish

## Endpoints entregues

### 1) GET policy ativa resolvida

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/calculation-policy
- Permissao: insights.policy.read
- Query opcional:
  - at: date-time

Resposta 200:

```json
{
  "data": {
    "resource_group_id": "uuid",
    "policy_source": "resource_group",
    "policy": {
      "id": "uuid",
      "name": "Payments custom policy",
      "status": "active",
      "version": 3,
      "effective_from": "2026-06-08T10:00:00.000Z",
      "effective_to": null,
      "config": {},
      "created_at": "2026-06-08T10:00:00.000Z",
      "updated_at": "2026-06-08T10:00:00.000Z"
    }
  },
  "meta": {},
  "error": null
}
```

Notas:

1. policy_source pode ser resource_group, tenant_default ou legacy.
2. Quando policy_source=legacy, policy vem null.

Status HTTP:

1. 200 sucesso
2. 400 query invalida
3. 401 nao autenticado
4. 403 sem permissao
5. 404 resource group nao encontrado

### 2) PUT cria draft de policy

- Metodo e rota: PUT /api/v1/insights/resource-groups/:group_id/calculation-policy
- Permissao: insights.policy.write

Body:

```json
{
  "name": "Draft policy",
  "config": {
    "state_mapping": {
      "backlog": [
        { "provider": "jira", "source_type": "issue", "match": "To Do" }
      ],
      "planned": [],
      "in_progress": [],
      "paused": [],
      "done": [{ "provider": "jira", "source_type": "issue", "match": "Done" }],
      "cancelled": []
    },
    "delivery": {
      "sources": ["task_done"],
      "aggregation_mode": "single"
    }
  }
}
```

Resposta 201:

```json
{
  "data": {
    "id": "uuid",
    "resource_group_id": "uuid",
    "name": "Draft policy",
    "status": "draft",
    "version": 4,
    "effective_from": null,
    "effective_to": null,
    "created_by": "user-id",
    "updated_by": "user-id",
    "created_at": "2026-06-08T11:00:00.000Z",
    "updated_at": "2026-06-08T11:00:00.000Z",
    "config": {}
  },
  "meta": {},
  "error": null
}
```

Status HTTP:

1. 201 criado
2. 400 body invalido (inclui mapping com sobreposicao)
3. 401 nao autenticado
4. 403 sem permissao
5. 404 resource group nao encontrado

### 3) POST publish de draft

- Metodo e rota: POST /api/v1/insights/resource-groups/:group_id/calculation-policy/publish
- Permissao: insights.policy.publish

Body:

```json
{
  "draft_id": "uuid",
  "effective_from": "2026-06-08T11:30:00.000Z",
  "effective_to": null
}
```

Resposta 200:

- Mesmo shape do draft, com status=active e janela de efetividade preenchida.

Status HTTP:

1. 200 publicado
2. 400 body invalido
3. 401 nao autenticado
4. 403 sem permissao
5. 404 draft ou resource group nao encontrado
6. 409 conflito com policy ativa no periodo

### 4) GET historico de policies

- Metodo e rota: GET /api/v1/insights/resource-groups/:group_id/calculation-policy/history
- Permissao: insights.policy.read
- Query opcional:
  - limit: int 1..100 (default 20)
  - include_defaults: boolean (default false)

Resposta 200:

```json
{
  "data": {
    "resource_group_id": "uuid",
    "items": [
      {
        "id": "uuid",
        "resource_group_id": "uuid",
        "name": "Draft policy",
        "status": "active",
        "version": 4,
        "effective_from": "2026-06-08T11:30:00.000Z",
        "effective_to": null,
        "created_by": "user-id",
        "updated_by": "user-id",
        "created_at": "2026-06-08T11:00:00.000Z",
        "updated_at": "2026-06-08T11:30:00.000Z"
      }
    ]
  },
  "meta": {},
  "error": null
}
```

Status HTTP:

1. 200 sucesso
2. 400 query invalida
3. 401 nao autenticado
4. 403 sem permissao
5. 404 resource group nao encontrado

## Regras funcionais importantes para UI

1. Nao existe alteracao de calculo de metricas nesta fase; a policy e configurada, mas ainda nao aplicada no score do Insights.
2. policy_source=legacy significa ausencia de policy ativa aplicavel.
3. Fluxo recomendado de tela:
   1. carregar policy ativa
   2. criar draft
   3. publicar draft
   4. recarregar policy ativa e historico
4. Tratar 409 de publish com mensagem de conflito de periodo e CTA para revisar janela.

## Casos de uso frontend

1. Tela de leitura de policy ativa do grupo.
2. Formulario de criacao de draft.
3. Acao de publish da draft.
4. Timeline de historico de versoes.

## Evidencias de validacao backend

1. Build da API: OK.
2. Testes policy service: 6/6.
3. Testes rotas insights: 33/33.
4. OpenAPI atualizado com novos endpoints de policy.

## Checklist de aceite frontend da fase

1. Implementar telas/fluxos para os 4 endpoints.
2. Validar tratamento de erro 400/403/404/409 no publish.
3. Validar leitura de policy_source=legacy com policy null.
4. Confirmar que telas atuais de métricas nao mudaram comportamento.

## Gate de encerramento da fase

- revisado_contra_codigo: true
- contrato_openapi_revisado: true
- implementacao_frontend_concluida: pendente
- status_final_fase_2: aguardando aprovacao
