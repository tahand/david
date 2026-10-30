import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/** Prisma client connected as app_user to the test database. */
export function testPrisma(): PrismaClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL not set; run via `npm run test:db`');
  return new PrismaClient({ datasources: { db: { url } } });
}

/** Unique, obviously fake email so tests never collide on a shared database. */
export const fakeEmail = (prefix = 'user') => `${prefix}.${randomUUID()}@example.test`;

/** Minimal doctor + patient + appointment type fixture for scheduling tests. */
export async function createSchedulingFixture(prisma: PrismaClient) {
  const doctorUser = await prisma.user.create({
    data: { email: fakeEmail('dr'), role: 'doctor', passwordHash: 'x' },
  });
  const doctor = await prisma.doctor.create({
    data: { userId: doctorUser.id, displayName: 'Dr Fixture' },
  });
  const patient = await prisma.patient.create({
    data: { firstName: 'Fixture', lastName: 'Patient', dateOfBirth: new Date('1990-01-01') },
  });
  const type = await prisma.appointmentType.create({
    data: { name: `Type ${randomUUID()}`, durationMinutes: 15, colour: '#123456' },
  });
  return { doctorUser, doctor, patient, type };
}
