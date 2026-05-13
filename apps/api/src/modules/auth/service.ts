import { createHash, randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { AccountPreferences, CreateInviteInput, LoginInput, RefreshInput, RegisterByInviteInput, RegisterInput, UpdatePreferencesInput, VerifyEmailInput, ResendVerificationInput, RequestPasswordResetInput, ConfirmPasswordResetInput } from './schema.js';

function parsePreferences(raw: unknown): AccountPreferences | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  return {
    locale: (p['locale'] as AccountPreferences['locale']) ?? 'pt-BR',
    theme: (p['theme'] as AccountPreferences['theme']) ?? 'system'
  };
}
import { enqueueNotification } from '../comms/service.js';

const ACCESS_TOKEN_TTL = '15m';
const ACCESS_TOKEN_TTL_SECONDS = 900; // deve ser coerente com ACCESS_TOKEN_TTL
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const ROLE_PERMISSIONS: Record<string, string[]> = {
  org_admin: ['*'],
  manager: [
    'core.read', 'core.write',
    'dora.read', 'sla.read', 'cogs.read', 'intel.read',
    'integrations.read', 'iam.permission_profile.read',
    'billing.read'
  ],
  viewer: ['core.read', 'dora.read', 'sla.read', 'intel.read', 'billing.read']
};

function tokenHash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

async function resolvePermissions(accountId: string, role: string): Promise<string[]> {
  const rolePerms = ROLE_PERMISSIONS[role] ?? [];

  // wildcard — no need to merge profile keys
  if (rolePerms.includes('*')) return rolePerms;

  const now = new Date();
  const assignments = await prisma.userPermissionProfile.findMany({
    where: {
      accountId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      permissionProfile: { isActive: true }
    },
    select: { permissionProfile: { select: { permissionKeys: true } } }
  });

  const profileKeys = assignments.flatMap(a => a.permissionProfile.permissionKeys);

  // if any profile has wildcard, grant full access
  if (profileKeys.includes('*')) return ['*'];

  return [...new Set([...rolePerms, ...profileKeys])];
}

async function ensureTenant(tenantId: string) {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    create: { id: tenantId, name: `Tenant ${tenantId}`, slug: tenantId },
    update: {}
  });
}

export async function register(input: RegisterInput) {
  const tenantExists = await prisma.tenant.findUnique({ where: { id: input.tenant_id } });
  if (tenantExists) {
    throw Object.assign(new Error('Tenant already exists'), { code: 'TENANT_ALREADY_EXISTS' });
  }

  await ensureTenant(input.tenant_id);

  const existing = await prisma.platformAccount.findUnique({
    where: { email: input.email }
  });

  if (existing) {
    throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' });
  }

  const passwordHash = await hashPassword(input.password);

  const coreUser = await prisma.user.findFirst({
    where: { email: input.email, tenantId: input.tenant_id }
  });

  const account = await prisma.platformAccount.create({
    data: {
      tenantId: input.tenant_id,
      email: input.email,
      passwordHash,
      fullName: input.full_name,
      role: 'org_admin',
      isActive: false,
      coreUserId: coreUser?.id ?? null
    }
  });

  // Criar Subscription no plano Free
  const freePlan = await prisma.plan.findFirst({ where: { name: 'free', isActive: true } });
  if (!freePlan) {
    throw new Error('Free plan not found. Run billing seed before accepting registrations.');
  }
  
  const now = new Date();
  const subscription = await prisma.subscription.create({
    data: {
      tenantId: input.tenant_id,
      planId: freePlan.id,
      status: freePlan.trialDays > 0 ? 'trialing' : 'active',
      trialEndsAt: freePlan.trialDays > 0 ? new Date(now.getTime() + freePlan.trialDays * 86400000) : null,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86400000)
    }
  });

  // Criar primeiro registro no SubscriptionHistory
  await prisma.subscriptionHistory.create({
    data: {
      subscriptionId: subscription.id,
      planId: freePlan.id,
      status: subscription.status,
      effectiveFrom: now,
      reason: 'initial_registration'
    }
  });

  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  await prisma.emailVerificationToken.create({
    data: {
      accountId: account.id,
      tokenHash: tokenHash(rawToken),
      expiresAt
    }
  });

  await enqueueNotification({
    tenantId: input.tenant_id,
    channel: 'email',
    recipient: input.email,
    templateKey: 'email-verification',
    payload: {
      email: input.email,
      verification_token: rawToken,
      expires_at: expiresAt.toISOString()
    }
  });

  return {
    id: account.id,
    tenant_id: account.tenantId,
    email: account.email,
    full_name: account.fullName,
    role: account.role,
    is_active: account.isActive,
    core_user_id: account.coreUserId ?? null,
    created_at: account.createdAt.toISOString()
  };
}

export async function createInvite(tenantId: string, input: CreateInviteInput) {
  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const invite = await prisma.invite.create({
    data: {
      tenantId,
      email: input.email,
      role: input.role,
      tokenHash: tokenHash(rawToken),
      expiresAt
    }
  });

  const result = {
    id: invite.id,
    tenant_id: invite.tenantId,
    email: invite.email,
    role: invite.role,
    invite_token: rawToken,
    expires_at: invite.expiresAt.toISOString()
  };

  await enqueueNotification({
    tenantId:    tenantId,
    channel:     'email',
    recipient:   invite.email,
    templateKey: 'invite',
    payload:     {
      email:        invite.email,
      invite_token: rawToken,
      expires_at:   invite.expiresAt.toISOString(),
    },
  });

  return result;
}

export async function registerByInvite(input: RegisterByInviteInput) {
  const hash = tokenHash(input.invite_token);

  const invite = await prisma.invite.findUnique({ where: { tokenHash: hash } });

  if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid or expired invite token'), { code: 'INVALID_INVITE_TOKEN' });
  }

  const existing = await prisma.platformAccount.findUnique({ where: { email: invite.email } });
  if (existing) {
    throw Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' });
  }

  const passwordHash = await hashPassword(input.password);

  const coreUser = await prisma.user.findFirst({
    where: { email: invite.email, tenantId: invite.tenantId }
  });

  const account = await prisma.$transaction(async (tx) => {
    const acc = await tx.platformAccount.create({
      data: {
        tenantId: invite.tenantId,
        email: invite.email,
        passwordHash,
        fullName: input.full_name,
        role: invite.role,
        coreUserId: coreUser?.id ?? null
      }
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() }
    });

    // Auto-assign default system profile for non-admin roles
    if (acc.role !== 'org_admin') {
      const roleName = acc.role.charAt(0).toUpperCase() + acc.role.slice(1);
      const defaultProfile = await tx.permissionProfile.findFirst({
        where: {
          tenantId: invite.tenantId,
          isSystem: true,
          isActive: true,
          name: `${roleName} Default`
        }
      });

      if (defaultProfile) {
        await tx.userPermissionProfile.create({
          data: {
            tenantId: invite.tenantId,
            accountId: acc.id,
            permissionProfileId: defaultProfile.id,
            grantedBy: acc.id
          }
        });
      }
    }

    return acc;
  });

  return {
    id: account.id,
    tenant_id: account.tenantId,
    email: account.email,
    full_name: account.fullName,
    role: account.role,
    is_active: account.isActive,
    core_user_id: account.coreUserId ?? null,
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

  if (!account) {
    throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
  }

  if (!account.isActive) {
    throw Object.assign(new Error('Account not verified'), { code: 'ACCOUNT_NOT_VERIFIED' });
  }

  const valid = await verifyPassword(input.password, account.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' });
  }

  const permissions = await resolvePermissions(account.id, account.role);

  const accessToken = signToken(
    {
      sub: account.id,
      tenant_id: account.tenantId,
      roles: [account.role],
      permissions,
      platform_role: account.platformRole ?? null
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
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    account: {
      id: account.id,
      tenant_id: account.tenantId,
      email: account.email,
      full_name: account.fullName,
      role: account.role,
      platform_role: account.platformRole ?? null
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
  const permissions = await resolvePermissions(account.id, account.role);

  const accessToken = signToken(
    {
      sub: account.id,
      tenant_id: account.tenantId,
      roles: [account.role],
      permissions,
      platform_role: account.platformRole ?? null
    },
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  return {
    access_token: accessToken,
    refresh_token: rawRefresh,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS
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
    platform_role: account.platformRole ?? null,
    is_active: account.isActive,
    core_user_id: account.coreUserId ?? null,
    last_login_at: account.lastLoginAt?.toISOString() ?? null,
    created_at: account.createdAt.toISOString(),
    preferences: parsePreferences(account.preferences)
  };
}

export async function updatePreferences(accountId: string, input: UpdatePreferencesInput) {
  const account = await prisma.platformAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.isActive) {
    throw Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' });
  }

  const current = parsePreferences(account.preferences) ?? { locale: 'pt-BR' as const, theme: 'system' as const };
  const merged: AccountPreferences = { ...current, ...input };

  await prisma.platformAccount.update({
    where: { id: accountId },
    data: { preferences: merged }
  });

  return { preferences: merged };
}

export async function verifyEmail(input: VerifyEmailInput) {
  const hash = tokenHash(input.token);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid or expired verification token'), { code: 'INVALID_VERIFICATION_TOKEN' });
  }

  const [account] = await prisma.$transaction([
    prisma.platformAccount.update({
      where: { id: record.accountId },
      data:  { isActive: true }
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data:  { usedAt: new Date() }
    })
  ]);

  return {
    id: account.id,
    email: account.email,
    is_active: account.isActive
  };
}

export async function resendVerification(input: ResendVerificationInput) {
  const account = await prisma.platformAccount.findUnique({ where: { email: input.email } });

  // Always return success to avoid email enumeration
  if (!account || account.isActive) return;

  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  await prisma.emailVerificationToken.create({
    data: {
      accountId: account.id,
      tokenHash: tokenHash(rawToken),
      expiresAt
    }
  });

  await enqueueNotification({
    tenantId:    account.tenantId,
    channel:     'email',
    recipient:   account.email,
    templateKey: 'email-verification',
    payload: {
      email:              account.email,
      verification_token: rawToken,
      expires_at:         expiresAt.toISOString()
    }
  });
}

export async function requestPasswordReset(input: RequestPasswordResetInput) {
  const account = await prisma.platformAccount.findUnique({ where: { email: input.email } });

  // Always return success to avoid email enumeration
  if (!account) return;

  const rawToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      accountId: account.id,
      tokenHash: tokenHash(rawToken),
      expiresAt
    }
  });

  await enqueueNotification({
    tenantId:    account.tenantId,
    channel:     'email',
    recipient:   account.email,
    templateKey: 'password-reset',
    payload: {
      email:       account.email,
      reset_token: rawToken,
      expires_at:  expiresAt.toISOString()
    }
  });
}

export async function confirmPasswordReset(input: ConfirmPasswordResetInput) {
  const hash = tokenHash(input.token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid or expired reset token'), { code: 'INVALID_RESET_TOKEN' });
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.platformAccount.update({
      where: { id: record.accountId },
      data:  { passwordHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data:  { usedAt: new Date() }
    }),
    // Revoke all active refresh tokens so existing sessions are invalidated
    prisma.platformRefreshToken.updateMany({
      where: { accountId: record.accountId, revokedAt: null },
      data:  { revokedAt: new Date() }
    })
  ]);
}
