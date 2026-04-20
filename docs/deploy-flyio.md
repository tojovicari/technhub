# Deploy Strategy — Fly.io

## Visão Geral

O moasy.tech roda como **monolito modular** no Fly.io: um único app Node.js + Fastify com todos os módulos no mesmo processo, banco Postgres gerenciado pelo Fly.

Essa estratégia cobre:

- Infraestrutura mínima (Fase 1)
- Configuração de secrets
- Migrations no deploy
- Health checks
- Rollback

---

## Recursos Fly.io

| Recurso  | Tipo                     | Nome sugerido |
| -------- | ------------------------ | ------------- |
| App      | `fly apps`               | `cto-ai-api`  |
| Postgres | `fly postgres` (managed) | `cto-ai-db`   |
| Secrets  | `fly secrets`            | —             |

> Em Fase 1 usa **1 machine** (shared-cpu-1x, 512MB RAM). Escalar para 2+ machines quando necessário.

---

## Arquivos de Deploy

### `apps/api/Dockerfile`

```dockerfile
# ── builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm ci --workspace=apps/api --include-workspace-root

COPY apps/api ./apps/api
RUN npm run api:prisma:generate
RUN npm run api:build

# ── runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
RUN npm ci --workspace=apps/api --include-workspace-root --omit=dev

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/node_modules/.prisma ./apps/api/node_modules/.prisma

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
```

> **Nota sobre Prisma:** o client gerado vai para `node_modules/.prisma/client` — o builder copia somente esse diretório para o runtime para manter a imagem enxuta.

---

### `fly.toml`

```toml
app = "cto-ai-api"
primary_region = "gru"           # São Paulo — ajuste conforme necessidade

[build]
  dockerfile = "apps/api/Dockerfile"

[env]
  PORT                       = "3000"
  HOST                       = "0.0.0.0"
  NODE_ENV                   = "production"
  AUTH_BYPASS                = "false"
  WEBHOOK_WORKER_INTERVAL_MS = "5000"
  COMMS_WORKER_INTERVAL_MS   = "5000"
  APP_BASE_URL               = "https://app.moasy.tech"
  COMMS_FROM_EMAIL           = "no-reply@moasy.tech"
  COMMS_FROM_NAME            = "moasy.tech"

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
    grace_period = "10s"
    interval     = "15s"
    method       = "GET"
    path         = "/health"
    port         = 3000
    timeout      = "5s"
    type         = "http"
    restart_limit = 3
```

> A rota `/health` deve retornar `200 { status: "ok" }` — já implementada em `src/app.ts`.

---

## Migrations no Deploy

A estratégia usa **release command** do Fly.io: antes de substituir as machines, o Fly roda o comando de release. Se falhar, o deploy é abortado antes de subir tráfego.

Adicionar ao `fly.toml`:

```toml
[deploy]
  release_command = "node -e \"require('./apps/api/dist/migrate.js')\""
```

E criar `apps/api/src/migrate.ts`:

```ts
import { execSync } from "node:child_process";

console.log("[migrate] Running prisma migrate deploy...");
execSync("npx prisma migrate deploy", {
  stdio: "inherit",
  cwd: new URL(".", import.meta.url).pathname,
});
console.log("[migrate] Done.");
```

> **Alternativa mais simples:** configurar `release_command = "npx prisma migrate deploy"` passando `DATABASE_URL` via secret. Confirmar qual abordagem funciona melhor com o runtime do Fly (o release command roda em um container separado).

---

## Desenvolvimento Local com Stripe

Em ambiente local, os webhooks do Stripe precisam ser encaminhados via **Stripe CLI**. Sem isso, eventos como `checkout.session.completed` nunca chegam ao servidor e o plano do tenant não é atualizado após o pagamento.

### Pré-requisito: Stripe CLI autenticado

```sh
stripe login
# Abre browser → autorizar na conta Stripe
```

### Iniciar dev com webhooks

Use o script `dev:full` que sobe o servidor e o listener em paralelo:

```sh
cd apps/api
npm run dev:full
```

Isso executa:

- `tsx watch src/server.ts` — servidor API com hot reload
- `stripe listen --forward-to localhost:3000/api/v1/webhooks/billing/stripe` — listener de webhooks

O `STRIPE_WEBHOOK_SECRET` do `.env` deve corresponder ao `whsec_...` exibido pelo `stripe listen`. Se mudar de máquina ou conta, atualize o `.env`.

### Reenviar evento perdido

Se o listener não estava rodando quando um pagamento ocorreu no sandbox:

```sh
# Listar eventos recentes
stripe events list --type checkout.session.completed --limit 3

# Reenviar pelo ID do evento
stripe events resend evt_xxxxxxxxxxxxx
```

---

## Secrets (variáveis sensíveis)

Nunca colocar secrets no `fly.toml`. Sempre setar via CLI:

```sh
fly secrets set \
  DATABASE_URL="postgresql://..." \
  JWT_SECRET="..." \
  STRIPE_SECRET_KEY="..." \
  STRIPE_WEBHOOK_SECRET="..." \
  GITHUB_WEBHOOK_TOKEN="..." \
  JIRA_WEBHOOK_TOKEN="..." \
  INCIDENT_IO_WEBHOOK_TOKEN="..." \
  OPSGENIE_WEBHOOK_TOKEN="..." \
  SMTP_HOST="..." \
  SMTP_PORT="587" \
  SMTP_USER="..." \
  SMTP_PASS="..." \
  --app cto-ai-api
```

Para rotacionar um secret:

```sh
fly secrets set JWT_SECRET="novo-valor" --app cto-ai-api
```

O Fly redeploya automaticamente após `fly secrets set`.

### Referência de secrets obrigatórios

| Secret                      | Obrigatório | Descrição                                                                                                                                             |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | ✅          | Connection string do Postgres (preenchida automaticamente via `fly postgres attach`)                                                                  |
| `JWT_SECRET`                | ✅          | Chave de assinatura dos JWTs (mínimo 32 chars, aleatório)                                                                                             |
| `STRIPE_SECRET_KEY`         | ✅          | Chave secreta do Stripe (`sk_live_...` em produção, `sk_test_...` em dev)                                                                             |
| `STRIPE_WEBHOOK_SECRET`     | ✅          | Secret de validação de webhooks do Stripe — em produção vem do Dashboard Stripe (Webhooks → endpoint → Signing secret); em dev vem do `stripe listen` |
| `GITHUB_WEBHOOK_TOKEN`      | ✅          | Token compartilhado para validar webhooks do GitHub — deve coincidir com o secret configurado no webhook do repositório                               |
| `JIRA_WEBHOOK_TOKEN`        | ✅          | Token compartilhado para validar webhooks do Jira — deve coincidir com o secret configurado no webhook do projeto Jira                                |
| `INCIDENT_IO_WEBHOOK_TOKEN` | ✅          | Token compartilhado para validar webhooks do incident.io                                                                                              |
| `OPSGENIE_WEBHOOK_TOKEN`    | ✅          | Token compartilhado para validar webhooks do OpsGenie                                                                                                 |
| `SMTP_HOST`                 | ✅          | Hostname do servidor SMTP (ex: `smtp.sendgrid.net`)                                                                                                   |
| `SMTP_PORT`                 | ✅          | Porta SMTP — padrão `587` (TLS). Usar `465` para SSL                                                                                                  |
| `SMTP_USER`                 | ✅          | Usuário de autenticação SMTP                                                                                                                          |
| `SMTP_PASS`                 | ✅          | Senha ou API key do SMTP                                                                                                                              |

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

# 2. Reconhecimento — verificar o que já existe na conta
fly apps list
fly postgres list
# Se cto-ai-api já existir: pular o passo 3 de criação de app
# Se cto-ai-db já existir: pular o passo 3 de criação de Postgres

# 3. Criar o app (somente se não existir)
fly apps create cto-ai-api --org personal

# 3. Criar e anexar Postgres
fly postgres create --name cto-ai-db --region gru \
  --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 10
fly postgres attach cto-ai-db --app cto-ai-api

# 4. Setar secrets restantes
fly secrets set \
  JWT_SECRET="$(openssl rand -hex 32)" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  GITHUB_WEBHOOK_TOKEN="$(openssl rand -hex 20)" \
  JIRA_WEBHOOK_TOKEN="$(openssl rand -hex 20)" \
  INCIDENT_IO_WEBHOOK_TOKEN="$(openssl rand -hex 20)" \
  OPSGENIE_WEBHOOK_TOKEN="$(openssl rand -hex 20)" \
  SMTP_HOST="smtp.sendgrid.net" \
  SMTP_PORT="587" \
  SMTP_USER="apikey" \
  SMTP_PASS="SG...." \
  --app cto-ai-api

# Nota: STRIPE_WEBHOOK_SECRET em produção deve ser o Signing Secret do endpoint
# registrado no Stripe Dashboard (Developers → Webhooks → seu endpoint)

# 5. Deploy
fly deploy --app cto-ai-api

# 6. Verificar
fly status --app cto-ai-api
fly logs --app cto-ai-api
```

---

## Deploy Contínuo (GitHub Actions)

Criar `.github/workflows/deploy.yml`:

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

      - uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy
        run: fly deploy --remote-only --app cto-ai-api
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

**Secrets GitHub necessários:**

| Secret          | Como obter                                                 |
| --------------- | ---------------------------------------------------------- |
| `FLY_API_TOKEN` | `fly tokens create deploy --expiry 8760h --app cto-ai-api` |

---

## Rollback

```sh
# Ver histórico de releases
fly releases --app cto-ai-api

# Rollback para versão anterior
fly deploy --image <image-id> --app cto-ai-api
```

> Atenção: se a versão anterior usava um schema de Prisma diferente, o rollback pode falhar com migrations incompatíveis. Planejar rollbacks de schema separadamente.

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

## Evolução Planejada

| Fase           | Mudança                                                 |
| -------------- | ------------------------------------------------------- |
| Fase 1 (atual) | 1 machine, monolito modular                             |
| Fase 2         | Separar `web` e `worker` em process groups do Fly       |
| Fase 3         | Escalar machines conforme carga; adicionar Redis/BullMQ |
| Fase 4         | Multi-region se necessário                              |

Para separar web/worker em process groups (Fase 2), adicionar ao `fly.toml`:

```toml
[processes]
  web    = "node apps/api/dist/server.js"
  worker = "node apps/api/dist/worker.js"
```

---

## Checklist de Deploy

- [ ] `fly.toml` atualizado e commitado
- [ ] Secrets setados (`fly secrets list --app cto-ai-api`)
- [ ] `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` setados com valores de **produção** (`sk_live_...`, `whsec_...` do endpoint registrado no Stripe Dashboard)
- [ ] Endpoint de webhook registrado no Stripe Dashboard apontando para `https://<app>.fly.dev/api/v1/webhooks/billing/stripe`
- [ ] Migrations validadas em staging antes de produção
- [ ] `/health` retornando 200
- [ ] Dockerfile atualizado com as dependências corretas
- [ ] GitHub Actions com `FLY_API_TOKEN` válido
- [ ] Rollback plan documentado se houver breaking schema change
