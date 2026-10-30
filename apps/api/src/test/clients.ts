import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { createUser, enrolMfa, login } from './auth-fixtures.js';
import { TestClient } from './client.js';

/** Unique surname so searches on the shared test DB only match this test's rows. */
export const uniqueName = () => `Zq${randomBytes(5).toString('hex')}`;

export const anonClient = (app: Express) => new TestClient(app).init();

/** A signed-in patient with a patient record. */
export async function patientClient(app: Express, prisma: PrismaClient) {
  const user = await createUser(prisma, { role: 'patient' });
  const patient = await prisma.patient.create({
    data: {
      userId: user.id,
      firstName: 'Pat',
      lastName: uniqueName(),
      dateOfBirth: new Date('1990-02-03'),
    },
  });
  const client = await new TestClient(app).init();
  await login(client, user.email);
  return { client, user, patient };
}

/** A signed-in staff member with MFA enrolled; doctors also get a doctor profile. */
export async function staffClient(
  app: Express,
  prisma: PrismaClient,
  role: Exclude<Role, 'patient'>,
  doctorName = 'Dr Test',
) {
  const user = await createUser(prisma, { role });
  const doctor =
    role === 'doctor'
      ? await prisma.doctor.create({ data: { userId: user.id, displayName: doctorName } })
      : null;
  const client = await new TestClient(app).init();
  await enrolMfa(client, user.email);
  return { client, user, doctor };
}
