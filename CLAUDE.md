# Contexto do Projeto: Plataforma de Engineering Intelligence

Você é um Engenheiro de Software Sênior atuando no desenvolvimento de uma plataforma de Engineering Intelligence (DORA, Flow Metrics e SPACE). O desenvolvimento deste projeto é **Spec-Driven**. NUNCA invente arquiteturas ou regras de negócio que não estejam na especificação oficial.

## 📌 Documentação Oficial

A fonte da verdade para qualquer decisão arquitetural, de banco de dados ou regras de negócio é o arquivo de especificação.

- **Spec Base:** Leia sempre o arquivo `.spec/spec-engineering-intelligence.md` (ou solicite que o usuário o anexe/leia caso você não tenha contexto).

## 🏗️ Princípios de Arquitetura

1. **ELT em 4 Camadas:** O fluxo de dados deve estritamente respeitar as camadas: Raw -> Canonical -> Enriched -> Analytics.
2. **Pluggable Architecture:** A ingestão de dados não é em tempo real. Utilizamos batches assíncronos. Todo novo conector (GitHub, Jira, etc.) DEVE herdar e implementar a classe `BaseProvider`.
3. **Semântica Flexível:** NENHUMA métrica (como gatilhos de deploy, definição de bug, toil) deve ser hardcoded no código. Tudo é interpretado dinamicamente com base nas configurações da entidade `team_metric_configurations`.

## 🧑‍💻 Regras de Código (TypeScript / Node.js)

- **Tipagem Estrita:** Utilize TypeScript strict mode. Tipos canônicos (ex: `CanonicalWorkItem`) devem ser rigorosamente validados.
- **Clean Architecture:** Mantenha a separação de responsabilidades. O conector (`provider`) só faz a ingestão, o motor de transformação (`semantic engine`) só aplica regras de negócio.
- **SQL/Banco de Dados:** Siga exatamente a modelagem DDL estabelecida na especificação para o Módulo de Times (capacidades, membros) e para a Camada Canônica/Enriquecida. Use `UUID` para chaves primárias e timestamps com fuso horário (`TIMESTAMP WITH TIME ZONE`).
- Use migrations para gestão do banco de dados, ao invés de fazer ediçoes direto em DB, para manter consistência das coisas.

## 🛠️ Comandos Frequentes (Para o Claude Code)

- Para rodar testes: `npm run test`
- Para rodar linting: `npm run lint`
- Para compilar: `npm run build`

## 🔀 Fluxo de Git / Deploy

- **Nunca dar push direto na `main`.** Toda mudança que vai pra produção passa por uma branch + Pull Request no GitHub — fica registrado, e dá pra alguém revisar/validar antes de entrar. Criar a branch, dar push nela e abrir o PR (`gh pr create`); não fazer merge sozinho a menos que o usuário peça explicitamente.

## 🛠️ Stack & Infraestrutura (Backend Only)

- **Ambiente Local:** PostgreSQL nativo/local no OS (sem containerização/Docker).
- **Ambiente Produção:** Deploy no **Fly.io** (PostgreSQL gerenciado + Node.js/TypeScript App).
- **Autenticação:** Camada middleware de Auth preparada para suporte futuro a Social Login / OAuth2 e SSO (SAML/OIDC).
- **Autorização (RBAC - 3 Roles):**
  1. `ADMIN`: Acesso total (gestão do tenant, faturamento, integrações, convites e configs globais).
  2. `GESTOR` (Tech Lead / Engineering Manager): Gestão de times, configuração semântica de métricas da squad, associação de aliases e visualização de dashboards.
  3. `USUARIO` (Dev / Contribuidor): Visualização dos seus próprios dados e dashboards das squads que pertence.
