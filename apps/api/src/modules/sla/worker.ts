import type { FastifyInstance } from 'fastify';

// SLA compliance is now computed on-demand via GET /sla/compliance.
// There is no background scheduler needed — no persistent SlaInstance state.
export function startSlaScheduler(_app: FastifyInstance) {
  // no-op: kept for backward compatibility with app.ts bootstrap
}
