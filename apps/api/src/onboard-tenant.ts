import 'reflect-metadata';

import { ConflictException, ForbiddenException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { EnvironmentModule } from './config/environment.module.js';
import { DatabaseModule } from './database/database.module.js';
import { InvitationService } from './tenant/invitation.service.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({ imports: [EnvironmentModule, DatabaseModule, TenantModule] })
class OnboardingModule {}

class CliInputError extends Error {}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new CliInputError(`Required argument: --${name} VALUE`);
  }
  return value;
}

async function main(): Promise<void> {
  const reissue = process.argv.includes('--reissue-owner');
  const ownerEmail = argument('owner-email');
  const operation = reissue
    ? { kind: 'reissue' as const, tenantId: argument('tenant-id') }
    : { kind: 'create' as const, slug: argument('slug'), name: argument('name') };
  if (operation.kind === 'create' && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(operation.slug)) {
    throw new CliInputError('slug must be 2-63 lowercase letters, digits, or hyphens.');
  }
  if (
    (operation.kind === 'create' && operation.name.length > 200) ||
    ownerEmail.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) ||
    (operation.kind === 'reissue' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operation.tenantId))
  ) {
    throw new CliInputError('Invalid tenant name, tenant id, or owner email.');
  }

  const app = await NestFactory.createApplicationContext(OnboardingModule, { logger: false });
  try {
    const service = app.get(InvitationService);
    const result =
      operation.kind === 'reissue'
        ? await service.reissueBootstrapOwner({ tenantId: operation.tenantId, ownerEmail })
        : await service.bootstrapTenant({
            slug: operation.slug,
            name: operation.name,
            ownerEmail,
          });
    // Deliberately emitted once to the operator, never persisted or logged.
    // Capture and deliver this credential through a secure channel.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  // Do not print database errors: they may contain secret-bearing query data.
  const message =
    error instanceof CliInputError ||
    error instanceof ConflictException ||
    error instanceof ForbiddenException
      ? error.message
      : 'Check database connectivity and configuration.';
  process.stderr.write(`Tenant onboarding failed: ${message}\n`);
  process.exitCode = 1;
});
