import type { FastifyRequest } from 'fastify';

export function meta(request: FastifyRequest) {
  return {
    request_id: request.id,
    version: 'v1',
    timestamp: new Date().toISOString()
  };
}

export function ok<T>(request: FastifyRequest, data: T) {
  return {
    data,
    meta: meta(request),
    error: null
  };
}

export function fail(request: FastifyRequest, code: string, message: string, details?: Record<string, unknown>) {
  return {
    data: null,
    meta: meta(request),
    error: {
      code,
      message,
      ...(details ? { details } : {})
    }
  };
}
