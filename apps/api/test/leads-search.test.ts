import { Prisma } from '@vautrin/database';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../src/database/database.service.js';
import { LeadsService } from '../src/leads/leads.service.js';

describe('LeadsService search', () => {
  it('matches every word against the linked contact name and contact details', async () => {
    let capturedWhere: Prisma.LeadWhereInput | undefined;
    const transaction = {
      lead: {
        findMany: vi.fn(async ({ where }: { where: Prisma.LeadWhereInput }) => {
          capturedWhere = where;
          return [];
        }),
      },
    };
    const database = {
      withTenant: async (
        _tenantId: string,
        operation: (client: typeof transaction) => Promise<unknown>,
      ) => operation(transaction),
    } as unknown as DatabaseService;

    const result = await new LeadsService(database).list('tenant-1', { search: 'Maya Garcia' });

    expect(result).toMatchObject({ items: [], nextCursor: null });
    const contactClause = capturedWhere?.OR?.find((clause) => clause.contact !== undefined);
    expect(contactClause?.contact).toMatchObject({
      is: {
        AND: [
          {
            OR: expect.arrayContaining([
              { firstName: { contains: 'Maya', mode: 'insensitive' } },
              { lastName: { contains: 'Maya', mode: 'insensitive' } },
            ]),
          },
          {
            OR: expect.arrayContaining([
              { firstName: { contains: 'Garcia', mode: 'insensitive' } },
              { lastName: { contains: 'Garcia', mode: 'insensitive' } },
            ]),
          },
        ],
      },
    });
  });
});
