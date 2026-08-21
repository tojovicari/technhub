# Backlog

Itens levantados mas não priorizados/implementados ainda. Não é spec — quando
um item aqui for pra frente de verdade, o desenho real vai pra
`.spec/spec-engineering-intelligence.md` (fonte da verdade), não fica só
aqui.

## Trial sem cartão de crédito + aviso de trial acabando — feito

**Contexto**: configurando Stripe em produção, decisão de produto de que
trial não deveria exigir cartão de crédito no checkout — só cobrar (ou
pedir cartão) quando o trial de fato terminar. Por padrão, o Stripe
Checkout Session exige cartão mesmo em assinatura com `trial_period_days`
(`payment_method_collection: 'always'` implícito).

**Decisão**: `payment_method_collection: 'if_required'` nos dois pontos
que criam Checkout Session (`createCheckoutSession` — self-service — e
`createEnterpriseCheckoutLink` — link gerado pelo gestor do SaaS), só
quando o plano tem `trialDays > 0` (plano sem trial continua exigindo
cartão como sempre). Junto, `subscription_data.trial_settings.end_behavior.missing_payment_method: 'cancel'`
— dos 3 valores possíveis do SDK (`'cancel' | 'create_invoice' | 'pause'`),
`'cancel'` é o único alinhado com "sem cartão de verdade": os outros dois
ainda tentam cobrar ou esperam cartão aparecer, não é bem "dispensar
cartão". **Sem config nenhuma do lado do Stripe** pra essa parte — são
parâmetros de API puros, diferente do Customer Portal (que exige
configuração salva no Dashboard antes de funcionar).

**Gap achado no processo, corrigido junto**: não existia nenhum aviso —
nem alerta interno, nem e-mail — antes do trial acabar. Sem cartão
exigido, quem nunca cadastra cartão só saberia que perdeu acesso depois
que a assinatura já tinha cancelado sozinha. Novo evento escutado,
`customer.subscription.trial_will_end` (nativo do Stripe, dispara ~3 dias
antes, não configurável do nosso lado) → novo `AlertType`
`billing_trial_ending_soon` (`severity: 'warning'`), resolvido nos dois
desfechos possíveis do trial (`onInvoicePaid` se converteu pra pago,
`onSubscriptionDeleted` se cancelou por falta de cartão) — mesmo padrão
de resolução automática já usado pelos outros 5 tipos de alerta de
billing. **Sem e-mail** — nenhum evento de billing manda notificação
externa hoje (só alerta in-app), ligar isso é decisão maior, deixada de
fora de propósito desta rodada.

## Incidente: regra de time vazia bloqueava organização inteira, sem jeito de desfazer — `DELETE` de `mapping-rules`/`metric-triggers` (feito)

**Contexto**: investigando por que o time "Apólices" (tenant real de
produção) não classificava `TOIL` nem preenchia `started_working_at`/
`completed_at`, apesar de a regra de organização estar certa (`mapping_rules`
com `TOIL` batendo o `issue_type` real do projeto Jira). Achado: o time
tinha uma regra **própria** salva com tudo vazio (`workItemType: []`,
`workflowStates: []`, ...) — pela precedência Time > Organização > Sistema,
**tudo-ou-nada por nível**, isso bloqueava completamente a regra de
organização pra esse time, mesmo ela estando correta. O usuário tentou
"deletar" a regra pela tela do front pra corrigir — não adiantou, porque
**não existia `DELETE` nenhum no backend** pra `mapping_rules`/
`metric_triggers`. O botão "deletar" do front, sem endpoint de verdade pra
chamar, reenviava um `POST` com estrutura vazia — que não resolve nada,
porque "vazio" ainda conta como "este nível tem config própria" pra fins de
precedência. Só zerar a coluna de verdade (`NULL`) faz o nível voltar a
herdar do superior.

**Correção**: 4 rotas novas, simétricas — `DELETE /tenants/:tenantId/mapping-rules`,
`DELETE /tenants/:tenantId/teams/:teamId/mapping-rules`, e o par
equivalente pra `/metric-triggers`. Implementação faz `UPDATE
team_metric_configurations SET rules = NULL` (ou `metric_triggers = NULL`),
**nunca `DELETE FROM`** — a linha pode ainda ser necessária pra guardar a
outra coluna (`rules`/`metric_triggers` são colunas independentes desde a
migration 0043). `204` se removeu, `404` se não havia nada configurado
nesse nível (idempotente). Cada remoção grava uma entrada em
`team_metric_configuration_history` com `snapshot: null` — distingue "regra
removida de propósito" de "regra vazia salva por engano" (que teria
`snapshot: { workItemType: [], ... }`, não `null`), útil pra investigação
futura do mesmo tipo. Ver `docs/reprocessing-guide.md` (deletar regra
também não é retroativo, precisa reprocessar) e front `admin-semantic-config.md`.

**Fora de escopo**: corrigir o botão "deletar" do front pra chamar o
`DELETE` de verdade em vez do `POST` vazio — código do front, documentado
pra eles aplicarem.

## Auto-comparação temporal do DORA — feito; bandas Elite/High/Medium/Low descartadas de propósito

**Contexto**: o front pediu contexto pra interpretar número isolado do DORA
("3.2 deploys/dia — isso é bom?"). Primeira ideia foi replicar as faixas
Elite/High/Medium/Low do relatório DORA. Pesquisando pra pegar os números
certos, descobrimos dois problemas: **o próprio DORA descontinuou esse
modelo no relatório de 2025**, substituído por 7 "arquétipos de time" que
cruzam performance com fatores humanos (burnout, fricção) — dado que não dá
pra derivar só de telemetria, precisa de survey qualitativo que esta
plataforma não coleta e provavelmente nunca vai coletar. E mesmo quando o
modelo de 4 faixas existia, **os números nunca foram fixos** — eram
recalculados todo ano via clusterização estatística do survey daquele ano
(uma fonte usada na pesquisa tinha até erro de transcrição nos limites de
Change Failure Rate). Hardcodar isso repetiria o problema que "Semântica
Flexível" (`CLAUDE.md`) existe pra evitar: uma referência externa tratada
como autoridade fixa, que nem a própria origem trata como fixa.

**Decisão**: em vez de banda contra escala externa, o backend expõe **dado
bruto mais rico** pra comparação do time contra a própria referência
histórica — julgamento de "melhor/pior que a baseline" (que estatística,
qual janela) fica pro front, mesmo espírito de nunca fixar regra de negócio
que pode mudar.

- **`GET /dashboard/dora/history` ganhou `leadTimeForChanges`/`meanTimeToRestore` por ponto** (antes só `deploymentFrequency`/`changeFailureRate`) — reaproveita `queryLeadTime`/`queryMeanTimeToRestore`, já existiam com a mesma assinatura das outras duas, só nunca tinham entrado no loop semanal. Ver `docs/dashboard-api.md`.
- **`configChanges` novo na mesma resposta** — marca quando `mapping_rules`/`metric_triggers` mudou dentro da janela exibida (`TeamMetricConfigHistoryRepository.findChangesInRange`, tabela já existente, sem migration). É anotação de "algo mudou aqui", não afirmação de causa — front decide como visualizar (ex: linha vertical no gráfico).
- **Fora de escopo, de propósito**: anotação de staleness de sync/reconexão de integração (o item de "correlação evento↔métrica" mais ambicioso que o front sugeriu) — exigiria resolver `integrationId → time(s)` via `team_resource_links`, que hoje não tem caminho direto (staleness é por integração, não por registro individual como deploy/incidente). Revisitar se virar pedido real; até lá, `configChanges` cobre só o sinal mais barato e mais preciso (mudança de regra é sempre 100% atribuível a um time/organização, staleness de integração não necessariamente).

## Timeline de eventos manuais — feito; correlação automática descartada de propósito

**Contexto**: extensão direta do item acima. O usuário queria marcar eventos
que não vêm de nenhum provider integrado (desligamento, troca de versão,
reorg, greve...) numa data, pra entender "o que aconteceu ali" ao olhar um
gráfico temporal. Cogitamos correlacionar automaticamente evento↔métrica,
mas a decisão final foi **não correlacionar** — só mostrar o marcador visual
já ajuda, e afirmar causa a partir de coincidência temporal seria o mesmo
erro que já evitamos com as bandas do DORA (ver item acima).

**Decisão**: `timeline_events` é um recurso independente (CRUD próprio,
`POST`/`GET`/`DELETE /tenants/:tenantId/timeline-events`), não um campo
dentro de `/dashboard/dora/history`. Motivo: já existem hoje 3 gráficos
semanais diferentes (`dora/history`, `profile/history`,
`profile/contributors/history`) e mais podem vir — acoplar a um resolveria
só um caso. O front busca os eventos do período uma vez e sobrepõe em
qualquer gráfico com eixo de tempo. Sem categoria/tipo fixo (Semântica
Flexível) — `title`/`description` livres. `team_id NULL` = evento de
organização, aparece em qualquer visão (mesma convenção de
`team_metric_configuration_history`/`configChanges`). RBAC: `ADMIN`/`GESTOR`
criam/apagam, os 3 papéis leem (mesma regra dos outros endpoints de
dashboard). Ver `docs/dashboard-api.md`.

**Fora de escopo, de propósito**: correlação automática (decisão acima);
edição de evento (só criar/apagar — evento errado se recria); categoria/tipo
fixo.

## Timeline consolidada do time — feito (épicos + incidentes + eventos + config changes); membership adiado, gap real

**Contexto**: extensão direta do item acima, a pedido de uma proposta formal
do front (`cto_ai_front/.spec/proposals/team-timeline.md`) — aba "Timeline"
na página do time, juntando tudo que "aconteceu, e quando". A proposta
original pedia 4 fontes novas: épicos com data, incidentes, membership, e um
endpoint consolidado. Decidimos entregar 3 das 4 nesta rodada.

**Decisão — o que foi consolidado, e por quê**: `GET
.../teams/:teamId/profile/timeline` junta eventos manuais
(`timeline-events`), mudança de regra (mesma fonte de `configChanges`),
incidentes e início/fim de épico numa lista só, ordenada por `date`. Métrica
em série (`dora/history`, `profile/history`) ficou de fora de propósito —
formato incompatível com "evento pontual", front compõe as duas no cliente
sem precisar de contrato novo. Sem o consolidado, a tela cresceria uma
chamada paralela por fonte nova adicionada (já seriam 4-5 hoje); consolidado
mantém em 3 chamadas totais pra tela inteira e não cresce mais conforme
fontes futuras entrarem. `GET .../profile/epics` ganhou `startedAt`/
`completedAt` por épico (reaproveitado pelo consolidado, não duplicado) —
`completedAt` só preenche quando **todos** os itens do épico já fecharam,
não é "o último a fechar até agora". Ver `docs/dashboard-api.md`.

**Membership fica de fora — gap real, não corte por prioridade**: hoje não
existe `DELETE`/remoção de membro no produto (`TeamMembershipRepository` só
tem `create`/`update`/leitura, `TeamMembership` não tem `status`/
`removedAt` no schema) — "sair do time" não é uma ação que o backend sabe
fazer ainda. O pedido de histórico de membership da proposta do front
(quem entrou/saiu, e quando) fica **bloqueado** até essa decisão de escopo
maior ser tomada à parte: precisa decidir entre hard delete (perde o
registro de quem já saiu antes de qualquer histórico existir) ou soft
delete com `removedAt`/tabela de auditoria (mesmo espírito de
`team_metric_configuration_history`) — e se essa decisão vem acompanhada de
rastrear também troca de % de alocação/papel (a proposta pergunta isso
também) ou só entrada/saída no primeiro corte. Revisitar quando "remover
membro" virar pedido de produto por si só, não só um pré-requisito da
timeline.

**Fora de escopo, de propósito, no que foi entregue**: rota HTTP separada
pra "incidentes por período" (só existe como método de repositório,
consumido pelo consolidado — expor como rota própria recriaria o problema
de "mais uma chamada" que o consolidado existe pra evitar); qualquer
classificação "melhor/pior" dos itens da timeline (front decide como exibir
cada `type`).

## Retenção de dados por plano — gaps conhecidos

**Contexto**: `plans.data_retention_months` + `RetentionPurgeService`
(`POST /internal/retention/purge`, cron semanal) expurgam dado canônico
mais velho que a retenção do plano + carência (`DATA_RETENTION_GRACE_MONTHS = 3`).
Validado nesta rodada com um tenant descartável isolado (nunca contra dado
real — ver nota abaixo), confirmando: purge scoped corretamente por
`tenant_id`, cascade pra `enriched_*` funciona, `canonical_work_item_status_transitions`
é purgada explicitamente (sem FK, não cascateia sozinha), e o alerta
`data_retention_purge_approaching` dispara/resolve certo.

1. **Cron real nunca disparou.** `.github/workflows/retention-purge.yml`
   existe e segue o mesmo padrão dos outros dois workflows, mas — assim
   como `sync.yml` — nunca rodou contra produção nesta sessão. O
   comportamento da rota (`requireInternalToken`, resposta) foi validado
   só localmente, chamando o serviço direto.
2. **Volume real de expurgo não foi stress-testado.** O teste desta rodada
   usou 1 registro por tabela (5 no total). `PURGE_BATCH_SIZE = 1000` e
   `MAX_PURGE_BATCHES_PER_TABLE` (teto por tabela/execução) são valores
   conservadores sem carga real pra medir contra — mesmo espírito do que já
   está registrado abaixo pra `DATABASE_POOL_MAX`/`SYNC_BATCH_CONCURRENCY`,
   vale reajustar quando houver uma base de tenants de verdade com histórico
   grande acumulado.
3. **Sem trava de segurança contra corte de data absurdo.** Se alguém
   configurar `data_retention_months` muito baixo por engano (ex: `1`) num
   plano com tenants reais vinculados, o próximo cron expurga de verdade,
   sem confirmação/preview antes. Não corrigido nesta rodada — considerar
   um preview ("isso vai apagar N registros de M tenants") antes de uma
   mudança de retenção entrar em vigor, se isso virar risco real de uso.

## Quebra de esforço por épico — gaps conhecidos

**Contexto**: `GET /tenants/:tenantId/teams/:teamId/profile/epics` (Time →
Projeto → Épico → Item) resolve o "pai/container" de 1 salto de cada work
item (`CanonicalWorkItem.parentExternalId`) e sobe a cadeia até achar um
ancestral marcado como fronteira de épico (`epicGrouping` em
`mapping_rules`, ver `src/enrichment/epic-resolver.ts`).

1. **Jira Epic Link clássico (company-managed) — feito.** `JiraProvider`
   agora descobre o custom field via `GET /rest/api/3/field`
   (`schema.custom === 'com.pyxis.greenhopper.jira:gh-epic-link'`, id
   numérico varia por site) na primeira sync de cada integração, cacheado
   em `provider_integrations.epic_link_field_id`/`epic_link_field_resolved`
   (mesmo mecanismo de ida-e-volta do `cursor`, via `SyncContext`/
   `SyncResult.epicLinkFieldId`). `parent` (team-managed) sempre vence
   quando presente; cai pro custom field só quando `parent` é `null`.
   **Não verificado ao vivo** — shape de `GET /rest/api/3/field` assumido
   pela documentação pública da Atlassian; testado só estruturalmente
   (montagem de JQL/URL, precedência `parent` vs. custom field), sem
   credencial real disponível nesta sessão.
2. **Resolução só dentro da mesma integração/projeto.** Se um épico e sua
   story estiverem em projetos Jira diferentes (raro, mas possível), a
   cadeia não resolve — o `parentExternalId` aponta pra um `externalId`
   que só existe no lookup de outra integração, fora do alcance de
   `resolveEpicGroup`. Não corrigido.
3. **Parents órfãos (épico nunca sincronizado, mesmo dentro do mesmo
   projeto) — reconciliação automática implementada.** Causa original: o
   backfill do Jira só varre `DEFAULT_BACKFILL_DEPTH_DAYS = 365` dias por
   `created` (`backfill-window.ts`), depois disso vira sync permanentemente
   incremental por `updated` — um épico maduro e raramente editado nunca
   era sincronizado, mesmo com os filhos sincronizando normalmente
   (confirmado com dado real: 34/34 itens testados, 0 resolveram épico).
   Corrigido via `SyncOrchestrator.reconcileDanglingParents`: toda sync
   bem-sucedida de um provider que implementa `BaseProvider.fetchByExternalIds`
   (Jira, Azure Boards) busca até `MAX_DANGLING_PARENTS_PER_SYNC = 200`
   `parent_external_id`s órfãos (`WorkItemRepository.findDanglingParentExternalIds`)
   diretamente pelo id/key e persiste como work item normal. Autocura ao
   longo de várias syncs, não instantâneo numa execução só — cadeias de
   vários saltos (comum no Azure Boards: Task→Story→Feature→Epic) podem
   levar mais de uma sync pra resolver de vez, decisão deliberada pra
   manter o passo simples. **`fetchByExternalIds`/JQL `key in (...)` do
   Jira agora verificado ao vivo** (rodada seguinte, ver item 5 abaixo) —
   funciona certinho contra o site real. Azure Boards (`workitemsbatch`)
   continua sem verificação ao vivo.
4. **Azure Boards `$expand: 'relations'` não verificado ao vivo** — mesma
   ressalva já registrada pros outros pontos incertos do conector
   (`azure-boards.provider.ts`). Não confirmado se a API realmente devolve
   o link `System.LinkTypes.Hierarchy-Reverse` no formato assumido, nem se
   o id do pai sempre aparece como último segmento numérico da `url`.
5. **Coluna nova sem backfill retroativo (`parent_external_id`, migration
   0054) deixava item antigo preso pra sempre — corrigido com
   `POST .../integrations/:integrationId/resync`.** Achado investigando um
   caso real (tenant Akad, projeto Jira "Emissão & Resseguro"): itens não
   editados no Jira desde antes da migration que criou a coluna nunca eram
   re-tocados por sync incremental (`updated >= since` nunca bate pra item
   parado) — o vínculo existia de verdade na origem
   (confirmado ao vivo: `JiraProvider.fetchByExternalIds` buscou o item
   direto e voltou com `parentExternalId` preenchido), só nunca tinha sido
   re-buscado. `ProviderIntegrationRepository.resetSyncState` zera
   `last_cursor`/`last_synced_at` (só esses dois — não mexe em
   `epic_link_field_id`, já resolvido), fazendo a próxima
   `POST .../sync` cair em modo backfill completo de novo, sem tocar em
   nenhuma lógica de sync existente. Só reseta integração com backfill já
   **terminado** (`last_synced_at IS NOT NULL`) — protege contra reset
   duplicado perder progresso de um backfill forçado ainda em andamento
   (`409` nesse caso). **Validado ao vivo, ponta a ponta, no dev, contra o
   Jira real do tenant Akad**: `resync` → várias `sync` → item antigo
   (`EM-167`) ganhou `parent_external_id` de verdade → reprocessamento →
   `GET .../profile/epics` passou a mostrar o grupo de épico
   corretamente. É o remédio geral pra esse tipo de gap — qualquer coluna
   nova futura que a Enriched Layer precisar vai ter o mesmo problema,
   mesma correção.

## Painel do gestor do SaaS — o que já existe e o que ainda falta

**Contexto**: o painel cross-tenant do gestor do SaaS (autenticação via
allowlist de GitHub, `/{prefix}/tenants` + detalhe + drilldown de
users/teams/integrations, `/{prefix}/plans`, suspender/reativar tenant,
cancelar assinatura, CRUD de plano com Price automático no Stripe) já está
implementado — ver `src/http/routes/admin.routes.ts`,
`src/auth/core/platform-operator-allowlist.ts`, `PLATFORM_OPERATOR_GITHUB_IDS`/
`PLATFORM_ADMIN_ROUTE_PREFIX`. UI real está sendo construída pelo front agora
(`.spec/api-reference/platform-admin.md`).

Pedidos do front, na ordem que eles mesmos sugeriram (cada um pré-requisito
do seguinte):

1. **Drilldown de leitura por tenant — feito.** `GET {prefix}/tenants/:tenantId`
   (detalhe) + `.../users`, `.../teams`, `.../integrations` (reaproveitam os
   mesmos repositórios das rotas tenant-scoped equivalentes, só chamados com
   o `tenantId` da URL em vez de vir do token).
2. **Audit log das ações do painel — feito.** Tabela
   `platform_operator_audit_log` (`db/migrations/0038`, sem RLS — dado da
   plataforma). Toda ação de escrita do painel (`suspend`/`reactivate`/
   `cancel-subscription`/`create`/`update` de plano) grava uma entrada; `GET
   {prefix}/audit-log?tenantId=&limit=` lista. `PlatformOperatorAuditLogRepository`
   (`src/platform-admin/`).
3. **Impersonation (operador "vira" um usuário de um tenant) — feito,
   acesso completo de `ADMIN`.** `POST {prefix}/tenants/:tenantId/impersonate/:userId`
   emite um `AuthTokenPayload` normal com `impersonatedBy` preenchido (TTL
   de 60min, mesmo do token normal — era 15min quando impersonation ainda
   era read-only) e **`systemRole` sempre
   `'ADMIN'`, independente do papel real da pessoa impersonada** (decisão
   revista nesta rodada — começou read-only, virou acesso completo por
   pedido explícito). Reaproveita 100% das rotas tenant-scoped existentes,
   sem duplicar nada. **Compensação obrigatória pela ausência do bloqueio de
   escrita**: `requireAuth` (`src/http/middleware/require-auth.ts`) grava
   `IMPERSONATED_WRITE` no audit log (`metadata: { method, url }`) pra
   **toda** escrita numa sessão impersonada, sem exceção — nenhuma rota
   existente ou futura escapa disso. `POST {prefix}/end-impersonation`
   grava o encerramento deliberado (sem revogar o JWT — TTL curto já limita
   a exposição); "voltar a ser operador" é local no front.
4. **Histórico de sync/enrichment por tenant — feito.** Tabela
   `integration_run_history` (`db/migrations/0039`, RLS por tenant — dado de
   tenant, não de plataforma). Uma linha por execução de sync
   (`SyncOrchestrator.runSyncForIntegration`, tanto `.../sync` manual quanto
   `/internal/sync` do cron — `triggeredBy: 'manual'|'cron'` via
   `SyncContext.triggeredBy`) ou enrichment (`EnrichmentService.runForIntegration`,
   sempre `'manual'` hoje), sucesso ou falha, com `summary` (contagens) e
   `errorMessage` quando aplicável. `IntegrationRunHistoryRepository.record`
   nunca lança (mesmo espírito do `SyncOrchestrator`: falha ao logar não pode
   derrubar a sync/enrichment que já rodou). Leitura: `GET
   /tenants/:tenantId/integrations/:integrationId/run-history` (tenant-scoped)
   e `GET {prefix}/tenants/:tenantId/integrations/:integrationId/run-history`
   (painel do gestor, cross-tenant, mesmo espelho de leitura do resto do
   drilldown).
- **MRR + funil de conversão — feito.** `GET {prefix}/metrics`, ver
  `.spec/api-reference/platform-admin.md`. Sem série temporal ainda (só
  retrato do agora). **Funil de inadimplência/recuperação — feito**:
  `onInvoicePaymentFailed`/`onInvoicePaid` (`billing.service.ts`) agora
  gravam `subscription_history` (`reason: 'payment_failed'`/
  `'payment_recovered'`) na transição de verdade pra/de `past_due` (não em
  toda falha/pagamento repetido do mesmo ciclo) — `funnel.delinquency` no
  `/metrics`. Deixou de ser o gap documentado antes aqui.
5. **Ferramentas de atendimento ao cliente — feito.** 6 gaps fechados numa
   rodada só, todos read-only ou dado de plataforma sem RLS (mesmo padrão
   do resto deste painel):
   - `GET {prefix}/tenants/search?email=` — busca tenant(s) a partir do
     email de um usuário, via `UserEmailDirectoryRepository.findTenantIdsByEmail`
     (índice cross-tenant já existente, antes só usado no login SSO-first).
   - `GET {prefix}/tenants/:tenantId/alerts` — mesmo espelho de leitura do
     resto do drilldown, pros alertas in-app de um tenant.
   - Notas internas de atendimento (`platform_tenant_notes`,
     `db/migrations/0059`, sem RLS — dado do operador, não editável, só
     cria/apaga): `POST`/`GET`/`DELETE {prefix}/tenants/:tenantId/notes[/:noteId]`.
   - `GET {prefix}/tenants/:tenantId/timeline` — funde audit log + billing
     events + alertas + notas numa lista só, ordenada por data
     (`SupportTimelineService.getTimeline`).
   - `Body.reason` **opcional** em `POST .../impersonate/:userId` — vai pro
     `metadata` do `START_IMPERSONATION` no audit log quando presente, sem
     validação de obrigatoriedade (decisão deliberada: não quebra um front
     que ainda não manda corpo nenhum nessa rota).
   - `GET {prefix}/tenants/:tenantId/support-snapshot` — sinais crus de
     saúde do tenant (assinatura, contagem de alertas abertos por tipo, uso
     vs. limite dos 3 recursos, onboarding incompleto), **sem pontuação/
     fórmula inventada** — decisão explícita, mesmo princípio de "Semântica
     Flexível" do resto do projeto (`SupportTimelineService.getHealthSnapshot`).
- **Deletar/arquivar plano** — só `create`/`update` hoje, ainda não pedido.
- **Trocar de plano de um tenant diretamente pelo painel** (sem passar pelo
  checkout normal do tenant) — não pedido ainda.

## Conectores Azure DevOps (Boards/Repos/Pipelines) — construídos sem credencial real, revisitar no primeiro teste ao vivo

**Contexto**: `azure_boards`, `azure_repos` e `azure_pipelines`
(`src/integrations/providers/azure-*`) foram construídos contra a API REST
documentada da Microsoft, sem PAT/org real pra testar — mesmo regime já
aceito hoje pro ArgoCD. `npm run build` limpo e smoke test manual (registro
no `ProviderFactory`, `testConnection` contra org inexistente devolvendo
erro estruturado sem lançar exceção não tratada, `team-resource-links/candidates`
vazio sem erro pra tenant sem dados Azure) já passaram, mas isso não
substitui um teste ao vivo. Três pontos específicos pra revisar assim que
houver credencial real:

1. **`azure_boards`** — não confirmado se o shape de
   `updates[].fields['System.State'].oldValue`/`.newValue` (endpoint
   `_apis/wit/workitems/{id}/updates`) bate com o assumido no mapeamento de
   transições de status; também não confirmado se WIQL no nível da
   organização (sem `WHERE [System.TeamProject] = '...'`) de fato varre
   todos os Projects que o PAT enxerga.
2. **`azure_repos`** — não confirmado se
   `_apis/git/pullrequests/{id}/commits` devolve os commits em ordem
   cronológica ascendente por padrão (usado pra inferir `firstCommitAt`), nem
   o shape exato de `iterations/{id}/changes` usado pra `linesAdded`/
   `linesDeleted`/`changedFiles`. `linesAdded`/`linesDeleted`/`commentsCount`
   ficam sempre `0` de propósito — a API básica de listagem de PR não expõe
   esses campos, e nenhum valor foi inventado.
3. **`azure_pipelines`** — maior incerteza dos três: não confirmado se
   `environmentdeploymentrecords` (`_apis/distributedtask/environments`)
   carrega o SHA do commit ou só metadata do run/pipeline; se não carregar,
   `commitSha` fica sempre `null` (degradação aceitável, não bloqueia o
   resto). Escopo deliberadamente limitado ao paradigma moderno de
   Environments — pipelines clássicos de Release Management
   (`_apis/release/releases`) ficam de fora, gap conhecido documentado no
   docstring do conector.

## Conector Vercel (CI/CD) + resolução de deploy duplicado entre providers — feito

**Contexto**: faltava um conector pra Vercel. Planejando isso, achamos um gap
mais importante: `queryDeploymentFrequencyFromCicdDeploy` (`dashboard.service.ts`)
contava **todo** deploy `PRODUCTION` do time sem filtrar por `provider` — se
um time tivesse duas integrações CI/CD que podem representar o mesmo deploy
de verdade (ex: `github_actions` + `vercel`, já que o app oficial da Vercel
no GitHub também cria um Deployment lá), cada deploy real era contado duas
vezes.

- **`VercelProvider`** (`src/integrations/providers/vercel/vercel.provider.ts`)
  — `GET /v6/deployments`, API REST oficial documentada (diferente do
  Fly.io, ver abaixo). Paginação real via `until` (não "descobre tudo de uma
  vez" como ArgoCD/Azure Pipelines — volume de deploy da Vercel inclui
  preview de PR). `credentials.extra.projectId` opcional (escopado a 1
  projeto) / `extra.vercelTeamId` opcional (conta de time/org da Vercel, não
  confundir com `teamId` da plataforma). `environment` cru, sem
  classificação (`target: production|staging|null`), mesma filosofia do
  resto — quem decide "é produção" é a Enriched Layer.
- **Sem conector dedicado pro Fly.io, decisão deliberada**: a única forma de
  listar releases do Fly.io é uma API GraphQL não-documentada (nem a própria
  Fly garante estabilidade nela — diferente do regime "sem teste ao vivo,
  mas contra REST documentada" já aceito pro ArgoCD/Azure). Como o deploy no
  Fly.io deste próprio tenant já roda dentro de um job do GitHub Actions com
  `environment: production`, o conector `github_actions` já cobre isso via
  GitHub Deployments API — sem precisar de conector novo e frágil.
- **`DeploymentFrequencyTriggerConfig.sourceProviders`** (`metric-trigger-config.types.ts`)
  — time escolhe explicitamente quais providers de CI/CD contam pra
  Deployment Frequency. Sem heurística de dedup por commit SHA (mais frágil,
  mais "mágico") — o time decide. Com só 1 provider distinto presente,
  continua funcionando como sempre, sem exigir config. Com **mais de 1** e
  sem configurar, `deploymentFrequency` vira `{ available: false, reason }`
  em vez de mostrar um número errado, e o scan periódico
  (`POST /internal/alerts/scan-stale`) dispara o alerta
  `deployment_frequency_source_ambiguous` (`AlertRepository.evaluateDeploymentFrequencySourceAmbiguousAlert`,
  `DeploymentRepository.findTeamsWithMultipleProductionProviders`) —
  resolve sozinho quando o time configura ou a ambiguidade deixa de existir.
- **Escopo deliberadamente contido**: só `deploymentFrequency` ganhou o
  filtro/gate. `changeFailureRate` e as contagens cruas de
  `team-profile.service.ts` (`deploymentSuccessRate`, `deploymentsTriggered`
  em contribuidores) têm o mesmo gap de fundo (nenhuma delas filtra por
  `provider`), mas ficam de fora — a matemática da taxa de CFR é mais
  resiliente à duplicação (numerador e denominador inflam proporcionalmente)
  do que uma contagem crua de Deployment Frequency, que fica visivelmente
  2x errada. Revisitar se virar reclamação real.

## Pool de conexões / `/internal/sync` em escala — resolvido, revisitar com número real

**Contexto**: `DATABASE_POOL_MAX` (default 20, `src/database/pool.ts`) e
`SyncOrchestrator.runBatch` em lotes de `SYNC_BATCH_CONCURRENCY = 10`
(`src/integrations/core/sync.orchestrator.ts`) já resolvem o gargalo que
existia antes (pool sem `max`, tudo num `Promise.all` só). Os números (20 e
10) são chutes conservadores sem carga real de produção — vale reajustar
quando houver uma base de tenants de verdade pra medir contra. O cron de
`.github/workflows/sync.yml` continua desligado (só `workflow_dispatch`) por
uma decisão à parte (frequência, não escala) — religar é uma ação separada,
não decorre automaticamente deste fix.

## Vercel: `external_group_key` era o `projectId` opaco, não o nome do projeto — corrigido

**Contexto**: usuário reportou a tela de "vincular time" (candidatos de
`GET .../team-resource-links/candidates?provider=vercel`) mostrando IDs
crus (`prj_1vfLsOVNjHEu3X1liMN4KZuy1D7z`) em vez de nome de projeto — sem
contexto nenhum pra escolher qual projeto é qual. Causa: `VercelProvider`
(`src/integrations/providers/vercel/vercel.provider.ts`) usava
`deployment.projectId` como `externalGroupKey`, diferente de GitHub/Jira/
Linear/ArgoCD, onde esse identificador já é naturalmente legível (nome do
repo, chave do projeto). A Vercel preenche `deployment.name` com o **nome
do projeto** (não um nome de deployment à parte — já era usado assim em
`serviceName` no mesmo arquivo), então a correção foi trocar
`externalGroupKey` pra usar esse campo em vez do `projectId`.

Mesmo trade-off que já existe pro nome de repo do GitHub (também pode ser
renomeado, quebrando um vínculo já feito) — não é uma categoria de risco
nova, é a mesma escolha "identificador legível, não 100% imutável" já
aceita pro resto dos conectores.

**Sem migration/backfill**: não havia nenhum `team_resource_links` de
Vercel ainda em nenhum tenant no momento do fix (confirmado via query
direta), então não existe vínculo velho pra quebrar. Só afeta
`canonical_deployments` já sincronizados **antes** do fix, que ficam com
`external_group_key = projectId` (o valor antigo) até o próximo sync —
como não incrementa `updated_at` de forma que force reprocessamento
automático, um `/resync` (force backfill, `POST .../integrations/:id/resync`,
ver PR #10 desta sessão) nas 2 integrações Vercel já existentes é
recomendado pra deixar o dado histórico consistente com o novo formato,
mas não é bloqueante — o problema só apareceria de fato se alguém tivesse
vinculado um time usando o `projectId` antigo, o que não tinha acontecido.

## Conector incident.io (Incident Management) — construído sem credencial real, revisitar no primeiro teste ao vivo

**Contexto**: novo conector pluggable, mesma categoria (`incident`) e
mesmo alvo canônico (`CanonicalIncident`) do Waroom já existente —
mirror estrutural direto (`src/integrations/providers/incident-io/incident-io.provider.ts`).
Pesquisado contra a documentação pública real da incident.io (fetch dos
docs, não por memória) antes de implementar: autenticação `Authorization:
Bearer <apiKey>`, paginação por cursor (`page_size`+`after`, o `after` é
o `id` do último incidente da página anterior), schema do `Incident`
confirmado (`severity`, `incident_status.category`,
`incident_role_assignments`). Mesmo regime já aceito pra ArgoCD/Azure
Boards/Repos/Pipelines: `npm run build` limpo, e um smoke test contra a
API real da incident.io com uma `apiKey` falsa confirmou que o conector
alcança `api.incident.io` de verdade (`401 Unauthorized` genuíno, não
erro de rede/DNS) — mas isso não substitui um teste com dado real.

Três pontos específicos, genuinamente configuráveis por workspace na
incident.io (não uma lacuna de pesquisa, é como a ferramenta é
desenhada) — a confirmar/ajustar assim que houver credencial real:

1. **Severidade** (`severity.name`) é nome livre por workspace (defaults
   comuns "Minor"/"Major"/"Critical", não "SEV1".."4") — normalizado por
   palavra-chave no nome (`normalizeSeverity`), heurística não verificada
   contra um workspace real. Se não bater, considerar buscar
   `GET /v2/severities` e usar `rank` como fallback (não construído
   ainda).
2. **`resolvedAt` sem campo fixo na API** — incident.io rastreia isso via
   `incident_timestamp_values`, também configurável por workspace (sem
   ID padrão confiável sem uma chamada extra a
   `GET /v2/incident_timestamps` por workspace). Aproximado por
   `updated_at` quando `incident_status.category` já é terminal
   (`learning`/`closed`/`declined`/`canceled`/`merged`), `null` caso
   contrário.
3. **Sem resolução de serviço/time** —
   `serviceName`/`externalTeamId`/`externalTeamName` ficam `null` nesta
   rodada; incident.io modela isso via Catalog/custom fields
   configuráveis, sem um campo fixo equivalente ao `service_id` do
   Waroom. `team-resource-links/candidates?provider=incident_io&resourceType=incident_io_team`
   já está plugado (reaproveitando `IncidentRepository.findUnlinkedExternalTeams`,
   agora genérico por provider — corrigido nesta rodada, antes tinha
   `'waroom'` hardcoded na subquery), só sempre vazio até essa resolução
   ser construída.

`incident_role_assignments` (papel `lead`/`reporter`/`custom`,
confirmado como enum fixo) é mais estruturado que o Waroom (que só tinha
um `userId` cru, formato incerto) — dá pra montar uma identidade
descoberta com nome/email reais, não só o ID.
