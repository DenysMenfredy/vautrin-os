import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PlatformRepository } from './admin/platform.repository.js';
import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DatabaseService } from './database/database.service.js';

@Module({ imports: [EnvironmentModule, DatabaseModule], providers: [PlatformRepository] })
class BootstrapAdminModule {}
async function main() {
  const index = process.argv.indexOf('--email');
  const email = process.argv[index + 1]?.trim().toLowerCase();
  if (index < 0 || !email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Supply --email for an existing invitation-accepted identity.');
  const app = await NestFactory.createApplicationContext(BootstrapAdminModule, { logger: false });
  try {
    const database = app.get(DatabaseService);
    // The normal identity role verifies that the account has accepted an
    // invitation and set a password. The platform role never reads the hash.
    // nosemgrep: semgrep.vautrin-unscoped-database-access
    const candidate = await database.unscoped.user.findUnique({
      where: { email },
      select: { id: true, status: true, deletedAt: true, passwordHash: true },
    });
    if (candidate?.status !== 'ACTIVE' || candidate.deletedAt || !candidate.passwordHash)
      throw new Error(
        'The identity must first accept an invitation. This command never creates users or passwords.',
      );
    await app.get(PlatformRepository).transaction(async (tx) => {
      if (
        await tx.platformAccess.count({
          where: {
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
            user: { status: 'ACTIVE', deletedAt: null },
          },
        })
      )
        throw new Error(
          'A super administrator already exists. Use the authenticated Admin Console to manage access.',
        );
      const user = await tx.user.findUnique({
        where: { id: candidate.id },
        select: { id: true, status: true, deletedAt: true },
      });
      if (user?.status !== 'ACTIVE' || user.deletedAt)
        throw new Error(
          'The identity must first accept an invitation. This command never creates users or passwords.',
        );
      await tx.platformAccess.upsert({
        where: { userId: user.id },
        create: { userId: user.id, role: 'SUPER_ADMIN', createdByUserId: user.id },
        update: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      await tx.platformAuditLog.create({
        data: {
          actorUserId: user.id,
          actorRole: 'SUPER_ADMIN',
          action: 'platform.access.granted',
          targetType: 'user',
          targetId: user.id,
          reason: 'Initial operator bootstrap',
          metadata: { bootstrap: true },
        },
      });
    });
    process.stdout.write(
      'Initial platform administrator granted. Sign in to the Admin Console with the existing account.\n',
    );
  } finally {
    await app.close();
  }
}
main().catch((error: unknown) => {
  const allowed = [
    'Supply --email',
    'A super administrator already exists.',
    'The identity must first accept',
  ];
  const message =
    error instanceof Error && allowed.some((prefix) => error.message.startsWith(prefix))
      ? error.message
      : 'Check platform database configuration and restricted role grants.';
  process.stderr.write(`Platform bootstrap failed: ${message}\n`);
  process.exitCode = 1;
});
