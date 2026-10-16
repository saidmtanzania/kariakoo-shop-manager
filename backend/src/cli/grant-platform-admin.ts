/**
 * Grants or removes platform-operator access (User.isPlatformAdmin). This
 * command, run by someone with database access, is the only way to change
 * it: no API can, so a shop owner can never make anyone a platform admin.
 *
 *   pnpm --filter backend platform:admin grant someone@example.com
 *   pnpm --filter backend platform:admin revoke someone@example.com
 */
import { newId } from '../common/ids/ids.js';
import { validateEnv } from '../config/env.schema.js';
import { PrismaService } from '../database/index.js';
import { loadLocalEnv } from '../load-env.js';

async function main(): Promise<number> {
  const [action, email] = process.argv.slice(2);
  if ((action !== 'grant' && action !== 'revoke') || !email) {
    process.stderr.write('Usage: platform:admin grant|revoke <email>\n');
    return 2;
  }
  loadLocalEnv();
  const prisma = new PrismaService(validateEnv(process.env));
  try {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      process.stderr.write(
        `No user with email ${email}. They must register first.\n`,
      );
      return 1;
    }
    const grant = action === 'grant';
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { isPlatformAdmin: grant },
      }),
      prisma.auditLog.create({
        data: {
          id: newId(),
          action: grant ? 'platform.admin_granted' : 'platform.admin_revoked',
          entityType: 'user',
          entityId: user.id,
          before: { isPlatformAdmin: user.isPlatformAdmin },
          after: { isPlatformAdmin: grant, via: 'cli' },
        },
      }),
    ]);
    process.stdout.write(
      `${grant ? 'Granted' : 'Removed'} platform admin for ${user.email}.\n`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
