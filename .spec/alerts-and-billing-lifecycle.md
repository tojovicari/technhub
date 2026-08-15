# Alertas In-App, Checkout Enterprise e Retenção de Dados

Parte de [spec-engineering-intelligence.md](./spec-engineering-intelligence.md) (índice) — Seções 1 e 2 (Visão Geral, Ecossistema de Origens) ficam lá; o resto foi quebrado por tópico neste diretório.

### 4.4. Alertas In-App

Sistema de alertas operacionais dentro do produto (não confundir com `src/notifications/`, que é e-mail transacional outbound). Tabela tenant-scoped `alerts`, RLS no mesmo padrão da Seção 4.3, colunas principais:

- `type` (`CHECK`, 13 valores fechados): `sync_stale`, `sync_run_finished`, `integration_reconnect_required`, `billing_past_due`, `billing_subscription_expired`, `billing_subscription_confirmed`, `billing_subscription_cancelled`, `billing_plan_changed_to_free`, `onboarding_incomplete`, `team_without_contributors`, `users_limit_reached`, `teams_limit_reached`, `integrations_limit_reached`.
- `severity` (`CHECK`): `info` | `warning` | `critical`.
- `integration_id` — só preenchido em alertas de sync/reconexão; `ON DELETE CASCADE` de `provider_integrations`.
- `team_id` (`0048_add_onboarding_alerts.sql`) — só preenchido em `team_without_contributors`; `ON DELETE CASCADE` de `teams`. Junto com `integration_id`, forma a chave de dedup/resolução de "alerta aberto" (`(tenant_id, type, integration_id, team_id)`, índice parcial `WHERE resolved_at IS NULL`) — os dois `NULL` identifica o único alerta de nível de tenant (`onboarding_incomplete`).
- `read_at` — estado lido/não-lido é por **tenant**, não por usuário.
- `resolved_at` — `NULL` = alerta aberto; preenchido quando a causa desaparece sozinha. Nunca é apagado (histórico).

Gatilhos (todos disparam via chamada direta de função, sem fila/pub-sub — mesmo estilo do resto do código):

1. **`sync_stale`** — scan periódico (`POST /internal/alerts/scan-stale`, cron a cada ~4h) comparando `provider_integrations.last_synced_at` contra o dia corrente (UTC).
2. **`sync_run_finished`** — todo run de `SyncOrchestrator.runSyncForIntegration` (sucesso ou falha), manual ou em lote.
3. **`integration_reconnect_required`** — `provider_integrations.consecutive_failures` (contador dedicado, já que `status` sozinho volta a `ACTIVE` no próximo sucesso) atinge um limiar fixo em código.
4. **`billing_past_due`** / **`billing_subscription_expired`** — webhooks Stripe `invoice.payment_failed` e `customer.subscription.deleted`, só na transição real (não em retry do webhook).
5. **`onboarding_incomplete`** — mesmo scan de `sync_stale`: tenant sem nenhum time (`teams`) e sem ninguém materializado além do ADMIN bootstrap (`users` count ≤ 1). Nível de tenant, `integration_id`/`team_id` sempre `NULL`.
6. **`team_without_contributors`** — mesmo scan, por time: nenhuma linha em `team_memberships` para aquele `team_id`.
7. **`users_limit_reached`** / **`teams_limit_reached`** / **`integrations_limit_reached`** (`0049_add_resource_limits_to_plans.sql`, `0050_add_limit_alert_types.sql`) — a contagem atual do tenant (`countByTenant`) atinge `plans.max_users`/`max_teams`/`max_integrations` (`NULL` = ilimitado, resolvido via `BillingService.getResourceLimit`). Diferente dos demais, esses três **também bloqueiam com `403`** na hora, em `POST /tenants/:tenantId/users`, `.../teams` e `.../integrations` — o alerta é criado no mesmo momento do bloqueio; o scan periódico só cobre a *resolução* (e a criação proativa de um tenant já acima do limite sem tentativa recente, ex: downgrade). `getResourceLimit` resolve pelo `plan_id` da assinatura, exceto quando `status = 'expired'` — nesse caso resolve pelos limites do plano Free, não do plano pago antigo (uma assinatura `expired` não tem mais Stripe subscription viva por trás; sem esse fallback ela ficaria com os limites do plano pago indefinidamente, já que nada reatribui `plan_id` automaticamente — ver `billing_plan_changed_to_free` abaixo pra correção manual). `past_due`/`cancelled` continuam resolvendo pelo plano atual de propósito (acesso ainda vale durante a graça/até `currentPeriodEnd`).
8. **`billing_subscription_confirmed`** (`0052_add_billing_lifecycle_alert_types.sql`) — todo `checkout.session.completed` (upgrade self-service ou link enterprise, mesmo evento Stripe pros dois — ver Seção sobre `enterprise_checkout_links` abaixo), só na confirmação inicial, não em renovação mensal rotineira.
9. **`billing_subscription_cancelled`** — `BillingService.cancelSubscription` (cancelamento pelo próprio ADMIN via app) ou `customer.subscription.updated` com `cancel_at_period_end` virando `true` sem o app ter iniciado (cancelamento "de surpresa" via Portal do Stripe) — o guard `!current.cancelledAt` já existente nesse handler evita duplicar quando o app já processou o cancelamento primeiro.
10. **`billing_plan_changed_to_free`** (`0053_add_free_plan_alert_type.sql`) — `BillingService.assignFreePlan`, disparado tanto pelo painel do gestor (`POST {prefix}/tenants/:tenantId/assign-free-plan`) quanto pelo self-service do próprio `ADMIN` do tenant (`POST /tenants/:tenantId/billing/downgrade-to-free`). Único caminho pra mover um tenant pra um plano `priceCents: 0` depois da criação — `cancelSubscription`/o webhook `customer.subscription.deleted` nunca reatribuem `plan_id`, então sem essa rota um tenant cancelado/expirado ficava preso no plano pago antigo pra sempre. Ao disparar, resolve `billing_past_due`/`billing_subscription_cancelled`/`billing_subscription_expired` em aberto (não fazem mais sentido depois da troca).
11. **`users_limit_approaching`** / **`teams_limit_approaching`** / **`integrations_limit_approaching`**
    (`0058_add_retention_and_approaching_alert_types.sql`) — irmãos proativos dos 3 alertas do item 7: disparam **antes** do bloqueio de verdade, quando a contagem já passou de `RESOURCE_LIMIT_WARNING_THRESHOLD`
    (80% do teto, `alert.repository.ts`) mas ainda não atingiu o limite. Só o scan periódico dispara (não os 3 pontos síncronos de bloqueio) — é informativo, não protege nada. Resolve nos dois extremos: contagem caiu de novo abaixo de 80%, ou já atingiu o limite de verdade (aí quem assume é o `*_reached` correspondente) — os dois tipos nunca ficam abertos ao mesmo tempo pro mesmo recurso.
12. **`data_retention_purge_approaching`** (`0058_add_retention_and_approaching_alert_types.sql`) — ver Seção 4.4.2 abaixo (Retenção de Dados por Plano).

### 4.4.1. Links de checkout enterprise (`enterprise_checkout_links`)

Rastreamento de conversão dos links de checkout gerados pelo gestor do SaaS (`POST {prefix}/tenants/:tenantId/enterprise-checkout-links`) pra planos enterprise/privados — mesmo mecanismo de Stripe Checkout Session do upgrade self-service (`BillingService.createCheckoutSession`), sem fluxo nenhum fora do Stripe. Tabela tenant-scoped, RLS no mesmo padrão da Seção 4.3. `status` (`CHECK`): `pending` | `paid` | `expired`, atualizado pelos webhooks `checkout.session.completed`/`checkout.session.expired` via `stripe_checkout_session_id` (chave única). TTL da sessão é o default do Stripe (24h, não configurável via API além disso).

### 4.4.2. Retenção de Dados por Plano (`plans.data_retention_months`)

Cada plano pode ter um teto configurável de quantos meses de dado
histórico ele retém (`0057_add_data_retention_to_plans.sql`, `NULL` =
retenção ilimitada, mesma convenção dos 3 tetos de recurso já
existentes — sem seed, configurado pelo gestor do SaaS via
`PATCH {prefix}/plans/:planId`). **Retenção só governa quando o expurgo
acontece — não filtra visibilidade em dashboards antes disso.** Dado
continua 100% consultável normalmente até ser fisicamente apagado
(decisão deliberada: escopo menor, nenhuma query de dashboard existente
foi alterada).

**Corte de expurgo** = `agora - (dataRetentionMonths + DATA_RETENTION_GRACE_MONTHS)`,
onde `DATA_RETENTION_GRACE_MONTHS = 3` é uma constante global (não
configurável por plano — decisão confirmada: mais simples de explicar pro
cliente, "seu dado some N meses depois do limite do seu plano, sempre").
`BillingService.getDataRetentionPurgeCutoff`/`getDataRetentionWarningCutoff`
resolvem os dois cortes (expurgo de verdade vs. "cruzou a retenção, ainda
na carência") pelo mesmo `resolvePlan` reaproveitado por `getResourceLimit`.

**`RetentionPurgeService`** (`src/retention/`) roda via
`POST /internal/retention/purge` (`requireInternalToken`, mesmo padrão de
`/internal/sync`/`/internal/alerts/scan-stale`), cron semanal
(`.github/workflows/retention-purge.yml`). Por tenant: apaga em lotes
(`PURGE_BATCH_SIZE = 1000`, teto de `MAX_PURGE_BATCHES_PER_TABLE` iterações
por tabela — autocura ao longo de várias execuções em vez de um primeiro
expurgo caro) de `canonical_work_items`, `canonical_pull_requests`,
`canonical_incidents`, `canonical_deployments` e
`canonical_work_item_status_transitions`, pela data "quando aconteceu" de
cada uma (`created_at`/`opened_at`/`triggered_at`/`started_at`/`transitioned_at`
respectivamente). `enriched_work_items`/`enriched_deployments`/
`enriched_incidents` somem sozinhos via `ON DELETE CASCADE` — só
`canonical_work_item_status_transitions` precisa de purge explícito
próprio (correlaciona com `canonical_work_items` por chave natural, sem
FK, ver Seção 5). Dispara `data_retention_purge_approaching` (item 12 da
lista de gatilhos acima) quando sobra dado na janela de carência (cruzou a
retenção, ainda não expurgado) — a mesma execução que decide expurgar já
sabe disso, sem scan separado.

Referência completa da API (endpoints, exemplos, limitações): `docs/alerts-api.md`.

