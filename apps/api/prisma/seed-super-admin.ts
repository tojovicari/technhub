import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const prisma = new PrismaClient();
const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

const SUPER_ADMIN_EMAIL = 'glauber.vicari+moasy@gmail.com';
const SUPER_ADMIN_NAME = 'Glauber Vicari';
const PLATFORM_TENANT_ID = 'moasy-platform';

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&';
  let pwd = '';
  const bytes = randomBytes(20);
  for (const b of bytes) {
    pwd += chars[b % chars.length];
  }
  return pwd;
}

async function main() {
  // 1. Garantir tenant da plataforma
  await prisma.tenant.upsert({
    where: { id: PLATFORM_TENANT_ID },
    create: {
      id: PLATFORM_TENANT_ID,
      name: 'moasy Platform',
      slug: PLATFORM_TENANT_ID,
    },
    update: {},
  });

  // 2. Verificar se a conta já existe
  const existing = await prisma.platformAccount.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  });

  if (existing) {
    // Apenas promover para super_admin se ainda não for
    if (existing.platformRole === 'super_admin') {
      console.log(`✅ Account already is super_admin: ${SUPER_ADMIN_EMAIL}`);
      return;
    }

    await prisma.platformAccount.update({
      where: { email: SUPER_ADMIN_EMAIL },
      data: {
        platformRole: 'super_admin',
        isActive: true,
      },
    });
    console.log(`✅ Promoted to super_admin: ${SUPER_ADMIN_EMAIL}`);
    return;
  }

  // 3. Criar nova conta
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  await prisma.platformAccount.create({
    data: {
      tenantId: PLATFORM_TENANT_ID,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      fullName: SUPER_ADMIN_NAME,
      role: 'org_admin',
      platformRole: 'super_admin',
      isActive: true,
    },
  });

  console.log('✅ super_admin created successfully');
  console.log('');
  console.log('  Email   :', SUPER_ADMIN_EMAIL);
  console.log('  Password:', password);
  console.log('');
  console.log('⚠️  Save this password — it will NOT be displayed again.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
