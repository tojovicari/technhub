# Deploy Strategy — Fly.io

## Visão Geral

O n_back roda como **monolito** no Fly.io: um único app Node.js + Fastify, banco Postgres gerenciado pelo Fly. Este app **substitui o `technhub`** (produto anterior, mesmo Fly.io, mesma conta) — o app e o banco antigos foram recriados do zero pra este projeto (schema completamente diferente: SQL puro + migration runner próprio, não mais Prisma).

Diferente do `technhub`, este projeto **não roda um passo de build/compilação** — `tsx` executa o TypeScript diretamente em produção, o mesmo jeito que já roda em dev (`tsx watch`). `npm run build` existe só como gate de type-check (`tsc --noEmit`), não gera artefato consumido no runtime.

Esta estratégia cobre:

- Infraestrutura mínima (Fase 1)
- Configuração de secrets
- Migrations no deploy
- Health checks
- Rollback

---

## Recursos Fly.io

| Recurso  | Tipo                     | Nome         |
| -------- | ------------------------ | ------------ |
| App      | `fly apps`               | `cto-ai-api` |
| Postgres | `fly postgres` (managed) | `cto-ai-db`  |
| Secrets  | `fly secrets`            | —            |

> Em Fase 1 usa **1 machine** (shared-cpu-1x, 512MB RAM). Escalar para 2+ machines quando necessário.

---

## Arquivos de Deploy

### `Dockerfile` (raiz do projeto — sem monorepo, sem Prisma)

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

> `npm ci` inclui `devDependencies` de propósito — `tsx` é dependency real de runtime (moveu de `devDependencies`), mas `typescript` continua só sendo usado por `npm run build` (type-check, não roda em produção). Sem multi-stage: não há artefato compilado a copiar entre estágios.

---

### `fly.toml`

```toml
app            = "cto-ai-api"
primary_region = "gru"

[env]
  PORT                        = "3000"
  NODE_ENV                    = "production"
  FRONTEND_URL                = "https://app.moasy.tech"
  PUBLIC_API_URL              = "https://cto-ai-api.fly.dev"
  GITHUB_OAUTH_CALLBACK_URL   = "https://cto-ai-api.fly.dev/auth/github/callback"
  AUTH_DEFAULT_LOGIN_PROVIDER = "github"
  NOTIFICATION_EMAIL_PROVIDER = "resend"

[deploy]
  release_command = "npm run migrate"

[http_service]
  internal_port       = 3000
  force_https         = true
  auto_stop_machines  = true
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type       = "connections"
    hard_limit = 500
    soft_limit = 400

[[vm]]
  size   = "shared-cpu-1x"
  memory = "512mb"

[checks]
  [checks.health]
    grace_period  = "10s"
    interval      = "15s"
    method        = "GET"
    path          = "/health"
    port          = 3000
    timeout       = "5s"
    type          = "http"
    restart_limit = 3
```

> A rota `/health` retorna `200 { "status": "ok" }` — implementada em `src/http/server.ts`. Só confirma que o processo está de pé, não checa dependências (Postgres etc.).

> Se um domínio próprio (ex: `api.moasy.tech`) for configurado depois, atualizar `PUBLIC_API_URL` e `GITHUB_OAUTH_CALLBACK_URL` — e o callback registrado no GitHub OAuth App.

---

## Migrations no Deploy

A estratégia usa **release command** do Fly.io: antes de substituir as machines, o Fly roda `npm run migrate` (= `tsx db/migrate.ts`), que aplica qualquer arquivo em `db/migrations/` ainda não registrado em `schema_migrations`. Se falhar, o deploy é abortado antes de subir tráfego — mesmo mecanismo do `migrate:status`/`migrate:baseline` usados em dev.

---

## Secrets (variáveis sensíveis)

Nunca colocar secrets no `fly.toml`. Sempre setar via CLI:

```sh
fly secrets set \
  DATABASE_URL="postgresql://..." \
  AUTH_JWT_SECRET="..." \
  INTEGRATION_ENCRYPTION_KEY="..." \
  GITHUB_OAUTH_CLIENT_ID="..." \
  GITHUB_OAUTH_CLIENT_SECRET="..." \
  RESEND_API_KEY="..." \
  RESEND_FROM_EMAIL="..." \
  STRIPE_SECRET_KEY="..." \
  STRIPE_WEBHOOK_SECRET="..." \
  INTERNAL_SYNC_TOKEN="..." \
  --app cto-ai-api
```

Para rotacionar um secret:

```sh
fly secrets set AUTH_JWT_SECRET="novo-valor" --app cto-ai-api
```

O Fly redeploya automaticamente após `fly secrets set`.

### Referência de secrets obrigatórios

| Secret                       | Obrigatório | Descrição                                                                                                                     |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                | ✅          | Connection string do Postgres (preenchida automaticamente via `fly postgres attach`)                                          |
| `AUTH_JWT_SECRET`             | ✅          | Chave de assinatura dos JWTs de acesso (mínimo 32 chars, aleatório)                                                           |
| `INTEGRATION_ENCRYPTION_KEY`  | ✅          | Chave usada por `pgp_sym_encrypt`/`pgp_sym_decrypt` pra criptografar credenciais de integrações no banco (32 chars, aleatório) |
| `GITHUB_OAUTH_CLIENT_ID`      | ✅          | Client ID do GitHub OAuth App usado pro social login                                                                          |
| `GITHUB_OAUTH_CLIENT_SECRET`  | ✅          | Client Secret do mesmo GitHub OAuth App                                                                                       |
| `RESEND_API_KEY`              | ✅          | API key do Resend (envio de e-mail — convites, etc.)                                                                          |
| `RESEND_FROM_EMAIL`           | ✅          | Remetente usado nos e-mails enviados via Resend                                                                               |
| `STRIPE_SECRET_KEY`           | ✅          | Chave secreta do Stripe (`sk_live_...` em produção)                                                                           |
| `STRIPE_WEBHOOK_SECRET`       | ✅          | Signing secret do endpoint de webhook do Stripe (Dashboard → Webhooks)                                                        |
| `INTERNAL_SYNC_TOKEN`         | ✅          | Segredo compartilhado do scheduler de sync (`POST /internal/sync`, header `X-Internal-Token`) — mesmo valor precisa estar setado como secret do repositório no GitHub (`gh secret set INTERNAL_SYNC_TOKEN`), usado pelo `.github/workflows/sync.yml` |

**Diferença importante em relação ao `technhub`**: este projeto não recebe webhooks de GitHub/Jira/incident tools — a ingestão é sempre por *batch assíncrono* (`POST .../integrations/:id/sync`), não em tempo real (Princípio 2 do CLAUDE.md). Não há `GITHUB_WEBHOOK_TOKEN`/`JIRA_WEBHOOK_TOKEN`/`INCIDENT_IO_WEBHOOK_TOKEN`/`OPSGENIE_WEBHOOK_TOKEN` aqui — o único webhook real é o do Stripe (billing). O disparo periódico desses batches é o `.github/workflows/sync.yml` (agendado, a cada 10 minutos) chamando `POST /internal/sync` — não depende mais de alguém clicar em "sincronizar" manualmente pra os dados avançarem.

---

## Postgres Fly Managed

```sh
# Criar o cluster Postgres
fly postgres create --name cto-ai-db --region gru --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 10

# Conectar ao app (seta DATABASE_URL automaticamente)
fly postgres attach cto-ai-db --app cto-ai-api
```

> O volume de 10GB é suficiente para MVP. Monitorar uso e escalar conforme crescimento.

**Backup:** habilitado por padrão no Fly Postgres managed. Verificar política de retenção (`fly postgres config show --app cto-ai-db`).

---

## Primeiro Deploy (passo a passo)

```sh
# 1. Login
fly auth login
fly auth whoami   # confirmar conta autenticada

# 2. Criar o app (se ainda não existir)
fly apps create cto-ai-api --org personal

# 3. Criar e anexar Postgres
fly postgres create --name cto-ai-db --region gru \
  --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 10
fly postgres attach cto-ai-db --app cto-ai-api

# 4. Setar secrets restantes (ver tabela acima)
fly secrets set \
  AUTH_JWT_SECRET="$(openssl rand -hex 32)" \
  INTEGRATION_ENCRYPTION_KEY="$(openssl rand -hex 16)" \
  GITHUB_OAUTH_CLIENT_ID="..." \
  GITHUB_OAUTH_CLIENT_SECRET="..." \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="no-reply@moasy.tech" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  --app cto-ai-api

# Nota: STRIPE_WEBHOOK_SECRET em produção deve ser o Signing Secret do endpoint
# registrado no Stripe Dashboard (Developers → Webhooks → seu endpoint)

# 5. Deploy
fly deploy --app cto-ai-api

# 6. Verificar
fly status --app cto-ai-api
fly logs --app cto-ai-api
curl https://cto-ai-api.fly.dev/health
```

---

## Deploy Contínuo (GitHub Actions)

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    name: Deploy to Fly.io
    runs-on: ubuntu-latest
    concurrency: deploy-production # evita deploys paralelos

    steps:
      - uses: actions/checkout@v4

      # `superfly/flyctl-actions/setup-flyctl@master` parou de exportar o
      # PATH corretamente pro passo seguinte — instala direto via script
      # oficial em vez de depender do addPath da action de terceiros.
      - name: Install flyctl
        run: |
          curl -L https://fly.io/install.sh | sh
          echo "$HOME/.fly/bin" >> "$GITHUB_PATH"

      - name: Deploy
        run: fly deploy --remote-only --app cto-ai-api
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**Secrets GitHub necessários:**

| Secret               | Como obter                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `FLY_API_TOKEN`      | `fly tokens create deploy --expiry 8760h --app cto-ai-api`                                     |
| `INTERNAL_SYNC_TOKEN` | Mesmo valor setado como secret do Fly (`openssl rand -hex 32`) — usado pelo `sync.yml`, não pelo `deploy.yml` |

---

## Rollback

```sh
# Ver histórico de releases
fly releases --app cto-ai-api

# Rollback para versão anterior
fly deploy --image <image-id> --app cto-ai-api
```

> Atenção: se a versão anterior usava um schema de banco diferente (migration mais nova já aplicada), o rollback pode falhar. `db/migrate.ts` é forward-only — não há rollback automático de schema, planejar separadamente.

---

## Monitoramento

```sh
# Logs em tempo real
fly logs --app cto-ai-api

# Métricas (CPU, memória, requests)
fly dashboard --app cto-ai-api   # abre no browser

# Acessar Postgres diretamente
fly postgres connect --app cto-ai-db
```

---

## Checklist de Deploy

- [ ] `fly.toml` atualizado e commitado
- [ ] Secrets setados (`fly secrets list --app cto-ai-api`)
- [ ] `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` com valores de **produção**
- [ ] Endpoint de webhook registrado no Stripe Dashboard apontando para `https://cto-ai-api.fly.dev/webhooks/billing/stripe`
- [ ] GitHub OAuth App com o callback de produção registrado (`GITHUB_OAUTH_CALLBACK_URL`)
- [ ] Migrations validadas antes de produção
- [ ] `/health` retornando 200
- [ ] `FLY_API_TOKEN` válido nos secrets do GitHub Actions
