# API de Alertas — referência pro time de front

Documenta o sistema de alertas **in-app** (sem e-mail): uma lista de eventos operacionais por tenant — sync desatualizada, sync concluída, integração precisando reconexão e problemas de cobrança — pensada pra alimentar um sino de notificações na UI.

**Não confundir com `src/notifications/`** — aquele módulo existe há mais tempo e é outra coisa: e-mail transacional outbound (hoje só convite de usuário), sem nenhuma relação com o que está documentado aqui.

## Autenticação

Todo endpoint aqui exige `Authorization: Bearer <accessToken>` (o mesmo token retornado no login). Sem token válido: `401`. Token de um tenant diferente do `:tenantId` da URL: `403`.

**RBAC**: só `ADMIN`/`GESTOR` acessam — mesma restrição de `integrations`/`billing`, já que agir num alerta (reconectar integração, resolver cobrança) exige um desses dois papéis.

---

## `GET /tenants/:tenantId/alerts`

Lista os alertas do tenant, mais recentes primeiro.

### Query params

| Nome     | Formato               | Obrigatório | Default |
| -------- | ---------------------- | ----------- | ------- |
| `unread` | `"true"` (string literal) | Não     | lista todos (lidos e não-lidos) |
| `limit`  | inteiro (1–200)        | Não         | 50 (`400` fora do intervalo, mesmo padrão de `GET {prefix}/audit-log`) |

### Exemplo de request

```
GET /tenants/c94be6fb-9a26-488a-a624-fb2c891c1168/alerts?unread=true
Authorization: Bearer <accessToken>
```

### Exemplo de resposta (real, capturado em teste)

```json
[
  {
    "id": "9c1a2e40-...",
    "tenantId": "c94be6fb-9a26-488a-a624-fb2c891c1168",
    "type": "sync_stale",
    "severity": "warning",
    "title": "Sincronização desatualizada",
    "message": "A integração \"github\" não sincroniza com sucesso desde 2026-08-09T03:00:00.000Z.",
    "integrationId": "7f2c1e10-...",
    "metadata": { "provider": "github", "lastSyncedAt": "2026-08-09T03:00:00.000Z" },
    "readAt": null,
    "resolvedAt": null,
    "createdAt": "2026-08-11T04:00:00.000Z"
  },
  {
    "id": "3b7d9f20-...",
    "tenantId": "c94be6fb-9a26-488a-a624-fb2c891c1168",
    "type": "billing_past_due",
    "severity": "critical",
    "title": "Pagamento falhou",
    "message": "O pagamento da assinatura falhou. Regularize a cobrança para evitar suspensão do acesso.",
    "integrationId": null,
    "metadata": { "planId": "a1b2...", "pastDueSince": "2026-08-10T12:00:00.000Z" },
    "readAt": null,
    "resolvedAt": null,
    "createdAt": "2026-08-10T12:00:01.000Z"
  }
]
```

### Campos

- **`type`** — um de `sync_stale`, `sync_run_finished`, `integration_reconnect_required`, `billing_past_due`, `billing_subscription_expired`.
- **`severity`** — `info` | `warning` | `critical`.
- **`integrationId`** — `null` pros dois tipos de billing (não ligados a uma integração). Nos tipos `sync_stale` e `integration_reconnect_required`, **use esse valor pra disparar a ação do alerta** (ver seção abaixo).
- **`metadata`** — formato livre por `type`, pensado pra debug/detalhe na UI, não pra lógica de negócio (não confiar em campos além dos documentados acima).
- **`readAt`** — `null` = não lido. Estado é **por tenant, não por usuário**: qualquer ADMIN/GESTOR que marcar como lido, marca pra todo mundo.
- **`resolvedAt`** — `null` = alerta aberto (a causa ainda existe). Preenchido = a causa desapareceu sozinha (sync voltou a rodar, integração voltou a sincronizar, cobrança foi regularizada). Um alerta resolvido continua na lista (histórico), só some do filtro `?unread=true` se também estiver lido.

---

## `PATCH /tenants/:tenantId/alerts/:alertId/read`

Marca um alerta como lido. Idempotente (chamar de novo num já lido não dá erro). `204`, sem corpo. `404` se o alerta não existir neste tenant.

## `PATCH /tenants/:tenantId/alerts/read-all`

Marca todos os alertas não-lidos do tenant como lidos. `204`, sem corpo.

---

## Como disparar a ação de um alerta `sync_stale` / `integration_reconnect_required`

Não existe endpoint de ação dedicado — use o `integrationId` do alerta para chamar o endpoint de sync que já existe:

```
POST /tenants/:tenantId/integrations/:integrationId/sync
Authorization: Bearer <accessToken>
```

Um sync bem-sucedido resolve automaticamente qualquer alerta `sync_stale`/`integration_reconnect_required` aberto pra essa integração — não é preciso chamar nada além do sync.

## Limitações conhecidas

| Comportamento | Detalhe |
| --- | --- |
| Staleness não é tempo real | O alerta `sync_stale` nasce de um scan agendado (a cada ~4h), não de um monitor contínuo — pode levar até esse intervalo pra aparecer/sumir. |
| "Hoje" é UTC, não o fuso do tenant | O scan compara `last_synced_at` contra a data UTC corrente, não o fuso horário do tenant. |
| `sync_run_finished` pode ser barulhento | Dispara em **todo** run de sync, inclusive os do disparo em lote/cron — considerar agrupar/filtrar na UI se o volume incomodar. |
| `limit` corta a resposta, não o total de não-lidos | O cap (`?limit=`) limita quantos alertas voltam nessa chamada, não quantos existem — um tenant com muito alerta acumulado pode ter mais não-lidos do que o `limit` mostra. Não é paginação de cursor de verdade (sem `?cursor=`/`?offset=`), só um teto. |
| Leitura é por tenant | Não existe estado "lido" por usuário — é uma lista compartilhada entre todo ADMIN/GESTOR do tenant. |
| Cancelamento pelo próprio ADMIN não gera alerta | Só eventos "surpresa" via webhook do Stripe (pagamento falhou, assinatura expirou) alertam — um cancelamento feito na UI pelo próprio ADMIN não. |

## Erros

| Status | Quando |
| --- | --- |
| `400` | `limit` (`GET .../alerts`) não é um inteiro entre 1 e 200. |
| `401` | Token ausente/inválido/expirado. |
| `403` | Token válido, mas de um tenant diferente do `:tenantId` da URL, ou usuário `USUARIO` (sem `ADMIN`/`GESTOR`). |
| `404` | `alertId` não existe (ou não pertence a este tenant) em `PATCH .../read`. |
