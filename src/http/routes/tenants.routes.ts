import type { FastifyInstance } from 'fastify';
import { TenantRepository } from '../../identity/tenant.repository';
import { BillingService } from '../../billing/billing.service';

interface CreateTenantBody {
  readonly name?: string;
}

interface TenantIdParams {
  readonly tenantId: string;
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

  /**
   * Pública, sem auth — pensada pra uma eventual tela de "aceite de
   * convite" no front (mostrar "você foi convidado pro workspace X" antes
   * de mandar pro OAuth), que recebe só o `tenantId` na URL do convite e
   * não tem sessão nenhuma ainda pra chamar a versão autenticada. Só o
   * nome — nada de status/plano/qualquer coisa que não seja seguro expor
   * pra quem só tem um id na mão (mesmo espírito do `GET /plans`).
   */
  server.get<{ Params: TenantIdParams }>('/tenants/:tenantId/public-info', async (request, reply) => {
    const { tenantId } = request.params;
    const tenants = await tenantRepository.findManyByIds([tenantId]);
    const tenant = tenants[0];

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant não encontrado.' });
    }

    return reply.status(200).send({ id: tenant.id, name: tenant.name });
  });
}
