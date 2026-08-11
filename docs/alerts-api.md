# API de Alertas — referência pro time de front

Documenta o sistema de alertas **in-app** (sem e-mail): uma lista de eventos operacionais por tenant — sync desatualizada, sync concluída, integração precisando reconexão, problemas de cobrança, dois alertas de onboarding (workspace vazio, time sem contribuidores) e três alertas de limite de plano (usuários, times, integrações) — pensada pra alimentar um sino de notificações na UI.

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
    "teamId": null,
    "metadata": { "planId": "a1b2...", "pastDueSince": "2026-08-10T12:00:00.000Z" },
    "readAt": null,
    "resolvedAt": null,
    "createdAt": "2026-08-10T12:00:01.000Z"
  },
  {
    "id": "7d3e1a80-...",
    "tenantId": "c94be6fb-9a26-488a-a624-fb2c891c1168",
    "type": "team_without_contributors",
    "severity": "info",
    "title": "Time sem contribuidores",
    "message": "O time \"Plataforma\" ainda não tem nenhum contribuidor cadastrado. Adicione membros a esse time para que as métricas dele comecem a ser calculadas.",
    "integrationId": null,
    "teamId": "f67b8639-...",
    "metadata": { "teamId": "f67b8639-...", "teamName": "Plataforma" },
    "readAt": null,
    "resolvedAt": null,
    "createdAt": "2026-08-11T08:00:00.000Z"
  }
]
```

### Campos

- **`type`** — um de `sync_stale`, `sync_run_finished`, `integration_reconnect_required`, `billing_past_due`, `billing_subscription_expired`, `onboarding_incomplete`, `team_without_contributors`, `users_limit_reached`, `teams_limit_reached`, `integrations_limit_reached`.
- **`severity`** — `info` | `warning` | `critical`.
- **`integrationId`** — só preenchido em `sync_stale`/`integration_reconnect_required`. Nesses dois tipos, **use esse valor pra disparar a ação do alerta** (ver seção abaixo).
- **`teamId`** — só preenchido em `team_without_contributors`. Use pra linkar direto pro time (ex: `GET /tenants/:tenantId/dashboard/dora?teamId=...` ou a tela de membros do time) — não tem endpoint de ação associado, é só um ponteiro.
- **`onboarding_incomplete`** é o único tipo tenant-level de verdade: `integrationId` e `teamId` sempre `null`.
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

`onboarding_incomplete`, `team_without_contributors` e os três `*_limit_reached` **não têm ação associada** — são só um empurrão pra UI (texto estilo tutorial em `message`), resolvidos sozinhos quando o time é criado/ganha membro, alguém é convidado, ou (pros de limite) o plano é ampliado ou recursos são removidos.

**`users_limit_reached` / `teams_limit_reached` / `integrations_limit_reached`**: diferente dos outros, esses três também causam um **`403` na hora**, não só o alerta — `POST /tenants/:tenantId/users`, `POST /tenants/:tenantId/teams` e `POST /tenants/:tenantId/integrations` bloqueiam a criação assim que a contagem atual do tenant atinge `plans.maxUsers`/`maxTeams`/`maxIntegrations` (`null` = ilimitado). O corpo do `403` é `{ "error": "Limite de <recurso> do plano atingido (N). Faça upgrade para <ação>." }` — a UI pode mostrar esse texto direto ou tratar o `403` como sinal pra abrir o fluxo de upgrade.

## Limitações conhecidas

| Comportamento | Detalhe |
| --- | --- |
| Staleness não é tempo real | Os alertas `sync_stale`, `onboarding_incomplete`, `team_without_contributors` e os três `*_limit_reached` nascem/resolvem no mesmo scan agendado (a cada ~4h) — exceto a **criação** dos `*_limit_reached`, que também acontece na hora, junto do `403` (ver seção anterior). A resolução (plano ampliado, recurso removido) sempre depende do próximo scan, sem monitor contínuo. |
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
| `403` | Fora das rotas de alerta: `POST /tenants/:tenantId/users`, `.../teams` ou `.../integrations` devolvem isso (com o mesmo `evaluateResourceLimitAlert` criando o `*_limit_reached` correspondente) quando o tenant atinge o teto de recursos do plano — ver "Como disparar a ação" acima. |
| `404` | `alertId` não existe (ou não pertence a este tenant) em `PATCH .../read`. |
