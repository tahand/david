import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient, Role } from '@prisma/client';
import { TestClient } from '../../test/client.js';
import { createUser, enrolMfa, login } from '../../test/auth-fixtures.js';
import { testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';
import { aad } from '../../lib/aad.js';
import { FieldCipher } from '../../lib/crypto.js';

let prisma: PrismaClient;
let app: Express;
let cipher: FieldCipher;

beforeAll(() => {
  prisma = testPrisma();
  const { app: built, deps } = buildTestApp({ prisma });
  app = built;
  // Same key the app uses, for seeding encrypted rows directly.
  cipher = FieldCipher.single(deps.config.dataEncryptionKeyVersion, deps.config.dataEncryptionKey);
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Unique surname so searches on the shared test DB only match this test's rows. */
const uniqueName = () => `Zq${randomBytes(5).toString('hex')}`;

async function createPatientRow(
  overrides: Partial<{
    lastName: string;
    dateOfBirth: Date;
    postcode: string;
    phoneMobile: string;
  }> = {},
) {
  return prisma.patient.create({
    data: {
      firstName: 'Fake',
      lastName: overrides.lastName ?? uniqueName(),
      dateOfBirth: overrides.dateOfBirth ?? new Date('1980-05-17'),
      postcode: overrides.postcode ?? null,
      phoneMobile: overrides.phoneMobile ?? null,
    },
  });
}

async function patientClient() {
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

async function staffClient(role: Exclude<Role, 'patient'>) {
  const user = await createUser(prisma, { role });
  const doctor =
    role === 'doctor'
      ? await prisma.doctor.create({ data: { userId: user.id, displayName: 'Dr Test' } })
      : null;
  const client = await new TestClient(app).init();
  await enrolMfa(client, user.email);
  return { client, user, doctor };
}

let slot = 0;
/** Books a past appointment linking a doctor and patient. */
async function linkDoctor(doctorId: string, patientId: string, bookedByUserId: string) {
  const type = await prisma.appointmentType.create({
    data: { name: `Type ${randomUUID()}`, durationMinutes: 15, colour: '#123456' },
  });
  const startsAt = new Date(Date.UTC(2025, 0, 1, 9, 0) + slot++ * 3_600_000);
  return prisma.appointment.create({
    data: {
      patientId,
      doctorId,
      appointmentTypeId: type.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 15 * 60_000),
      bookedByUserId,
    },
  });
}

const auditRows = (action: string, entityId?: string) =>
  prisma.auditLog.findMany({ where: { action, ...(entityId ? { entityId } : {}) } });

const anon = () => new TestClient(app).init();

describe('GET /api/patients/me', () => {
  it('returns the patient their own record and audits the view', async () => {
    const { client, patient, user } = await patientClient();
    const res = await client.get('/api/patients/me');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      id: patient.id,
      email: user.email,
      hasLogin: true,
      dateOfBirth: '1990-02-03',
      medicalSummary: { allergies: [], medications: [], conditions: [] },
    });
    const rows = await auditRows('patient.view', patient.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUserId).toBe(user.id);
  });

  it('401s without a session', async () => {
    expect((await (await anon()).get('/api/patients/me')).status).toBe(401);
  });

  it('403s for staff', async () => {
    const { client } = await staffClient('receptionist');
    expect((await client.get('/api/patients/me')).status).toBe(403);
  });
});

describe('PATCH /api/patients/me', () => {
  it('updates personal and contact details and encrypts sensitive fields at rest', async () => {
    const { client, patient } = await patientClient();
    const res = await client.patch('/api/patients/me', {
      preferredName: 'Patty',
      healthId: '943 476 5919',
      postcode: 'ex1 1aa',
      emergencyContact: { name: 'Fake Contact', relationship: 'Sibling', phone: '01632 960001' },
      // Medical fields are not patient-editable and are stripped.
      accessibilityNeeds: 'should be ignored',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      preferredName: 'Patty',
      healthId: '943 476 5919',
      emergencyContact: { name: 'Fake Contact', email: null },
      accessibilityNeeds: null,
    });

    const [raw] = await prisma.$queryRaw<
      { health_id_enc: string; emergency_contact_enc: string }[]
    >`
      SELECT health_id_enc, emergency_contact_enc FROM patients WHERE id = ${patient.id}::uuid`;
    expect(raw!.health_id_enc).toMatch(/^v1:/);
    expect(raw!.health_id_enc).not.toContain('943');
    expect(raw!.emergency_contact_enc).not.toContain('Fake Contact');

    const rows = await auditRows('patient.update', patient.id);
    expect(rows[0]!.metadata).toMatchObject({ self: true });
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain('943');
  });

  it('clears optional fields with null or an empty string', async () => {
    const { client } = await patientClient();
    await client.patch('/api/patients/me', { pronouns: 'they/them', healthId: '123' });
    const res = await client.patch('/api/patients/me', { pronouns: '', healthId: null });
    expect(res.body).toMatchObject({ pronouns: null, healthId: null });
  });

  it('rejects invalid input', async () => {
    const { client } = await patientClient();
    const res = await client.patch('/api/patients/me', { phoneMobile: 'call me', firstName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'firstName',
      'phoneMobile',
    ]);
  });

  it('401s without a session and 403s for staff', async () => {
    expect((await (await anon()).patch('/api/patients/me', {})).status).toBe(401);
    const { client } = await staffClient('doctor');
    expect((await client.patch('/api/patients/me', {})).status).toBe(403);
  });
});

describe('GET /api/patients/me/export', () => {
  it('downloads the patient data as JSON, including appointments', async () => {
    const { client, patient, user } = await patientClient();
    const { doctor } = await staffClient('doctor');
    const appt = await linkDoctor(doctor!.id, patient.id, user.id);
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { reasonForVisitEnc: cipher.encrypt('Fake cough', aad.appointmentReason(appt.id)) },
    });

    const res = await client.get('/api/patients/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="my-data-.*\.json"$/);
    const body = JSON.parse(res.text);
    expect(body.profile.id).toBe(patient.id);
    expect(body.account.email).toBe(user.email);
    expect(body.appointments).toHaveLength(1);
    expect(body.appointments[0]).toMatchObject({
      doctor: 'Dr Test',
      status: 'booked',
      reasonForVisit: 'Fake cough',
    });
    expect(await auditRows('patient.export', patient.id)).toHaveLength(1);
  });

  it('downloads a PDF copy', async () => {
    const { client } = await patientClient();
    const res = await client.get('/api/patients/me/export?format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(
      Buffer.from(res.body as Buffer)
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  });

  it('rejects an unknown format', async () => {
    const { client } = await patientClient();
    expect((await client.get('/api/patients/me/export?format=xml')).status).toBe(400);
  });

  it('401s without a session and 403s for staff', async () => {
    expect((await (await anon()).get('/api/patients/me/export')).status).toBe(401);
    const { client } = await staffClient('admin');
    expect((await client.get('/api/patients/me/export')).status).toBe(403);
  });
});

describe('GET /api/patients (search)', () => {
  it('finds patients by name, date of birth, phone and postcode', async () => {
    const lastName = uniqueName();
    const dob = new Date(Date.UTC(1931, 0, 1 + Math.floor(Math.random() * 360)));
    const phone = `07700 ${Math.floor(100000 + Math.random() * 899999)}`;
    const target = await createPatientRow({
      lastName,
      dateOfBirth: dob,
      postcode: 'ZZ9 9ZZ',
      phoneMobile: phone,
    });
    const { client, user } = await staffClient('receptionist');

    const byName = await client.get(`/api/patients?search=fake%20${lastName.toLowerCase()}`);
    expect(byName.status).toBe(200);
    expect(byName.body.patients.map((p: { id: string }) => p.id)).toEqual([target.id]);
    expect(byName.body.patients[0]).toEqual({
      id: target.id,
      firstName: 'Fake',
      lastName,
      preferredName: null,
      dateOfBirth: dob.toISOString().slice(0, 10),
      postcode: 'ZZ9 9ZZ',
      phoneMobile: phone,
      hasLogin: false,
    });

    const [d, m, y] = [dob.getUTCDate(), dob.getUTCMonth() + 1, dob.getUTCFullYear()];
    const byDob = await client.get(`/api/patients?search=${d}/${m}/${y}`);
    expect(byDob.body.patients.map((p: { id: string }) => p.id)).toContain(target.id);

    const byPhone = await client.get(`/api/patients?search=${phone.replace(' ', '')}`);
    expect(byPhone.body.patients.map((p: { id: string }) => p.id)).toContain(target.id);

    const byPostcode = await client.get('/api/patients?search=zz99zz');
    expect(byPostcode.body.patients.map((p: { id: string }) => p.id)).toContain(target.id);

    const rows = await prisma.auditLog.findMany({
      where: { action: 'patient.search', actorUserId: user.id },
    });
    expect(rows).toHaveLength(4);
    expect(JSON.stringify(rows[0]!.metadata)).not.toContain(lastName.toLowerCase());
  });

  it('excludes soft-deleted patients', async () => {
    const lastName = uniqueName();
    await prisma.patient.update({
      where: { id: (await createPatientRow({ lastName })).id },
      data: { deletedAt: new Date() },
    });
    const { client } = await staffClient('admin');
    const res = await client.get(`/api/patients?search=${lastName}`);
    expect(res.body.patients).toEqual([]);
  });

  it('shows doctors only their own patients', async () => {
    const lastName = uniqueName();
    const mine = await createPatientRow({ lastName });
    await createPatientRow({ lastName });
    const { client, doctor, user } = await staffClient('doctor');
    await linkDoctor(doctor!.id, mine.id, user.id);
    const res = await client.get(`/api/patients?search=${lastName}`);
    expect(res.body.patients.map((p: { id: string }) => p.id)).toEqual([mine.id]);
  });

  it('rejects an invalid page', async () => {
    const { client } = await staffClient('receptionist');
    expect((await client.get('/api/patients?page=0')).status).toBe(400);
  });

  it('401s without a session and 403s for patients', async () => {
    expect((await (await anon()).get('/api/patients')).status).toBe(401);
    const { client } = await patientClient();
    expect((await client.get('/api/patients')).status).toBe(403);
  });

  it('403s for staff who have not enrolled MFA', async () => {
    const user = await createUser(prisma, { role: 'receptionist' });
    const client = await new TestClient(app).init();
    await login(client, user.email);
    const res = await client.get('/api/patients');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_ENROLMENT_REQUIRED');
  });
});

describe('POST /api/patients', () => {
  const valid = () => ({
    firstName: 'New',
    lastName: uniqueName(),
    dateOfBirth: '1975-11-30',
    healthId: '485 777 3456',
    contactEmail: 'new.patient@example.test',
    emergencyContact: { name: 'Fake Kin', relationship: 'Parent', phone: '01632 960002' },
  });

  it('lets a receptionist create a record without a login, encrypted at rest', async () => {
    const { client } = await staffClient('receptionist');
    const res = await client.post('/api/patients', valid());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      hasLogin: false,
      email: 'new.patient@example.test',
      healthId: '485 777 3456',
      preferredContact: 'email',
    });
    const row = await prisma.patient.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.healthIdEnc).not.toContain('485');
    expect(row.emergencyContactEnc).not.toContain('Fake Kin');
    expect(await auditRows('patient.create', res.body.id)).toHaveLength(1);
  });

  it('rejects missing required fields', async () => {
    const { client } = await staffClient('admin');
    const res = await client.post('/api/patients', { firstName: 'Only' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['lastName', 'dateOfBirth']));
  });

  it('401s without a session and 403s for doctors and patients', async () => {
    expect((await (await anon()).post('/api/patients', valid())).status).toBe(401);
    expect((await (await staffClient('doctor')).client.post('/api/patients', valid())).status).toBe(
      403,
    );
    expect((await (await patientClient()).client.post('/api/patients', valid())).status).toBe(403);
  });
});

describe('GET /api/patients/:id', () => {
  it('returns any record to reception and audits the view', async () => {
    const target = await createPatientRow();
    const { client, user } = await staffClient('receptionist');
    const res = await client.get(`/api/patients/${target.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(target.id);
    const rows = await auditRows('patient.view', target.id);
    expect(rows.map((r) => r.actorUserId)).toContain(user.id);
  });

  it('lets a doctor see a patient with an appointment with them', async () => {
    const target = await createPatientRow();
    const { client, doctor, user } = await staffClient('doctor');
    await linkDoctor(doctor!.id, target.id, user.id);
    expect((await client.get(`/api/patients/${target.id}`)).status).toBe(200);
  });

  it('404s for a doctor without an appointment with the patient, and audits the attempt', async () => {
    const target = await createPatientRow();
    const { client, user } = await staffClient('doctor');
    const res = await client.get(`/api/patients/${target.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    const rows = await auditRows('patient.access_denied', target.id);
    expect(rows.map((r) => r.actorUserId)).toEqual([user.id]);
  });

  it('404s for unknown, malformed and soft-deleted IDs', async () => {
    const deleted = await createPatientRow();
    await prisma.patient.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const { client } = await staffClient('admin');
    for (const id of [randomUUID(), 'not-a-uuid', deleted.id]) {
      expect((await client.get(`/api/patients/${id}`)).status).toBe(404);
    }
  });

  it('401s without a session and 403s for patients, even for their own ID', async () => {
    const { client, patient } = await patientClient();
    expect((await (await anon()).get(`/api/patients/${patient.id}`)).status).toBe(401);
    expect((await client.get(`/api/patients/${patient.id}`)).status).toBe(403);
  });
});

describe('PATCH /api/patients/:id', () => {
  it('lets reception edit details', async () => {
    const target = await createPatientRow();
    const { client } = await staffClient('receptionist');
    const res = await client.patch(`/api/patients/${target.id}`, {
      city: 'Exampletown',
      contactEmail: 'Fake.Person@Example.test',
      interpreterRequired: true,
      preferredLanguage: 'Welsh',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      city: 'Exampletown',
      email: 'fake.person@example.test',
      interpreterRequired: true,
    });
    const [row] = await auditRows('patient.update', target.id);
    expect(row!.metadata).toMatchObject({
      fields: expect.arrayContaining(['city', 'contactEmail', 'interpreterRequired']),
    });
  });

  it('rejects invalid input', async () => {
    const target = await createPatientRow();
    const { client } = await staffClient('receptionist');
    const res = await client.patch(`/api/patients/${target.id}`, { dateOfBirth: '2999-01-01' });
    expect(res.status).toBe(400);
  });

  it('404s for unknown IDs', async () => {
    const { client } = await staffClient('admin');
    expect((await client.patch(`/api/patients/${randomUUID()}`, { city: 'X' })).status).toBe(404);
  });

  it('401s without a session and 403s for doctors', async () => {
    const target = await createPatientRow();
    expect((await (await anon()).patch(`/api/patients/${target.id}`, {})).status).toBe(401);
    const { client, doctor, user } = await staffClient('doctor');
    await linkDoctor(doctor!.id, target.id, user.id);
    expect((await client.patch(`/api/patients/${target.id}`, { city: 'X' })).status).toBe(403);
  });
});

describe('PUT /api/patients/:id/medical-summary', () => {
  const summary = {
    allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
    medications: [{ name: 'Fakeprofen', dose: '200 mg', frequency: 'twice daily' }],
    conditions: [{ condition: 'Asthma', diagnosedDate: '2001-04-01' }],
    gpDetails: { name: 'Dr Fake', practice: 'Example Surgery', phone: '01632 960003' },
    accessibilityNeeds: 'Step-free access',
  };

  it("lets the patient's doctor replace the summary, encrypted at rest", async () => {
    const target = await createPatientRow();
    const { client, doctor, user } = await staffClient('doctor');
    await linkDoctor(doctor!.id, target.id, user.id);
    const res = await client.put(`/api/patients/${target.id}/medical-summary`, summary);
    expect(res.status).toBe(200);
    expect(res.body.medicalSummary).toEqual({
      allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
      medications: [{ name: 'Fakeprofen', dose: '200 mg', frequency: 'twice daily' }],
      conditions: [{ condition: 'Asthma', diagnosedDate: '2001-04-01', notes: null }],
    });
    expect(res.body.gpDetails).toEqual(summary.gpDetails);

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.medicalSummaryEnc).toMatch(/^v1:/);
    expect(row.medicalSummaryEnc).not.toContain('Penicillin');
    expect(await auditRows('patient.medical_summary.update', target.id)).toHaveLength(1);

    // Replacing with an empty body clears the section.
    const cleared = await client.put(`/api/patients/${target.id}/medical-summary`, {});
    expect(cleared.body).toMatchObject({
      medicalSummary: { allergies: [], medications: [], conditions: [] },
      gpDetails: null,
      accessibilityNeeds: null,
    });
  });

  it('lets reception update the summary', async () => {
    const target = await createPatientRow();
    const { client } = await staffClient('receptionist');
    const res = await client.put(`/api/patients/${target.id}/medical-summary`, summary);
    expect(res.status).toBe(200);
  });

  it('rejects invalid entries', async () => {
    const target = await createPatientRow();
    const { client } = await staffClient('receptionist');
    const res = await client.put(`/api/patients/${target.id}/medical-summary`, {
      allergies: [{ substance: '', severity: 'extreme' }],
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['allergies.0.substance', 'allergies.0.severity']),
    );
  });

  it("404s for a doctor who isn't treating the patient", async () => {
    const target = await createPatientRow();
    const { client } = await staffClient('doctor');
    const res = await client.put(`/api/patients/${target.id}/medical-summary`, summary);
    expect(res.status).toBe(404);
  });

  it('401s without a session and 403s for patients', async () => {
    const { client, patient } = await patientClient();
    const path = `/api/patients/${patient.id}/medical-summary`;
    expect((await (await anon()).put(path, summary)).status).toBe(401);
    expect((await client.put(path, summary)).status).toBe(403);
  });
});

describe('encryption binding', () => {
  it('refuses ciphertext moved from another patient', async () => {
    const { client, patient } = await patientClient();
    await client.patch('/api/patients/me', { healthId: '111 222 3333' });
    const source = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    const other = await createPatientRow();
    await prisma.patient.update({
      where: { id: other.id },
      data: { healthIdEnc: source.healthIdEnc },
    });
    const { client: reception } = await staffClient('receptionist');
    const res = await reception.get(`/api/patients/${other.id}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('111 222 3333');
  });
});
