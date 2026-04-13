---
name: deploy-flyio
description: "Use when planning, executing, or reviewing a Fly.io deployment for CTO.ai — covers Dockerfile, fly.toml, secrets, migrations, health checks, CI/CD, and rollback"
---

# Skill: Deploy Fly.io

## Goal
Garantir que todo deploy para o Fly.io siga o padrão estabelecido: imagem mínima, secrets gerenciados corretamente, migrations sem downtime, e rollback planejado.

## Use When
- Primeiro deploy de um novo ambiente (staging, produção)
- Qualquer mudança no `Dockerfile` ou `fly.toml`
- Adição de novas variáveis de ambiente ou secrets
- Nova migration Prisma prestes a ir para produção
- Configuração de GitHub Actions para CD
- Investigação de falha em deploy
- Planejamento de escalonamento ou process groups

## Artefatos Canônicos

| Artefato | Localização |
|---|---|
| Estratégia completa | `docs/deploy-flyio.md` |
| Dockerfile | `apps/api/Dockerfile` |
| Config Fly | `fly.toml` (raiz do projeto) |
| CD Workflow | `.github/workflows/deploy.yml` |

**Sempre ler `docs/deploy-flyio.md` antes de qualquer ação de deploy.**

---

## Checklist Pré-Deploy

### 1. Imagem Docker
- [ ] Dockerfile usa multi-stage build (builder + runtime)
- [ ] Stage runtime usa `--omit=dev` no `npm ci`
- [ ] Prisma client gerado no builder e copiado para runtime (`.prisma/client`)
- [ ] `CMD` aponta para `dist/server.js` (compilado)
- [ ] Imagem expõe porta `3000`

### 2. fly.toml
- [ ] `primary_region` definido corretamente
- [ ] `[env]` contém apenas variáveis **não-sensíveis** (PORT, HOST, NODE_ENV, etc.)
- [ ] `[http_service]` com `internal_port = 3000` e `force_https = true`
- [ ] `[checks.health]` configurado com path `/health`
- [ ] `[deploy] release_command` configurado para rodar Prisma migrate

### 3. Secrets
- [ ] Nenhum secret no `fly.toml` ou no código
- [ ] `DATABASE_URL` preenchido via `fly postgres attach` ou `fly secrets set`
- [ ] `JWT_SECRET` com mínimo 32 chars, gerado com `openssl rand -hex 32`
- [ ] Tokens de webhook setados (`GITHUB_WEBHOOK_TOKEN`, `JIRA_WEBHOOK_TOKEN`)
- [ ] Verificar com `fly secrets list --app <app-name>`

### 4. Migrations
- [ ] Todas as migrations commitadas e revisadas
- [ ] Migration é **backward compatible** com o código da versão anterior (tolerância a rollback)
- [ ] `release_command` testado em staging antes de produção
- [ ] Rollback de schema documentado se a migration não for reversível

### 5. Health Check
- [ ] `GET /health` retorna `200 { status: "ok" }` em `< 5s`
- [ ] O endpoint **não requer autenticação**
- [ ] Check cobre conectividade com o banco (ping Prisma)

### 6. CI/CD
- [ ] `FLY_API_TOKEN` configurado nos secrets do GitHub (`fly tokens create deploy`)
- [ ] Workflow usa `concurrency: deploy-production` para evitar deploys paralelos
- [ ] Deploy só roda em push para `main`

### 7. Rollback
- [ ] Plano de rollback documentado para a release atual
- [ ] Se schema foi alterado: anotar se é reversível ou não
- [ ] Saber como executar: `fly deploy --image <image-id> --app <app>`

---

## Validações Pós-Deploy

```sh
# Status das machines
fly status --app <app-name>

# Logs imediatos
fly logs --app <app-name>

# Health check manual
curl https://<app-name>.fly.dev/health

# Verificar migration aplicada
fly postgres connect --app <db-name>
# \dt para listar tabelas, select * from "_prisma_migrations" order by finished_at desc limit 5;
```

---

## Anti-patterns — Nunca Fazer

- ❌ Colocar `DATABASE_URL`, `JWT_SECRET` ou tokens no `fly.toml`
- ❌ Rodar migrations manualmente em produção sem release command
- ❌ Fazer deploy sem testar o Dockerfile localmente primeiro (`docker build`)
- ❌ Usar `AUTH_BYPASS=true` em staging/produção
- ❌ Copiar `node_modules` completo para a imagem de runtime (usar `--omit=dev`)
- ❌ Deploy direto em `main` sem validação de tests no CI

---

## Comandos de Referência Rápida

```sh
# Autenticação e reconhecimento (SEMPRE o primeiro passo)
fly auth login
fly auth whoami
fly apps list              # ver o que já existe
fly postgres list          # ver bancos existentes

# Build local para testar a imagem
docker build -f apps/api/Dockerfile -t cto-ai-api:local .
docker run --env-file apps/api/.env -p 3000:3000 cto-ai-api:local

# Deploy manual
fly deploy --app cto-ai-api

# Inspecionar secrets
fly secrets list --app cto-ai-api

# Rollback
fly releases --app cto-ai-api
fly deploy --image <image-id> --app cto-ai-api

# Acessar banco em produção (read-only recomendado)
fly postgres connect --app cto-ai-db
```

---

## Output Template (para PRs / issues de deploy)

Usar ao documentar um deploy:

```
- Ambiente: staging | produção
- Versão/commit: <sha>
- Mudanças de schema: sim | não — reversível? sim | não
- Secrets novos/alterados: <lista>
- Health check pós-deploy: pass | fail
- Migrations aplicadas: <lista de migration names>
- Rollback plan: <descrição ou "N/A">
- Notas: <observações>
```

---

## Referências

- Estratégia completa: [docs/deploy-flyio.md](../../docs/deploy-flyio.md)
- Arquitetura geral: [docs/architecture.md](../../docs/architecture.md)
- Tech stack: [docs/tech-stack.md](../../docs/tech-stack.md)
- Fly.io docs: https://fly.io/docs/
