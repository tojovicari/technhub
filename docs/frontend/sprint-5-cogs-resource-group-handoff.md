# Handoff Frontend - Sprint 5 (COGS por Resource Group)

Data de referencia: 2026-06-03
Status do contrato: implementado no backend
Escopo: frontend

## Contexto da Sprint para Frontend

- Iniciativa macro: Replanejamento Recursos + Resource Group.
- Objetivo desta sprint: habilitar leitura de COGS consolidado por Resource Group com rollup no escopo do grupo.
- Modulo alvo (unico): COGS.
- Impacto esperado no frontend: medio.
- Migracao de telas: nova UX de COGS no contexto de Resource Group.
- Risco principal de integracao: continuar exibindo custos somente por projeto isolado em visoes executivas de grupo.
- Acao esperada do frontend nesta sprint: adaptar consultas, cards de custo e filtros para rollup por Resource Group.

## Envelope de resposta

- Sucesso: data preenchido, meta preenchido, error nulo.
- Erro: data nulo, meta preenchido, error com code, message e details opcional.
- Campos de meta esperados: request_id, version, timestamp.

## Autenticacao e escopo

- Todas as rotas exigem autenticacao por Bearer JWT.
- Escopo de tenant e aplicado a partir do token do usuario autenticado.
- Frontend nao deve enviar tenant_id em body/query para este modulo.

## Contratos e permissoes (Sprint 5)

### 1) Rollup COGS por Resource Group

- Metodo e rota: GET /api/v1/cogs/resource-groups/:group_id/rollup
- Permissao: cogs.read
- Path params:
  - group_id: uuid
- Query params:
  - date_from: string YYYY-MM-DD, opcional
  - date_to: string YYYY-MM-DD, opcional
  - group_by: enum category|project|team, opcional (default category)
- Resposta de sucesso: 200
- Erros principais:
  - 400 param/query invalido
  - 401 nao autenticado
  - 403 sem permissao
  - 404 grupo nao encontrado

Formato de data no sucesso:

- resource_group: id, key, name, project_count, team_count
- total_cost, total_hours, cost_per_story_point
- group_by
- breakdown
- entry_count
- filters: date_from, date_to

### 2) Rollup COGS geral (compativel)

- Metodo e rota: GET /api/v1/cogs/rollup
- Permissao: cogs.read
- Query params:
  - project_id: uuid, opcional
  - epic_id: uuid, opcional
  - team_id: uuid, opcional
  - user_id: uuid, opcional
  - date_from: string YYYY-MM-DD, opcional
  - date_to: string YYYY-MM-DD, opcional
  - group_by: enum category|user|project|epic|team, opcional (default category)
- Resposta de sucesso: 200
- Erros principais: 400, 401, 403

## Exemplo de request (rota de grupo)

GET /api/v1/cogs/resource-groups/b2b2a93a-4156-4e60-9e5f-08f7b4f59dc0/rollup?group_by=category&date_from=2026-05-01&date_to=2026-05-31

## Exemplo de response 200

```json
{
  "data": {
    "resource_group": {
      "id": "b2b2a93a-4156-4e60-9e5f-08f7b4f59dc0",
      "key": "payments-platform",
      "name": "Payments Platform",
      "project_count": 3,
      "team_count": 2
    },
    "total_cost": 5200,
    "total_hours": 40,
    "cost_per_story_point": 86.67,
    "group_by": "category",
    "breakdown": {
      "engineering": 5200
    },
    "entry_count": 5,
    "filters": {
      "date_from": "2026-05-01",
      "date_to": "2026-05-31"
    }
  },
  "meta": {
    "request_id": "req_cogs_rg_001",
    "version": "v1",
    "timestamp": "2026-06-03T14:00:00.000Z"
  },
  "error": null
}
```

## Regras de UX

- Sempre exibir estado sem permissao para 403.
- Nao mascarar erro de permissao como estado vazio.
- Exibir cost_per_story_point nulo como sem dados suficientes, nunca como zero.
- Exibir sempre o recorte aplicado de data (date_from e date_to) quando filtro estiver ativo.
- Quando group_by for project ou team, breakdown retorna IDs; frontend deve resolver labels (nome do projeto/time) via cache ou consulta auxiliar.

## Mapeamento de permissoes por papel padrao

- manager: cogs.read
- viewer: cogs.read
- org_admin: acesso total

## Checklist de implementacao frontend

1. Integrar GET /cogs/resource-groups/:group_id/rollup na tela executiva de Resource Group.
2. Atualizar cards de custo para total_cost, total_hours e cost_per_story_point no escopo de grupo.
3. Adicionar filtros date_from/date_to e seletor group_by no contexto do grupo.
4. Implementar estados de loading, vazio e indisponivel para rollup por grupo.
5. Atualizar tipagens e adapters para payload de group rollup.
6. Resolver nomes em breakdown quando group_by for project ou team.
7. Adicionar telemetria de UX para alteracao de filtros e alternancia de group_by no painel COGS por grupo.

## Criterios de aceite (Sprint 5)

- Painel de COGS exibe rollup por Resource Group sem depender de visao por projeto isolado.
- Custos e horas aparecem com consistencia entre cards e detalhamento de breakdown.
- Filtros de periodo e agrupamento funcionam sem quebra de navegacao.
- Estado de dados insuficientes e exibido de forma explicita quando cost_per_story_point for nulo.

## Referencias

- docs/frontend/cogs-api.md
- docs/openapi/cogs-v1.yaml
- docs/resource-group-replan.md
