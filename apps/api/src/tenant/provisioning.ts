import { ConflictException } from '@nestjs/common';
import type { Prisma, Tenant } from '@vautrin/database';

/** Shared operator provisioning. Never creates an identity or chooses a password. */
export async function provisionTenantConfiguration(
  tx: Prisma.TransactionClient,
  input: {
    slug: string;
    name: string;
    vertical?: string;
    timezone?: string;
  },
) {
  const [generated] = await tx.$queryRaw<Array<{ id: string }>>`SELECT uuidv7()::text AS id`;
  if (!generated) throw new Error('Failed to generate tenant id.');
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${generated.id}, true)`;
  let tenant: Tenant;
  try {
    tenant = await tx.tenant.create({
      data: {
        id: generated.id,
        slug: input.slug,
        name: input.name,
        vertical: input.vertical ?? 'remodeling',
      },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw new ConflictException(`Tenant slug "${input.slug}" is already taken.`);
    }
    throw error;
  }
  await tx.businessProfile.create({
    data: { tenantId: tenant.id, displayName: tenant.name, timezone: input.timezone ?? 'UTC' },
    select: { id: true },
  });
  await tx.service.create({
    data: {
      tenantId: tenant.id,
      key: 'general',
      name:
        input.vertical === 'generic-local-business' ? 'General service' : 'Remodeling consultation',
    },
    select: { id: true },
  });
  return tenant;
}
