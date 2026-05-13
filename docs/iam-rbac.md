# IAM — Identidade, Perfis e Controle de Acesso

**Status:** Análise + Plano de Correção (revisado 2026-05-13)  
**Data:** 2026-05-13  
**Módulo:** `apps/api/src/modules/iam/`

---

## 1. Visão Geral

O sistema combina duas camadas de autorização que se **somam** no JWT no momento do login:

```
permissions_jwt = ROLE_PERMISSIONS[role]  ∪  permissionKeys de todos os perfis ativos atribuídos
```

Essas permissões são embutidas como `permissions: string[]` no access token e verificadas em cada request pelo middleware `requirePermission(key)` — **sem consulta ao banco em runtime**.

---

## 2. Camada 1 — `role` (base estática)

Definida diretamente na `PlatformAccount`. Suas permissões base são hardcoded em `apps/api/src/modules/auth/service.ts`:

| Role                       | Permissões base                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_admin`                | `['*']` — acesso total; perfis são ignorados                                                                                                      |
| `manager`                  | `core.read`, `core.write`, `dora.read`, `sla.read`, `cogs.read`, `intel.read`, `integrations.read`, `iam.permission_profile.read`, `billing.read` |
| `viewer`                   | `core.read`, `dora.read`, `sla.read`, `intel.read`, `billing.read`                                                                                |
| `engineer`, `lead`, outros | `[]` — sem permissão base                                                                                                                         |

> Não há UI nem API para alterar quais permissões cada role concede. Mudanças exigem deploy.

---

## 3. Camada 2 — `PermissionProfile` (extensão dinâmica)

Perfis são gerenciados via API pelo tenant. Cada perfil tem um conjunto de `permissionKeys`.  
Um usuário pode ter **vários perfis** atribuídos simultaneamente.

### Modelo de dados

```
PermissionProfile
  id, tenantId, name, description
  permissionKeys: String[]
  isSystem: Boolean       ← perfis built-in; imutáveis via API
  isActive: Boolean       ← perfis inativos não são atribuíveis

UserPermissionProfile
  accountId, permissionProfileId
  grantedBy, grantedAt
  expiresAt: DateTime?    ← expiração opcional
  revokedAt: DateTime?    ← campo existe, mas não é usado (ver gap #2)
  @@unique([accountId, permissionProfileId])
```

### Permission keys disponíveis

| Módulo       | Keys                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core         | `core.team.read`, `core.team.manage`, `core.project.read`, `core.project.manage`, `core.epic.read`, `core.epic.manage`, `core.task.read`, `core.task.write`, `core.user.read`, `core.user.manage` |
| DORA         | `dora.read`, `dora.deploy.ingest`                                                                                                                                                                 |
| SLA          | `sla.template.read`, `sla.template.manage`, `sla.evaluate`                                                                                                                                        |
| COGS         | `cogs.read`, `cogs.write`, `cogs.budget.manage`                                                                                                                                                   |
| Intel        | `intel.read`                                                                                                                                                                                      |
| Integrations | `integrations.read`, `integrations.manage`, `integrations.sync`                                                                                                                                   |
| IAM          | `iam.permission_profile.read`, `iam.permission_profile.manage`, `iam.permission_profile.assign`                                                                                                   |
| Wildcard     | `*`                                                                                                                                                                                               |

---

## 4. Como as duas camadas se relacionam

```
resolvePermissions(accountId, role)   ← chamado no login e no refresh

  1. Busca ROLE_PERMISSIONS[role]
  2. Se inclui '*', retorna imediatamente (org_admin — DB não é consultado)
  3. Busca UserPermissionProfile ativos:
       revokedAt = null
       expiresAt = null  OR  expiresAt > now
       permissionProfile.isActive = true
  4. Extrai permissionKeys de cada perfil ativo
  5. Se algum perfil tem '*', retorna ['*']
  6. Retorna [...new Set([...rolePerms, ...profileKeys])]
  7. Resultado é embutido no JWT como permissions[]
```

### Exemplos práticos

| Role        | Perfis atribuídos                                            | `permissions` no JWT                                  |
| ----------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| `org_admin` | qualquer                                                     | `['*']`                                               |
| `manager`   | nenhum                                                       | base do manager                                       |
| `manager`   | Finance Editor (`cogs.write`, `cogs.budget.manage`)          | base do manager + `cogs.write` + `cogs.budget.manage` |
| `engineer`  | nenhum                                                       | `[]` — **403 em tudo**                                |
| `engineer`  | Developer (`core.task.read`, `core.task.write`, `dora.read`) | exatamente essas 3 chaves                             |
| `viewer`    | Admin Profile (`*`)                                          | `['*']` — wildcard de perfil eleva acesso total       |

---

## 5. Endpoints IAM implementados

Todos protegidos por `authenticate` + `requirePermission`.

| Método | Rota                                      | Permissão                       |
| ------ | ----------------------------------------- | ------------------------------- |
| GET    | `/iam/permission-profiles`                | `iam.permission_profile.read`   |
| POST   | `/iam/permission-profiles`                | `iam.permission_profile.manage` |
| GET    | `/iam/permission-profiles/:id`            | `iam.permission_profile.read`   |
| PATCH  | `/iam/permission-profiles/:id`            | `iam.permission_profile.manage` |
| DELETE | `/iam/permission-profiles/:id`            | `iam.permission_profile.manage` |
| GET    | `/iam/permission-profiles/:id/users`      | `iam.permission_profile.read`   |
| GET    | `/iam/users/:id/permission-profiles`      | `iam.permission_profile.read`   |
| POST   | `/iam/users/:id/permission-profiles`      | `iam.permission_profile.assign` |
| DELETE | `/iam/users/:id/permission-profiles/:pid` | `iam.permission_profile.assign` |

---

## 6. Gaps identificados

---

### Gap 1 — Permissões estáticas no JWT (crítico)

**Problema:** As permissões são resolvidas uma vez no login e gravadas no JWT com TTL de 1h.  
Atribuir ou revogar um perfil não tem efeito imediato — o usuário mantém as permissões antigas até o token expirar ou ser renovado via refresh.

**Impacto:** Revogar acesso de um usuário demora até 60 minutos para fazer efeito real. Em cenários de offboarding ou incidente de segurança, isso é inaceitável.

**Causa raiz:** `requirePermission` lê de `request.user.permissions` (JWT), não do banco.

---

### Gap 2 — `revokedAt` existe mas nunca é preenchido (alto)

**Problema:** O campo `revokedAt` existe no modelo `UserPermissionProfile` e está documentado na API, mas o `DELETE /iam/users/:id/permission-profiles/:pid` faz hard delete da linha — `revokedAt` sempre fica `null`.

**Impacto:** Impossível auditoria de revogações. Sem histórico de quando e por quem um acesso foi removido. Viola o requisito de cálculos auditáveis do projeto.

**Causa raiz:** `service.revokePermissionProfile` usa `prisma.userPermissionProfile.delete()` em vez de `update({ revokedAt: new Date() })`.

---

### Gap 3 — `expiresAt` não enforçado em runtime (médio)

**Problema:** `expiresAt` é verificado somente em `resolvePermissions` no login. Se um token foi emitido enquanto o perfil era válido e o perfil expira durante a validade do token, o usuário continua com acesso até o JWT expirar.

**Impacto:** Atribuições temporárias (ex: acesso de 30 dias) podem vazar por até 1h além do prazo.

**Causa raiz:** Não há revalidação de `expiresAt` durante a vida do token.

---

### Gap 4 — Roles sem perfil default no convite (médio)

**Problema:** `PlatformRole` tem três valores válidos: `org_admin`, `manager`, `viewer`. `org_admin` tem wildcard. `manager` e `viewer` têm permissões base, mas não cobrem todos os módulos (ex: `viewer` não tem `cogs.*`, `integrations.*`, `iam.*`). Não há perfil default atribuído automaticamente ao aceitar convite — o usuário depende de um admin para receber acesso adicional manualmente.

**Impacto:** Usuários convidados com role `viewer` ficam com permissões mínimas até um admin atribuir perfis manualmente.

**Causa raiz:** `registerByInvite` não buscava perfil de sistema correspondente ao role.

---

### Gap 5 — `authorization-policy-v1.yaml` sem implementação (baixo)

**Problema:** O contrato OpenAPI de policy evaluation (`POST /authorization/policies/evaluate`) e route bindings (`GET /authorization/routes/bindings`) existe em `docs/openapi/authorization-policy-v1.yaml`, mas não há módulo correspondente implementado.

**Impacto:** Ferramentas de auditoria e simulação de políticas prometidas no contrato não funcionam. Pode gerar confusão para o frontend que espera esses endpoints.

---

### Gap 6 — `expiresAt` não filtrado nos endpoints de listagem (médio)

**Problema:** `listUserAssignments` e `listProfileUsers` filtram `revokedAt: null` mas **não** filtram `expiresAt > now`. Assignments expirados aparecem como ativos nas respostas dos endpoints `GET /iam/users/:id/permission-profiles` e `GET /iam/permission-profiles/:id/users`.

**Impacto:** O frontend exibe "assignment ativo" para um usuário que, na prática, perdeu a permissão. Admins podem ser enganados ao revisar concessões de acesso.

**Nota:** `resolvePermissions` (chamada no login/refresh) filtra `expiresAt` corretamente — o JWT não contém a permissão expirada. A inconsistência é apenas de _display_ dos endpoints de listagem.

**Causa raiz:** Query `where` em `listUserAssignments` e `listProfileUsers` sem cláusula `OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]`.

---

### Gap 7 — `expiresAt` no passado aceito em assign (baixo)

**Problema:** `POST /iam/users/:id/permission-profiles` aceita `expires_at` com data no passado sem validação. O assignment é criado mas nunca aparece no JWT (já expirado no momento da criação). Com Fix 6, também não apareceria na listagem.

**Impacto:** Admin cria assignment que parece válido mas é imediatamente inútil. Difícil de diagnosticar.

**Causa raiz:** Schema Zod de `assignPermissionProfileSchema` não valida `expires_at > Date.now()`.

---

### Gap 8 — `?include_revoked` prometido mas não implementado (baixo)

**Problema:** A seção de impacto de contratos (Fix 1) documenta que será adicionado `?include_revoked=true` como query param opcional para `GET /iam/users/:id/permission-profiles`. Esse parâmetro não foi implementado.

**Impacto:** Auditores não conseguem ver o histórico de revogações via API. A promessa de auditabilidade documentada no Fix 1 não está totalmente cumprida.

**Causa raiz:** Fix 1 implementou o soft revoke no service mas não expôs o histórico via query param.

---

### Gap 9 — `AUTH_BYPASS` sem guarda de `NODE_ENV` (alto — segurança)

**Problema:** Em `plugins/auth.ts`, `AUTH_BYPASS=true` substitui toda autenticação por um `DEV_USER` hardcoded com `permissions: ['*']`. Não há guarda verificando `process.env.NODE_ENV !== 'production'`.

**Impacto:** Um deploy acidental com `AUTH_BYPASS=true` em produção ou staging exporia **toda a API sem autenticação**. Qualquer requisição teria acesso de `org_admin`.

**Causa raiz:** Falta de verificação de ambiente antes de ativar o bypass.

---

### Gap 10 — Avaliação inconsistente entre `requirePermission` e `evaluatePolicy` (médio)

**Problema:** O middleware `requirePermission(permission)` em `plugins/auth.ts` usa **exact match** (`permissions.includes(permission)`). A função `evaluatePolicy` em `authorization/service.ts` usa **prefix match** — um usuário com `core.read` satisfaz `core.read.something`.

**Impacto:** O endpoint `POST /authorization/policies/evaluate` (Fix 4) pode retornar `allowed: true` para uma ação que o middleware real (`requirePermission`) negaria. A ferramenta de simulação de políticas diverge do enforcement real — undermina a confiança no módulo de autorização.

**Causa raiz:** Duas implementações de avaliação de permissão com semânticas diferentes. `requirePermission` foi escrito para exact match; `evaluatePolicy` adicionou prefix match como "melhoria" sem sincronizar com o middleware.

---

## 7. Plano de correção

### Fix 1 — Soft revoke com `revokedAt` (gap #2) ✅

**Status:** implementado e testado (`apps/api/src/modules/iam/service.test.ts` — 12 testes passando)

**Escopo:** `apps/api/src/modules/iam/service.ts`  
**Mudanças aplicadas:**

- `revokePermissionProfile`: substituído `prisma.userPermissionProfile.delete()` por `update({ data: { revokedAt: new Date() } })` — soft revoke com auditoria completa
- `listUserAssignments`: adicionado `revokedAt: null` no filtro da query — GETs não retornam assignments revogados
- `listProfileUsers`: adicionado `revokedAt: null` no filtro da query — idem

**Comportamento externo:** idêntico ao anterior. O campo `revoked_at` já existia no schema `iam-v1.yaml` (sempre `null` antes). Nenhuma breaking change.

---

### Fix 2 — Perfil default por role no convite (gap #4) ✅

**Status:** implementado e testado (`apps/api/src/modules/auth/service.test.ts` — 6 testes passando)

**Escopo:** `apps/api/src/modules/auth/service.ts`  
**Mudanças aplicadas:**

- `registerByInvite` convertido de `$transaction([])` para `$transaction(async tx => {...})` (callback form)
- Para roles `manager` e `viewer`: busca `PermissionProfile` no tenant com `isSystem: true, isActive: true, name: "{Role} Default"` (ex: `"Viewer Default"`, `"Manager Default"`)
- Se encontrado: cria `UserPermissionProfile` atomicamente dentro da mesma transação
- Se não encontrado: prossegue sem erro — comportamento de fallback gracioso
- `org_admin` é explicitamente excluído (tem wildcard, não precisa de perfil)

**Convenção de nomes dos perfis default:**

| Role      | Nome do perfil sistema esperado |
| --------- | ------------------------------- |
| `manager` | `Manager Default`               |
| `viewer`  | `Viewer Default`                |

> Esses perfis precisam ser criados como `isSystem: true` via seed ou pelo admin da plataforma. Sem o perfil criado, o comportamento é idêntico ao anterior (sem assignment automático).

---

### Fix 3 — Reduzir TTL do access token para 15min (gap #3, opção A) ✅

**Status:** implementado (`apps/api/src/modules/auth/service.ts`)

**Escopo:** `apps/api/src/modules/auth/service.ts` + `routes.test.ts`  
**Mudanças aplicadas:**

- `ACCESS_TOKEN_TTL`: `'1h'` → `'15m'`
- Adicionada constante `ACCESS_TOKEN_TTL_SECONDS = 900` para manter coerência com o campo `expires_in` retornado nas respostas de `/auth/login` e `/auth/refresh`
- Substituídos os `expires_in: 3600` hardcoded nos retornos por `ACCESS_TOKEN_TTL_SECONDS`
- `routes.test.ts` atualizado com o novo valor esperado

**Impacto no contrato:** `expires_in` passa de `3600` para `900` nas respostas de login e refresh. Schema do `auth-v1.yaml` não muda (campo já existe). Frontend precisa ser notificado para ajustar lógica de pré-renovação de token.

---

### Fix 4 — Implementar authorization-policy module (gap #5) ✅

**Escopo:** novo módulo `apps/api/src/modules/authorization/`  
**Contrato:** `docs/openapi/authorization-policy-v1.yaml`  
**Implementado em:**

- `apps/api/src/modules/authorization/schema.ts` — Zod: `PolicyEvaluationRequest`, query params de bindings
- `apps/api/src/modules/authorization/registry.ts` — Registro estático com todos os route bindings do sistema (~45 entradas)
- `apps/api/src/modules/authorization/service.ts` — `evaluatePolicy()` (tenant isolation, role perms + profile perms via DB, any_of/all logic) + `listRouteBindings()` (filtro por módulo)
- `apps/api/src/modules/authorization/routes.ts` — 2 endpoints com `app.authenticate + app.requirePermission('iam.permission_profile.read')`
- `apps/api/src/app.ts` — módulo registrado com `prefix: '/api/v1'`
- `apps/api/src/modules/authorization/service.test.ts` — **13 testes** ✅

**Endpoints entregues:**

- `POST /authorization/policies/evaluate` — avalia `subject` × `required_permissions` × `resource`
- `GET /authorization/routes/bindings` — lista todos os route bindings, filtrável por `?module=`

**Nota:** `PATCH /authorization/routes/bindings/:id` (admin override) omitido — fora do escopo Phase 2 (nenhuma tabela DB de bindings necessária no MVP).

**Dependência:** pós-fix #1 (para ter histórico de revogações confiável).

---

### Fix 5 — `ROLE_PERMISSIONS` como contrato versionado (gap #1 parcial)

**Escopo:** `docs/` + seed  
**Mudança:** mover `ROLE_PERMISSIONS` para tabela de configuração no banco (ou arquivo de configuração versionado), para que mudanças sejam rastreáveis sem deploy.  
**Risco:** alto. Mudança arquitetural — avaliar no contexto da Phase 3+.  
**Bloqueio:** enquanto não implementado, qualquer mudança de role requer manutenção dupla em `auth/service.ts` e `authorization/service.ts` (ver gap #10).

---

### Fix 6 — Filtrar `expiresAt` nos endpoints de listagem (gap #6) ✅

**Escopo:** `apps/api/src/modules/iam/service.ts`

**Implementado em:**

- `listUserAssignments`: adicionado `OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]` no `where`
- `listProfileUsers`: idem
- `apps/api/src/modules/iam/service.test.ts` — **2 novos testes** adicionados (total: 14 passando) ✅
  - `listUserAssignments`: verifica que query inclui filtro de `expiresAt`
  - `listProfileUsers`: idem

**Efeito externo:** assignments expirados deixam de aparecer nos GETs. Additive — não quebra contrato.

---

### Fix 7 — Validar `expiresAt` no futuro ao atribuir perfil (gap #7) ✅

**Escopo:** `apps/api/src/modules/iam/schema.ts`

**Implementado em:**

- `assignPermissionProfileSchema.expires_at` recebe `.refine()`:
  ```ts
  expires_at: z.string()
    .datetime()
    .refine((val) => new Date(val) > new Date(), {
      message: "expires_at must be a future date",
    })
    .optional();
  ```
- `apps/api/src/modules/iam/service.test.ts` — **3 novos testes** adicionados (total: 17 passando) ✅
  - Aceita `expires_at` futuro
  - Rejeita `expires_at` passado com mensagem `'expires_at must be a future date'`
  - Aceita quando `expires_at` omitido

**Efeito externo:** `POST /iam/users/:id/permission-profiles` retorna `400` para `expires_at` no passado. Breaking change de comportamento — antes aceitava e criava silenciosamente.

---

### Fix 8 — Implementar `?include_revoked=true` em listUserAssignments (gap #8) ✅

**Escopo:** `apps/api/src/modules/iam/schema.ts` + `service.ts` + `routes.ts`

**Implementado em:**

- `schema.ts`: novo `listUserAssignmentsQuerySchema` com `include_revoked?: boolean` (transform de enum `'true'|'false'`)
- `service.ts`: `listUserAssignments(userId, tenantId, includeRevoked = false)` — quando `includeRevoked=true` omite os filtros `revokedAt: null` e `OR: expiresAt`
- `routes.ts`: `GET /iam/users/:user_id/permission-profiles` extrai `include_revoked` via `listUserAssignmentsQuerySchema.parse(request.query)` e passa ao service
- `apps/api/src/modules/iam/service.test.ts` — **1 novo teste** adicionado (total: 18 passando) ✅
  - Verifica que `includeRevoked=true` remove os filtros `revokedAt` e `OR` da query

**Efeito externo:** additive — novo query param opcional. Nenhuma breaking change.

---

### Fix 9 — Proteger `AUTH_BYPASS` com guarda de ambiente (gap #9) ✅

**Escopo:** `apps/api/src/plugins/auth.ts`  
**Implementado em:**

- Verificação adicionada no **início de `registerAuth`** (fail-fast no boot, não por request):
  ```ts
  if (
    process.env.AUTH_BYPASS === "true" &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error("AUTH_BYPASS is not allowed in production");
  }
  ```
- `apps/api/src/plugins/auth.test.ts` — **3 novos testes** ✅ (total: 13 passando)
  - Throws on startup quando `AUTH_BYPASS=true` + `NODE_ENV=production`
  - Não lança quando `NODE_ENV=test`
  - Não lança quando `AUTH_BYPASS` não está definido em produção

**Nota sobre abordagem:** optou-se por fail-fast no startup (`registerAuth`) em vez de verificar por request, pois assim a aplicação recusa inicialização com a configuração perigosa — mais seguro e testável.

**Efeito externo:** nenhum em ambientes de desenvolvimento/test. Em produção com `AUTH_BYPASS=true`, app falha ao iniciar.

---

### Fix 10 — Alinhar semântica de avaliação entre `requirePermission` e `evaluatePolicy` (gap #10) ✅

**Escopo:** `apps/api/src/modules/authorization/service.ts`  
**Decisão adotada:** Opção A — remover prefix match de `evaluatePolicy`, alinhando com exact match do middleware.

**Implementado em:**

- `hasPermission` simplificada para espelhar exatamente `requirePermission`:
  ```ts
  // Mirrors the exact-match logic of requirePermission in plugins/auth.ts.
  function hasPermission(effective: Set<string>, required: string): boolean {
    return effective.has("*") || effective.has(required);
  }
  ```
- `apps/api/src/modules/authorization/service.test.ts` — **1 novo teste** adicionado (total: 14 passando) ✅
  - Documenta que `core.read` **não** satisfaz `core.read.specific` (exact match only)

**Efeito:** `POST /authorization/policies/evaluate` agora é uma simulação fiel do enforcement real de rotas. Nenhum `allow` espúrio por prefix matching.

---

## 8. Impacto nos contratos de API

Nenhum fix altera o **schema** dos contratos existentes. Dois fixes têm efeitos colaterais que o frontend precisa conhecer.

---

### Fix 1 — Soft revoke

**Schema:** sem breaking change. O campo `revoked_at` já existe em `UserPermissionProfile` no `iam-v1.yaml` — atualmente sempre `null`.

**Atenção comportamental:** `listUserAssignments` e `listProfileUsers` hoje fazem query **sem filtro de `revokedAt`**. Com hard delete isso é inócuo (linhas deletadas somem). Com soft revoke, sem o filtro, os GETs passariam a retornar assignments revogados — mudança de comportamento sem mudança de schema.

**Solução:** adicionar `revokedAt: null` como filtro padrão em ambas as queries. Comportamento externo fica idêntico ao atual. Para expor histórico de revogações, adicionar query param opcional `?include_revoked=true` — additive, sem breaking change.

---

### Fix 2 — Perfil default no invite

**Sem impacto de contrato.** `POST /auth/register/invite` retorna o mesmo payload. Efeito colateral é somente que o usuário nasce com permissões — transparente para o contrato.

---

### Fix 3A — Reduzir TTL do access token

**Schema:** sem breaking change. O campo `expires_in` já existe no contrato `auth-v1.yaml`.

**Atenção operacional:** o **valor** de `expires_in` muda de `3600` (1h) para `900` (15min). Clientes que usam `expires_in` para calcular pré-renovação do token precisam lidar com renovações mais frequentes. Nada quebra, mas o frontend precisa ser notificado antes do deploy.

---

### Fix 4 — Authorization module

**Puramente additive.** Os endpoints `POST /authorization/policies/evaluate` e `GET /authorization/routes/bindings` são novos. O contrato `authorization-policy-v1.yaml` já existe — a implementação apenas o satisfaz.

---

### Fix 5 — `ROLE_PERMISSIONS` como config

**Sem impacto de contrato.** Mudança interna pura.

---

### Fix 6 — Filtrar `expiresAt` nas listagens

**Schema:** sem breaking change. Assignments expirados não deveriam aparecer — remoção é comportamento corretivo esperado.  
**Atenção:** qualquer UI que dependia de ver assignments expirados nas listagens precisará usar `?include_revoked=true` (Fix 8) como substituto.

---

### Fix 7 — Validação de `expiresAt` no assign

**Breaking de comportamento** (não de schema): `POST /iam/users/:id/permission-profiles` passa a retornar `400` para `expires_at` no passado. Antes aceitava silenciosamente. Documentar no changelog de API antes do deploy.

---

### Fix 8 — `?include_revoked=true`

**Additive.** Novo query param opcional em `GET /iam/users/:id/permission-profiles`. Nenhuma breaking change.

---

### Fix 9 — `AUTH_BYPASS` guarda de ambiente

**Sem impacto de contrato.** Mudança de segurança interna. Ambientes de desenvolvimento não são afetados.

---

### Fix 10 — Alinhar semântica de avaliação

**Sem impacto de contrato de rotas.** Impacto no contrato `authorization-policy-v1.yaml`: o resultado de `POST /authorization/policies/evaluate` passa a ser fiel ao enforcement real. Pode alterar respostas de casos onde prefix match diferia do exact match.

---

### Resumo de contratos

| Fix                           | Quebra contrato?            | Ação necessária antes do deploy                                   |
| ----------------------------- | --------------------------- | ----------------------------------------------------------------- |
| 1 — Soft revoke               | ❌ schema não muda          | Documentar `?include_revoked` (Fix 8)                             |
| 2 — Perfil default            | ❌                          | Nenhuma                                                           |
| 3A — TTL 15min                | ❌ schema não muda          | Comunicar ao frontend: `expires_in` cai de 3600 para 900          |
| 4 — Authorization module      | ❌ additive                 | ✅ Implementado — `authorization-policy-v1.yaml` satisfeito       |
| 5 — Config de roles           | ❌                          | Nenhuma                                                           |
| 6 — `expiresAt` nas listagens | ⚠️ comportamento            | Comunicar: expirados somem das listagens; Fix 8 expõe histórico   |
| 7 — Validar `expiresAt`       | ⚠️ comportamento (400 novo) | Documentar no changelog: `expires_at` no passado → 400            |
| 8 — `?include_revoked`        | ❌ additive                 | Nenhuma                                                           |
| 9 — `AUTH_BYPASS` guard       | ❌                          | Nenhuma                                                           |
| 10 — Alinhar semântica        | ⚠️ evaluate pode mudar      | Comunicar: respostas de `evaluatePolicy` ficam mais conservadoras |

---

## 9. Priorização sugerida

| #   | Fix                                                      | Esforço | Impacto                          | Fase     |
| --- | -------------------------------------------------------- | ------- | -------------------------------- | -------- |
| 1   | Soft revoke (`revokedAt`)                                | pequeno | alto (auditoria)                 | ✅ Done  |
| 2   | Perfil default no invite                                 | médio   | alto (UX pós-onboarding)         | ✅ Done  |
| 3A  | Reduzir TTL do access token                              | mínimo  | médio (mitiga gap #3)            | ✅ Done  |
| 4   | Implementar authorization module                         | médio   | baixo (tooling)                  | ✅ Done  |
| 9   | `AUTH_BYPASS` guarda de `NODE_ENV`                       | mínimo  | crítico (segurança)              | ✅ Done  |
| 10  | Alinhar semântica `requirePermission` × `evaluatePolicy` | pequeno | médio (confiabilidade do módulo) | ✅ Done  |
| 6   | Filtrar `expiresAt` nas listagens                        | pequeno | médio (display correto)          | Phase 2  |
| 7   | Validar `expiresAt` no assign                            | mínimo  | baixo (UX/guard rail)            | Phase 2  |
| 8   | `?include_revoked=true` em listUserAssignments           | pequeno | médio (auditoria completa)       | Phase 2  |
| 3B  | Revalidação de `expiresAt` no middleware                 | alto    | médio                            | Phase 2  |
| 5   | `ROLE_PERMISSIONS` como config versionada                | alto    | estratégico                      | Phase 3+ |
