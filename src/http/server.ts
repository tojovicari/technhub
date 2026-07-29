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
// Efeito colateral: registra GitHubActionsProvider no ProviderFactory.
import '../integrations/providers/github-actions/github-actions.provider';
// Efeito colateral: registra GitHubAuthProvider no AuthProviderFactory (login).
import '../auth/providers/github/github-auth.provider';
// Efeito colateral: registra ResendEmailProvider no NotificationProviderFactory.
import '../notifications/providers/resend/resend-email.provider';
import { registerTenantRoutes } from './routes/tenants.routes';
import { registerUserRoutes } from './routes/users.routes';
import { registerIntegrationRoutes } from './routes/integrations.routes';
import { registerAuthRoutes } from './routes/auth.routes';
import { registerTeamRoutes } from './routes/teams.routes';
import { registerMappingRulesRoutes } from './routes/mapping-rules.routes';
import { registerEnrichmentRoutes } from './routes/enrichment.routes';
import { registerDashboardRoutes } from './routes/dashboard.routes';
import { registerTeamProfileRoutes } from './routes/team-profile.routes';
import { registerPersonProfileRoutes } from './routes/person-profile.routes';
import { registerBillingRoutes } from './routes/billing.routes';
import { registerBillingWebhookRoutes } from './routes/billing-webhook.routes';

const server = Fastify({ logger: true });

server.register(cors, {
  origin: getFrontendUrl(),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Usado pelo health check do Fly.io (fly.toml) — sem tocar no banco: só confirma
// que o processo está de pé, não que as dependências (Postgres etc.) estão saudáveis.
server.get('/health', async () => ({ status: 'ok' }));

registerTenantRoutes(server);
registerUserRoutes(server);
registerIntegrationRoutes(server);
registerAuthRoutes(server);
registerTeamRoutes(server);
registerMappingRulesRoutes(server);
registerEnrichmentRoutes(server);
registerDashboardRoutes(server);
registerTeamProfileRoutes(server);
registerPersonProfileRoutes(server);
registerBillingRoutes(server);
registerBillingWebhookRoutes(server);

const port = Number(process.env.PORT ?? 3000);

server.listen({ port, host: '0.0.0.0' }).catch((error) => {
  server.log.error(error);
  process.exit(1);
});
