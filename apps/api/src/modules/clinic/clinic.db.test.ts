import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TestClient } from '../../test/client.js';
import { testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';

let prisma: PrismaClient;
beforeAll(() => {
  prisma = testPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/clinic', () => {
  it('returns public branding only, without authentication', async () => {
    const { app } = buildTestApp({ prisma });
    const res = await new TestClient(app).get('/api/clinic');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['clinicAddress', 'clinicName', 'clinicPhone', 'consentVersion', 'healthIdLabel'].sort(),
    );
    expect(res.body.clinicName).toBeTruthy();
  });
});
