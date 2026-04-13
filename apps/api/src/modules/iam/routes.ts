import type { FastifyInstance } from 'fastify';
import { fail, ok } from '../../lib/http.js';
import { ensureTenantScope } from '../../plugins/auth.js';
import {
  assignPermissionProfileSchema,
  createPermissionProfileSchema,
  listProfilesQuerySchema,
  updatePermissionProfileSchema
} from './schema.js';
import {
  assignPermissionProfile,
  createPermissionProfile,
  deletePermissionProfile,
  getPermissionProfile,
  listPermissionProfiles,
  listProfileUsers,
  listUserAssignments,
  revokePermissionProfile,
  updatePermissionProfile
} from './service.js';

export async function iamRoutes(app: FastifyInstance) {
  // GET /iam/permission-profiles
  app.get('/iam/permission-profiles', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.read')]
  }, async (request, reply) => {
    const parsed = listProfilesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid query parameters', { issues: parsed.error.issues }));
    }

    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const profiles = await listPermissionProfiles(tenantId, parsed.data);
    return reply.status(200).send(ok(request, { items: profiles }));
  });

  // POST /iam/permission-profiles
  app.post('/iam/permission-profiles', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.manage')]
  }, async (request, reply) => {
    const parsed = createPermissionProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) return tenantScopeError;

    const profile = await createPermissionProfile(parsed.data);
    return reply.status(201).send(ok(request, profile));
  });

  // GET /iam/permission-profiles/:profile_id
  app.get('/iam/permission-profiles/:profile_id', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.read')]
  }, async (request, reply) => {
    const { profile_id: profileId } = request.params as { profile_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const profile = await getPermissionProfile(profileId, tenantId);

    if (!profile) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Permission profile not found'));
    }

    return reply.status(200).send(ok(request, profile));
  });

  // PATCH /iam/permission-profiles/:profile_id
  app.patch('/iam/permission-profiles/:profile_id', {    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.manage')]
  }, async (request, reply) => {
    const parsed = updatePermissionProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const { profile_id: profileId } = request.params as { profile_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await updatePermissionProfile(profileId, tenantId, parsed.data);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Permission profile not found'));
    }

    if ('error' in result && result.error === 'SYSTEM_PROFILE') {
      return reply.status(403).send(fail(request, 'FORBIDDEN', 'System profiles cannot be modified'));
    }

    return reply.status(200).send(ok(request, result));
  });

  // DELETE /iam/permission-profiles/:profile_id
  app.delete('/iam/permission-profiles/:profile_id', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.manage')]
  }, async (request, reply) => {
    const { profile_id: profileId } = request.params as { profile_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await deletePermissionProfile(profileId, tenantId);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Permission profile not found'));
    }

    if (typeof result === 'object' && result.error === 'SYSTEM_PROFILE') {
      return reply.status(403).send(fail(request, 'FORBIDDEN', 'System profiles cannot be deleted'));
    }

    return reply.status(204).send();
  });

  // GET /iam/users/:user_id/permission-profiles
  app.get('/iam/users/:user_id/permission-profiles', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.read')]
  }, async (request, reply) => {
    const { user_id: userId } = request.params as { user_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await listUserAssignments(userId, tenantId);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'User not found'));
    }

    return reply.status(200).send(ok(request, { items: result }));
  });

  // GET /iam/permission-profiles/:profile_id/users
  app.get('/iam/permission-profiles/:profile_id/users', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.read')]
  }, async (request, reply) => {
    const { profile_id: profileId } = request.params as { profile_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await listProfileUsers(profileId, tenantId);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Permission profile not found'));
    }

    return reply.status(200).send(ok(request, { items: result }));
  });

  // POST /iam/users/:user_id/permission-profiles
  app.post('/iam/users/:user_id/permission-profiles', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.assign')]
  }, async (request, reply) => {
    const parsed = assignPermissionProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(fail(request, 'BAD_REQUEST', 'Invalid request body', { issues: parsed.error.issues }));
    }

    const tenantScopeError = ensureTenantScope(request, reply, parsed.data.tenant_id);
    if (tenantScopeError) return tenantScopeError;

    const { user_id: userId } = request.params as { user_id: string };
    const grantedBy = (request.user as { sub: string }).sub;
    const result = await assignPermissionProfile(userId, grantedBy, parsed.data);

    if ('error' in result) {
      if (result.error === 'USER_NOT_FOUND') {
        return reply.status(404).send(fail(request, 'NOT_FOUND', 'User not found'));
      }
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Permission profile not found or inactive'));
    }

    return reply.status(201).send(ok(request, result));
  });

  // DELETE /iam/users/:user_id/permission-profiles/:profile_id
  app.delete('/iam/users/:user_id/permission-profiles/:profile_id', {
    preHandler: [app.authenticate, app.requirePermission('iam.permission_profile.assign')]
  }, async (request, reply) => {
    const { user_id: userId, profile_id: profileId } = request.params as { user_id: string; profile_id: string };
    const tenantId = (request.user as { tenant_id: string }).tenant_id;
    const result = await revokePermissionProfile(userId, profileId, tenantId);

    if (!result) {
      return reply.status(404).send(fail(request, 'NOT_FOUND', 'Assignment not found'));
    }

    return reply.status(204).send();
  });
}
