import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AdminService } from './service.js';

/**
 * The last-admin rule can't be exercised on the shared test database, which
 * always has other admins, so it is checked here against a stubbed client.
 */
function serviceWith(otherAdmins: number) {
  const target = {
    id: 'target',
    email: 'admin@example.test',
    role: 'admin',
    isActive: true,
    deletedAt: null,
    doctor: null,
    _count: { emailTokens: 0 },
  };
  const prisma = {
    user: {
      findFirst: vi.fn(async () => target),
      count: vi.fn(async () => otherAdmins),
    },
    $transaction: vi.fn(async () => {
      throw new Error('should not write');
    }),
  } as unknown as PrismaClient;
  return new AdminService({
    prisma,
    sessions: { destroyAllForUser: vi.fn() } as never,
    auth: { issuePasswordLink: vi.fn() },
    timezone: 'Europe/London',
  });
}

const actor = { id: 'someone-else', role: 'admin' as const };
const audit = vi.fn();

describe('AdminService last-admin rule', () => {
  it.each([{ role: 'receptionist' as const }, { isActive: false }])(
    'refuses %o for the only active admin',
    async (input) => {
      await expect(serviceWith(0).updateUser(actor, 'target', input, audit)).rejects.toMatchObject({
        status: 409,
        message: 'There must always be at least one active admin',
      });
    },
  );

  it('allows it when another active admin exists', async () => {
    // Gets past the rule and reaches the write, which the stub rejects.
    await expect(
      serviceWith(1).updateUser(actor, 'target', { isActive: false }, audit),
    ).rejects.toThrow('should not write');
  });
});
