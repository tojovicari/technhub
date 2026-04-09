import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { loginSchema, refreshSchema, registerSchema } from './schema.js';
import { getMe, login, logout, refresh, register } from './service.js';

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail(request, 'VALIDATION_ERROR', 'Invalid request body', {
          issues: parsed.error.issues
        })
      );
    }

    try {
      const account = await register(parsed.data);
      return reply.status(201).send(ok(request, account));
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code === 'EMAIL_TAKEN') {
        return reply.status(409).send(fail(request, 'EMAIL_TAKEN', e.message ?? 'Email already registered'));
      }
      throw err;
    }
  });

  // POST /auth/login
  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail(request, 'VALIDATION_ERROR', 'Invalid request body', {
          issues: parsed.error.issues
        })
      );
    }

    try {
      const result = await login(parsed.data, (payload, opts) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app as any).jwt.sign(payload, opts)
      );
      return reply.status(200).send(ok(request, result));
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'INVALID_CREDENTIALS') {
        return reply.status(401).send(fail(request, 'INVALID_CREDENTIALS', 'Invalid email or password'));
      }
      throw err;
    }
  });

  // POST /auth/refresh
  app.post('/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail(request, 'VALIDATION_ERROR', 'Invalid request body', {
          issues: parsed.error.issues
        })
      );
    }

    try {
      const result = await refresh(parsed.data, (payload, opts) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (app as any).jwt.sign(payload, opts)
      );
      return reply.status(200).send(ok(request, result));
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === 'INVALID_REFRESH_TOKEN' || e.code === 'ACCOUNT_DISABLED') {
        return reply.status(401).send(fail(request, e.code, 'Invalid or expired refresh token'));
      }
      throw err;
    }
  });

  // POST /auth/logout  (requires auth)
  app.post(
    '/auth/logout',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send(
          fail(request, 'VALIDATION_ERROR', 'refresh_token is required', {
            issues: parsed.error.issues
          })
        );
      }

      await logout(parsed.data.refresh_token);
      return reply.status(200).send(ok(request, { message: 'Logged out successfully' }));
    }
  );

  // GET /auth/me  (requires auth)
  app.get(
    '/auth/me',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = request.user as any;

      try {
        const account = await getMe(user.sub);
        return reply.status(200).send(ok(request, account));
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'NOT_FOUND') {
          return reply.status(404).send(fail(request, 'NOT_FOUND', 'Account not found'));
        }
        throw err;
      }
    }
  );
}
