import type { FastifyRequest, FastifyReply } from 'fastify';

type RequestWithStart = FastifyRequest & { _requestStartNs?: bigint };

function normalizePath(rawUrl: string) {
  const qIndex = rawUrl.indexOf('?');
  return qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;
}

export function markRequestStart(request: FastifyRequest) {
  (request as RequestWithStart)._requestStartNs = process.hrtime.bigint();
}

export function computeRequestDurationMs(request: FastifyRequest) {
  const start = (request as RequestWithStart)._requestStartNs;
  if (!start) return null;

  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1_000_000;
}

export function logRequestCompletion(request: FastifyRequest, reply: FastifyReply) {
  const durationMs = computeRequestDurationMs(request);
  const duration = durationMs == null ? null : Math.round(durationMs * 100) / 100;

  const user = request.user as { tenant_id?: string; sub?: string } | undefined;
  const path = request.routeOptions?.url ?? normalizePath(request.url);

  if (path === '/health' || path === '/ready') {
    return;
  }

  const slowThresholdMs = Number(process.env.SLOW_REQUEST_THRESHOLD_MS ?? 500);
  const level = duration != null && duration > slowThresholdMs ? 'warn' : 'info';

  request.log[level](
    {
      event: 'api.request.completed',
      method: request.method,
      path,
      status_code: reply.statusCode,
      duration_ms: duration,
      tenant_id: user?.tenant_id ?? null,
      user_id: user?.sub ?? null
    },
    'API request completed'
  );
}
