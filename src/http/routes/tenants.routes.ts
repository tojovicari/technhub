import type { FastifyInstance } from 'fastify';
import { TenantRepository } from '../../identity/tenant.repository';
import { BillingService } from '../../billing/billing.service';

interface CreateTenantBody {
  readonly name?: string;
}

/** Registra as rotas de gestão de Tenants (POST /tenants). */
export function registerTenantRoutes(
  server: FastifyInstance,
  tenantRepository: TenantRepository = new TenantRepository(),
  billingService: BillingService = new BillingService(),
): void {
  server.post<{ Body: CreateTenantBody }>('/tenants', async (request, reply) => {
    const { name } = request.body;

    if (!name || name.trim().length === 0) {
      return reply.status(400).send({ error: 'O campo "name" é obrigatório.' });
    }

    const tenant = await tenantRepository.create({ name: name.trim() });
    // Provisionamento automático no plano Free — dependência rígida de
    // propósito (se a migration de seed do plano Free não rodou, é um erro
    // de setup real, não algo pra engolir silenciosamente).
    await billingService.provisionFreeSubscription(tenant.id);

    return reply.status(201).send(tenant);
  });
}
