import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getFrontendUrl } from '../config/frontend-url';
// Efeito colateral: registra GitHubProvider no ProviderFactory antes do server aceitar requisições.
import '../integrations/providers/github/github.provider';
// Efeito colateral: registra JiraProvider no ProviderFactory.
import '../integrations/providers/jira/jira.provider';
// Efeito colateral: registra LinearProvider no ProviderFactory.
import '../integrations/providers/linear/linear.provider';
// Efeito colateral: registra WaroomProvider no ProviderFactory.
import '../integrations/providers/waroom/waroom.provider';
// Efeito colateral: registra IncidentIoProvider no ProviderFactory.
import '../integrations/providers/incident-io/incident-io.provider';
// Efeito colateral: registra GitHubActionsProvider no ProviderFactory.
import '../integrations/providers/github-actions/github-actions.provider';
// Efeito colateral: registra ArgoCDProvider no ProviderFactory.
import '../integrations/providers/argocd/argocd.provider';
// Efeito colateral: registra AzureBoardsProvider no ProviderFactory.
import '../integrations/providers/azure-boards/azure-boards.provider';
// Efeito colateral: registra AzureReposProvider no ProviderFactory.
import '../integrations/providers/azure-repos/azure-repos.provider';
// Efeito colateral: registra AzurePipelinesProvider no ProviderFactory.
import '../integrations/providers/azure-pipelines/azure-pipelines.provider';
// Efeito colateral: registra VercelProvider no ProviderFactory.
import '../integrations/providers/vercel/vercel.provider';
// Efeito colateral: registra GitHubAuthProvider no AuthProviderFactory (login).
import '../auth/providers/github/github-auth.provider';
import '../auth/providers/google/google-auth.provider';
import '../auth/providers/microsoft/microsoft-auth.provider';
import '../auth/providers/slack/slack-auth.provider';
// Efeito colateral: registra ResendEmailProvider no NotificationProviderFactory.
import '../notifications/providers/resend/resend-email.provider';
import { registerTenantRoutes } from './routes/tenants.routes';
import { registerUserRoutes } from './routes/users.routes';
import { registerIntegrationRoutes } from './routes/integrations.routes';
import { registerAuthRoutes } from './routes/auth.routes';
import { registerTeamRoutes } from './routes/teams.routes';
import { registerMappingRulesRoutes } from './routes/mapping-rules.routes';
import { registerMetricTriggerConfigRoutes } from './routes/metric-trigger-config.routes';
import { registerMetricConfigHistoryRoutes } from './routes/metric-config-history.routes';
import { registerEnrichmentRoutes } from './routes/enrichment.routes';
import { registerDashboardRoutes } from './routes/dashboard.routes';
import { registerTimelineEventRoutes } from './routes/timeline-events.routes';
import { registerTeamProfileRoutes } from './routes/team-profile.routes';
import { registerPersonProfileRoutes } from './routes/person-profile.routes';
import { registerInternalRoutes } from './routes/internal.routes';
import { registerBillingRoutes } from './routes/billing.routes';
import { registerBillingWebhookRoutes } from './routes/billing-webhook.routes';
import { registerAlertRoutes } from './routes/alerts.routes';
import { registerAdminRoutes } from './routes/admin.routes';
import { registerFeedbackRoutes } from './routes/feedback.routes';
import { getPool } from '../database/pool';

const server = Fastify({ logger: true });

server.register(cors, {
  origin: getFrontendUrl(),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

/**
 * Usado pelo health check do Fly.io (fly.toml) — de propósito *readiness*,
 * não só liveness: checa o Postgres a cada chamada (`SELECT 1`), porque o
 * Fly usa este endpoint pra decidir se roteia tráfego real pra esta máquina.
 * Sem isso, uma máquina recém-reiniciada (ver incidente investigado nesta
 * sessão: "Connection terminated unexpectedly" logo após o boot, pool ainda
 * sem conexão estabelecida) reporta "ok" e recebe tráfego antes de o banco
 * estar de fato acessível. `503` faz o Fly tratar como não-saudável — não
 * rotear e, se persistir, reiniciar (`restart_limit` em `fly.toml`).
 */
server.get('/health', async (_request, reply) => {
  try {
    await getPool().query('SELECT 1');
    return reply.status(200).send({ status: 'ok' });
  } catch (error) {
    server.log.error(`[health] Postgres inacessível: ${(error as Error).message}`);
    return reply.status(503).send({ status: 'degraded' });
  }
});

registerTenantRoutes(server);
registerUserRoutes(server);
registerIntegrationRoutes(server);
registerAuthRoutes(server);
registerTeamRoutes(server);
registerMappingRulesRoutes(server);
registerMetricTriggerConfigRoutes(server);
registerMetricConfigHistoryRoutes(server);
registerEnrichmentRoutes(server);
registerDashboardRoutes(server);
registerTimelineEventRoutes(server);
registerTeamProfileRoutes(server);
registerPersonProfileRoutes(server);
registerInternalRoutes(server);
registerBillingRoutes(server);
registerBillingWebhookRoutes(server);
registerAlertRoutes(server);
registerAdminRoutes(server);
registerFeedbackRoutes(server);

const port = Number(process.env.PORT ?? 3000);

/**
 * Espera o pool conseguir uma conexão de verdade antes de abrir a porta —
 * ataca a mesma causa raiz do `/health` acima, mas mais cedo: numa máquina
 * recém-reiniciada, a primeira conexão ao Postgres pode falhar por alguns
 * segundos (rede/DNS da VM ainda estabilizando). Sem isso, o processo abre
 * a porta e começa a aceitar tráfego real antes de o pool estar pronto —
 * exatamente o que gerou os 500 "Connection terminated unexpectedly"
 * investigados nesta sessão. Poucas tentativas com backoff curto: se o
 * banco estiver genuinamente fora do ar, falha rápido e deixa o
 * `restart_limit` do Fly (`fly.toml`) lidar com isso, em vez de travar o
 * boot indefinidamente.
 */
async function waitForDatabase(maxAttempts = 5, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await getPool().query('SELECT 1');
      return;
    } catch (error) {
      server.log.warn(`[startup] Postgres ainda não acessível (tentativa ${attempt}/${maxAttempts}): ${(error as Error).message}`);
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

waitForDatabase()
  .then(() => server.listen({ port, host: '0.0.0.0' }))
  .catch((error) => {
    server.log.error(error);
    process.exit(1);
  });
