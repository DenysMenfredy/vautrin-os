import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../src/database/database.service.js';
import { InvitationService } from '../src/tenant/invitation.service.js';

describe('InvitationService', () => {
  it('reports an existing tenant slug when Prisma omits the unique target', async () => {
    const uniqueViolation = Object.assign(new Error('Unique constraint failed on (not available)'), {
      code: 'P2002',
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      tenant: { create: vi.fn().mockRejectedValue(uniqueViolation) },
    };
    const database = {
      unscoped: {
        $transaction: (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      },
    } as unknown as DatabaseService;
    const invitations = new InvitationService(database);

    await expect(
      invitations.bootstrapTenant({
        slug: 'sample-remodeling',
        name: 'Sample Remodeling',
        ownerEmail: 'owner@example.com',
      }),
    ).rejects.toThrow('Tenant slug "sample-remodeling" is already taken.');
  });
});
