import { createHash, randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { LoginInput, RefreshInput, RegisterInput } from './schema.js';

const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ROLE_PERMISSIONS: Record<string, string[]> = {
  org_admin: ['*'],
  manager: [
    'core.read', 'core.write',
    'dora.read', 'sla.read', 'cogs.read', 'intel.read',
    'integrations.read', 'iam.permission_profile.read'
  ],
  viewer: ['core.read', 'dora.read', 'sla.read', 'intel.read']
};

function tokenHash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

async function ensureTenant(tenantId: string) {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    create: { id: tenantId, name: `Tenant ${tenantId}`, slug: tenantId },
    update: {}
  });
}

export async function register(input: RegisterInput) {
  await ensureTenant(input.tenant_id);

  const existing = await prisma.platformAccount.findUnique({
    where: { email: input.email }
  });

  if (existing) {
    throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' });
  }

  const passwordHash = await hashPassword(input.password);

  const account = await prisma.platformAccount.create({
    data: {
      tenantId: input.tenant_id,
      email: input.email,
      passwordHash,
      fullName: input.full_name,
      role: input.role
    }
  });

  return {
    id: account.id,
    tenant_id: account.tenantId,
    email: account.email,
    full_name: account.fullName,
    role: account.role,
    is_active: account.isActive,
    created_at: account.createdAt.toISOString()
  };
}

export async function login(
  input: LoginInput,
  signToken: (payload: object, options: { expiresIn: string }) => string
) {
  const account = await prisma.platformAccount.findUnique({
    where: { email: input.email }
  });

  if (!account || !account.isActive) {
    throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
  }

  const valid = await verifyPassword(input.password, account.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
  }

  const accessToken = signToken(
    {
      sub: account.id,
      tenant_id: account.tenantId,
      roles: [account.role],
      permissions: ROLE_PERMISSIONS[account.role] ?? []
    },
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  const rawRefresh = randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.platformRefreshToken.create({
    data: {
      accountId: account.id,
      tokenHash: tokenHash(rawRefresh),
      expiresAt
    }
  });

  await prisma.platformAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() }
  });

  return {
    access_token: accessToken,
    refresh_token: rawRefresh,
    token_type: 'Bearer',
    expires_in: 3600,
    account: {
      id: account.id,
      tenant_id: account.tenantId,
      email: account.email,
      full_name: account.fullName,
      role: account.role
    }
  };
}

export async function refresh(
  input: RefreshInput,
  signToken: (payload: object, options: { expiresIn: string }) => string
) {
  const hash = tokenHash(input.refresh_token);

  const stored = await prisma.platformRefreshToken.findUnique({
    where: { tokenHash: hash },
    include: { account: true }
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid or expired refresh token'), { code: 'INVALID_REFRESH_TOKEN' });
  }

  if (!stored.account.isActive) {
    throw Object.assign(new Error('Account disabled'), { code: 'ACCOUNT_DISABLED' });
  }

  // Rotate: revoke old, issue new
  const rawRefresh = randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.platformRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() }
    }),
    prisma.platformRefreshToken.create({
      data: {
        accountId: stored.accountId,
        tokenHash: tokenHash(rawRefresh),
        expiresAt
      }
    })
  ]);

  const account = stored.account;
  const accessToken = signToken(
    {
      sub: account.id,
      tenant_id: account.tenantId,
      roles: [account.role],
      permissions: ROLE_PERMISSIONS[account.role] ?? []
    },
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  return {
    access_token: accessToken,
    refresh_token: rawRefresh,
    token_type: 'Bearer',
    expires_in: 3600
  };
}

export async function logout(rawRefreshToken: string) {
  const hash = tokenHash(rawRefreshToken);
  await prisma.platformRefreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export async function getMe(accountId: string) {
  const account = await prisma.platformAccount.findUnique({
    where: { id: accountId }
  });

  if (!account || !account.isActive) {
    throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });
  }

  return {
    id: account.id,
    tenant_id: account.tenantId,
    email: account.email,
    full_name: account.fullName,
    role: account.role,
    is_active: account.isActive,
    last_login_at: account.lastLoginAt?.toISOString() ?? null,
    created_at: account.createdAt.toISOString()
  };
}
