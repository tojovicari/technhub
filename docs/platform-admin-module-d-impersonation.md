# Módulo D — Impersonation

> **Status:** 📋 planejado — aguardando implementação  
> **Prioridade:** 🟡 Média  
> **Depende de:** auth plugin (JWT) + billing v1 + Módulo A (listagem de tenants)  
> **Migration necessária:** ✅ sim — nova tabela `ImpersonationAudit`  
> **Contrato de API:** [platform-admin-impersonation-api.md](./frontend/platform-admin-impersonation-api.md)  
> **OpenAPI:** [platform-admin-v1.yaml](./openapi/platform-admin-v1.yaml)

---

## 1. Objetivo

Permitir que `super_admins` gerem um token de curta duração (15 min) para agir como `org_admin` de qualquer tenant sem conhecer a senha do usuário. Útil para suporte técnico, debugging e onboarding assistido.

### Por que não simplesmente usar as credenciais do cliente?

- Privacidade: não se deve conhecer a senha de nenhum usuário
- Auditabilidade: ações feitas via impersonação são rastreadas e separadas das ações do cliente
- Segurança: o token de impersonação tem escopo e TTL restritos

---

## 2. Endpoints a implementar

| Método | Rota                                               | Auth                         | O que faz                                            |
| ------ | -------------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| POST   | `/platform/tenants/:tenant_id/impersonate`         | **super_admin apenas**       | Gera JWT de 15min para agir como org_admin do tenant |
| GET    | `/platform/tenants/:tenant_id/impersonation-audit` | super_admin / platform_admin | Histórico de impersonações do tenant                 |

---

## 3. Arquivos a criar/modificar

```
src/modules/billing/
├── platform-routes.ts         ← adicionar POST /impersonate e GET /impersonation-audit
└── [não precisa de service separado — lógica pequena, pode ficar na rota]

src/plugins/
└── auth.ts                    ← atualizar para detectar is_impersonation e bloquear /platform/*

apps/api/prisma/
└── schema.prisma              ← adicionar model ImpersonationAudit
```

---

## 4. Migration Prisma

```prisma
model ImpersonationAudit {
  id               String    @id @default(uuid())
  initiatedBy      String    // platform account id (super_admin)
  tenantId         String
  impersonatedAs   String    // platform account id do org_admin usado como subject
  reason           String
  tokenIssuedAt    DateTime  @default(now())
  tokenExpiresAt   DateTime
  firstUsedAt      DateTime?
  createdAt        DateTime  @default(now())

  @@index([initiatedBy])
  @@index([tenantId])
  @@index([tokenIssuedAt])
}
```

```bash
npx prisma migrate dev --name add_impersonation_audit
```

---

## 5. Implementação da rota POST `/platform/tenants/:tenant_id/impersonate`

```typescript
// Em platform-routes.ts
app.post(
  "/platform/tenants/:tenant_id/impersonate",
  { preHandler: [app.authenticate, app.requirePlatformRole("super_admin")] }, // apenas super_admin
  async (req, reply) => {
    const { tenant_id } = req.params as { tenant_id: string };
    const parsed = impersonateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          fail(req, "BAD_REQUEST", "Invalid request body", {
            issues: parsed.error.issues,
          }),
        );
    }

    // 1. Buscar org_admin mais antigo e ativo do tenant
    const orgAdmin = await prisma.platformAccount.findFirst({
      where: { tenantId: tenant_id, role: "org_admin", isActive: true },
      orderBy: { createdAt: "asc" },
    });

    if (!orgAdmin) {
      // Verificar se tenant existe
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenant_id },
      });
      if (!tenant)
        return reply
          .status(404)
          .send(fail(req, "NOT_FOUND", "Tenant not found"));
      return reply
        .status(409)
        .send(
          fail(req, "CONFLICT", "No active org_admin found for this tenant"),
        );
    }

    const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // +15 minutos

    // 2. Criar registro de auditoria ANTES de emitir o token
    const audit = await prisma.impersonationAudit.create({
      data: {
        initiatedBy: req.user.sub,
        tenantId: tenant_id,
        impersonatedAs: orgAdmin.id,
        reason: parsed.data.reason,
        tokenExpiresAt,
      },
    });

    // 3. Gerar JWT de impersonação
    const payload = {
      sub: orgAdmin.id,
      tenant_id,
      roles: [orgAdmin.role],
      permissions: ["*"], // org_admin tem permissões totais no tenant
      platform_role: null, // sem acesso a /platform/*
      is_impersonation: true,
      impersonated_by: req.user.sub,
      impersonation_audit_id: audit.id,
    };

    const accessToken = app.jwt.sign(payload, { expiresIn: "15m" });

    return reply.status(201).send(
      ok(req, {
        access_token: accessToken,
        expires_at: tokenExpiresAt.toISOString(),
        impersonated_tenant_id: tenant_id,
        impersonated_as_role: "org_admin",
        audit_id: audit.id,
      }),
    );
  },
);
```

---

## 6. Atualização do plugin de autenticação (`auth.ts`)

Adicionar 2 verificações no handler de validação do JWT:

### 6.1 Bloquear tokens de impersonação em `/platform/*`

```typescript
// Em app.authenticate (após verificar JWT):
if (decoded.is_impersonation && req.url.startsWith("/api/v1/platform/")) {
  return reply
    .status(403)
    .send(
      fail(
        req,
        "FORBIDDEN",
        "Impersonation tokens cannot access platform admin routes",
      ),
    );
}
```

### 6.2 Registrar primeiro uso (fire-and-forget)

```typescript
// Em app.authenticate (após verificar JWT):
if (decoded.is_impersonation && decoded.impersonation_audit_id) {
  // Fire-and-forget: não bloqueia a request nem lança erro
  prisma.impersonationAudit
    .updateMany({
      where: { id: decoded.impersonation_audit_id, firstUsedAt: null },
      data: { firstUsedAt: new Date() },
    })
    .catch(() => {}); // silenciar erro — não crítico
}
```

---

## 7. Bloquear ações sensíveis com token de impersonação

Adicionar guard em rotas que não devem ser executadas via impersonação:

```typescript
// Helper a adicionar em auth.ts:
app.decorate('blockImpersonation', async (req: FastifyRequest, reply: FastifyReply) => {
  if ((req.user as any).is_impersonation) {
    return reply.status(403).send(
      fail(req, 'FORBIDDEN', 'This action cannot be performed via impersonation token')
    );
  }
});

// Uso nas rotas sensíveis:
// POST /auth/change-password
// PATCH /iam/accounts/:id (email, password)
// DELETE /platform/tenants/:id
preHandler: [app.authenticate, app.blockImpersonation, ...]
```

---

## 8. Schema Zod a adicionar (`schema.ts`)

```typescript
export const impersonateSchema = z.object({
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

export const impersonationAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
```

---

## 9. Rota GET `/platform/tenants/:tenant_id/impersonation-audit`

```typescript
app.get(
  "/platform/tenants/:tenant_id/impersonation-audit",
  { preHandler: guard }, // super_admin + platform_admin podem ler
  async (req, reply) => {
    const { tenant_id } = req.params as { tenant_id: string };
    const parsed = impersonationAuditQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return reply.status(400).send(fail(req, "BAD_REQUEST", "Invalid query"));

    const { cursor, limit } = parsed.data;

    // Verificar existência do tenant
    const tenant = await prisma.tenant.findUnique({ where: { id: tenant_id } });
    if (!tenant)
      return reply.status(404).send(fail(req, "NOT_FOUND", "Tenant not found"));

    const records = await prisma.impersonationAudit.findMany({
      where: { tenantId: tenant_id },
      orderBy: { tokenIssuedAt: "desc" },
      take: limit + 1,
      // Cursor correto: Prisma cursor API — UUID v4 não é orderável por tempo,
      // não usar { id: { lt: cursor } } pois UUID ordering ≠ tokenIssuedAt ordering
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Buscar dados do iniciador (email, fullName) para cada record
    const adminIds = [...new Set(records.map((r) => r.initiatedBy))];
    const admins = await prisma.platformAccount.findMany({
      where: { id: { in: adminIds } },
      select: { id: true, email: true, fullName: true },
    });
    const adminMap = Object.fromEntries(admins.map((a) => [a.id, a]));

    const hasMore = records.length > limit;
    const data = hasMore ? records.slice(0, -1) : records;

    return reply.status(200).send(
      ok(req, {
        records: data.map((r) => ({
          id: r.id,
          initiated_by: adminMap[r.initiatedBy]
            ? {
                id: r.initiatedBy,
                email: adminMap[r.initiatedBy].email,
                full_name: adminMap[r.initiatedBy].fullName,
              }
            : { id: r.initiatedBy, email: "(deleted)", full_name: "(deleted)" },
          tenant_id: r.tenantId,
          reason: r.reason,
          token_issued_at: r.tokenIssuedAt.toISOString(),
          token_expires_at: r.tokenExpiresAt.toISOString(),
          first_used_at: r.firstUsedAt?.toISOString() ?? null,
        })),
        next_cursor: hasMore ? data[data.length - 1].id : null,
      }),
    );
  },
);
```

---

## 10. O que o token de impersonação PODE e NÃO PODE fazer

| Ação                                    | Pode? | Por quê                                           |
| --------------------------------------- | ----- | ------------------------------------------------- |
| Acessar `/api/v1/*` (exceto /platform/) | ✅    | Escopo de org_admin normal                        |
| Acessar `/api/v1/platform/*`            | ❌    | Bloqueado no auth plugin                          |
| Alterar senha ou email de uma conta     | ❌    | Bloqueado pelo `blockImpersonation` guard         |
| Gerar outro token de impersonação       | ❌    | `platform_role: null` no payload                  |
| Renovar via refresh token               | ❌    | Não há refresh token emitido                      |
| Deletar o tenant                        | ❌    | Rota de delete de tenant usa `blockImpersonation` |

---

## 11. Acceptance Criteria

- [ ] `POST /impersonate` gera JWT com `is_impersonation: true` e TTL 15min
- [ ] JWT contém `impersonated_by` e `impersonation_audit_id`
- [ ] `ImpersonationAudit` criado antes de emitir o token
- [ ] Token rejeitado com 403 em qualquer `/platform/*`
- [ ] `firstUsedAt` atualizado quando token é usado pela primeira vez
- [ ] `platform_admin` recebe 403 ao tentar impersonar
- [ ] 404 quando tenant não existe
- [ ] 409 quando tenant não tem org_admin ativo
- [ ] `GET /impersonation-audit` lista registros paginados com dados do iniciador
- [ ] Rotas sensíveis (change-password, etc.) bloqueiam token de impersonação com 403

---

## 12. Testes unitários recomendados

```typescript
describe("POST /platform/tenants/:id/impersonate", () => {
  it("gera token com payload correto");
  it("cria ImpersonationAudit antes de retornar");
  it("retorna 403 quando chamado por platform_admin");
  it("retorna 404 quando tenant não existe");
  it("retorna 409 quando não há org_admin ativo");
  it("reason mínima de 10 chars — retorna 400 se menor");
});

describe("Token de impersonação", () => {
  it("retorna 403 ao acessar /platform/*");
  it("registra firstUsedAt no primeiro uso");
  it("não permite change-password");
});
```
