import type { FastifyInstance } from 'fastify';
import { EnrichmentService } from '../../enrichment/enrichment.service';
import { isValidUuid } from '../uuid';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { requireSameTenant } from '../middleware/require-same-tenant';

const requireAdminOrManager = requireRole('ADMIN', 'GESTOR');

interface TenantIntegrationParams {
  readonly tenantId: string;
  readonly integrationId: string;
}

/** Registra a rota que dispara a Enriched Layer (Seção 3/5 da spec) sobre os work items de uma integração. */
export function registerEnrichmentRoutes(
  server: FastifyInstance,
  enrichmentService: EnrichmentService = new EnrichmentService(),
): void {
  server.post<{ Params: TenantIntegrationParams }>(
    '/tenants/:tenantId/enrichment/:integrationId/run',
    { preHandler: [requireAuth, requireAdminOrManager, requireSameTenant] },
    async (request, reply) => {
      const { tenantId, integrationId } = request.params;

      if (!isValidUuid(integrationId)) {
        return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
      }

      const result = await enrichmentService.runForIntegration(tenantId, integrationId);

      switch (result.outcome) {
        case 'no_integration':
          return reply.status(404).send({ error: 'Integração não encontrada para este tenant.' });
        case 'no_team':
          return reply.status(400).send({
            error:
              'Esta integração ainda não está associada a um time. Associe via PATCH .../integrations/:integrationId informando "teamId".',
          });
        case 'unsupported_category':
          return reply.status(400).send({
            error: 'Esta categoria de provider ainda não tem Enriched Layer implementada.',
          });
        case 'success':
          return reply.status(200).send(result.summary);
      }
    },
  );
}
