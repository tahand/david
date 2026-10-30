import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createUser, login } from '../../test/auth-fixtures.js';
import { TestClient } from '../../test/client.js';
import { anonClient, patientClient, staffClient, uniqueName } from '../../test/clients.js';
import { testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';
import {
  HOUR,
  MINUTE,
  appointmentType as appointmentTypeFor,
  at,
  insertAppointment as insertAppointmentFor,
  mondayAhead,
  workingDoctor as workingDoctorFor,
} from '../../test/scheduling.js';

let prisma: PrismaClient;
let app: Express;
beforeAll(() => {
  prisma = testPrisma();
  app = buildTestApp({ prisma }).app;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const SOON = mondayAhead(8);
const workingDoctor = () => workingDoctorFor(app, prisma);
const appointmentType = (overrides: { patientBookable?: boolean } = {}) =>
  appointmentTypeFor(prisma, overrides);
const insertAppointment = (opts: Parameters<typeof insertAppointmentFor>[1]) =>
  insertAppointmentFor(prisma, opts);

/** A fresh scenario: a working doctor, a bookable type and a signed-in patient. */
async function scenario() {
  const doctor = await workingDoctor();
  const type = await appointmentType();
  const patient = await patientClient(app, prisma);
  const book = (client: TestClient, time: string, extra: object = {}) =>
    client.post('/api/appointments', {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: type.id,
      startsAt: at(SOON, time),
      ...extra,
    });
  return { doctor, type, patient, book };
}

describe('GET /api/appointment-types', () => {
  it('shows patients only patient-bookable types; staff see all active types', async () => {
    const open = await appointmentType();
    const staffOnly = await appointmentType({ patientBookable: false });
    const { client: patient } = await patientClient(app, prisma);
    const ids = (await patient.get('/api/appointment-types')).body.appointmentTypes.map(
      (t: { id: string }) => t.id,
    );
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(staffOnly.id);

    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const staffIds = (await reception.get('/api/appointment-types')).body.appointmentTypes.map(
      (t: { id: string }) => t.id,
    );
    expect(staffIds).toEqual(expect.arrayContaining([open.id, staffOnly.id]));
  });

  it('requires sign-in', async () => {
    expect((await (await anonClient(app)).get('/api/appointment-types')).status).toBe(401);
  });
});

describe('POST /api/appointments', () => {
  it('books a free slot for the signed-in patient, encrypting the reason', async () => {
    const { patient, book, doctor } = await scenario();
    const res = await book(patient.client, '09:00', { reasonForVisit: 'Sore knee' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'booked',
      startsAtLocal: `${SOON}T09:00`,
      endsAtLocal: `${SOON}T09:15`,
      doctor: { id: doctor.doctor!.id },
      patient: { id: patient.patient.id },
      canChange: true,
    });

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.bookedByUserId).toBe(patient.user.id);
    expect(row.reasonForVisitEnc).toBeTruthy();
    expect(row.reasonForVisitEnc).not.toContain('Sore knee');
    const events = await prisma.appointmentEvent.findMany({ where: { appointmentId: row.id } });
    expect(events).toMatchObject([{ fromStatus: null, toStatus: 'booked' }]);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'appointment.create', entityId: row.id },
    });
    expect(audit?.actorUserId).toBe(patient.user.id);

    const detail = await patient.client.get(`/api/appointments/${row.id}`);
    expect(detail.body.reasonForVisit).toBe('Sore knee');
  });

  it('rejects invalid input', async () => {
    const { patient } = await scenario();
    const res = await patient.client.post('/api/appointments', { doctorId: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires sign-in, and doctors cannot book', async () => {
    const { book, doctor } = await scenario();
    expect((await book(await anonClient(app), '09:00')).status).toBe(401);
    expect((await book(doctor.client, '09:00')).status).toBe(403);
  });

  it('needs a verified email address for patients', async () => {
    const { book } = await scenario();
    const user = await createUser(prisma, { role: 'patient', verified: false });
    await prisma.patient.create({
      data: { userId: user.id, firstName: 'Un', lastName: uniqueName(), dateOfBirth: new Date() },
    });
    const client = await new TestClient(app).init();
    await login(client, user.email);
    const res = await book(client, '09:00');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('returns 409 SLOT_UNAVAILABLE for a taken or off-grid time', async () => {
    const { patient, book } = await scenario();
    expect((await book(patient.client, '09:00')).status).toBe(201);
    const other = await patientClient(app, prisma);
    const taken = await book(other.client, '09:00');
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await book(other.client, '09:07')).body.error.code).toBe('SLOT_UNAVAILABLE');
    expect((await book(other.client, '19:00')).body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('lets exactly one of two simultaneous bookings for a slot succeed', async () => {
    const { book } = await scenario();
    const [a, b] = await Promise.all([patientClient(app, prisma), patientClient(app, prisma)]);
    const results = await Promise.all([book(a.client, '10:00'), book(b.client, '10:00')]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('rejects past times and patient bookings beyond the horizon', async () => {
    const { patient, doctor, type } = await scenario();
    const past = await patient.client.post('/api/appointments', {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: type.id,
      startsAt: new Date(Date.now() - HOUR).toISOString(),
    });
    expect(past.status).toBe(400);
    const far = await patient.client.post('/api/appointments', {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: type.id,
      startsAt: at(mondayAhead(70), '09:00'),
    });
    expect(far.status).toBe(400);
    expect(far.body.error.details[0].message).toMatch(/60 days/);
  });

  it('hides staff-only types from patients (404)', async () => {
    const { patient, doctor } = await scenario();
    const staffOnly = await appointmentType({ patientBookable: false });
    const res = await patient.client.post('/api/appointments', {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: staffOnly.id,
      startsAt: at(SOON, '09:00'),
    });
    expect(res.status).toBe(404);
  });

  it('caps a patient at 3 upcoming appointments', async () => {
    const { patient, book } = await scenario();
    for (const time of ['09:00', '09:30', '10:00']) {
      expect((await book(patient.client, time)).status).toBe(201);
    }
    const fourth = await book(patient.client, '10:30');
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('CONFLICT');
  });

  it('stops a patient double-booking themselves with two doctors', async () => {
    const { patient, book, type } = await scenario();
    expect((await book(patient.client, '11:00')).status).toBe(201);
    const second = await workingDoctor();
    const res = await patient.client.post('/api/appointments', {
      doctorId: second.doctor!.id,
      appointmentTypeId: type.id,
      startsAt: at(SOON, '11:00'),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already has an appointment/);
  });

  it('lets reception book for a named patient, including staff-only types', async () => {
    const { doctor, patient } = await scenario();
    const staffOnly = await appointmentType({ patientBookable: false });
    const { client: reception, user } = await staffClient(app, prisma, 'receptionist');
    const body = {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: staffOnly.id,
      startsAt: at(SOON, '12:00'),
    };
    const missing = await reception.post('/api/appointments', body);
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('patientId');

    const res = await reception.post('/api/appointments', {
      ...body,
      patientId: patient.patient.id,
    });
    expect(res.status).toBe(201);
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.bookedByUserId).toBe(user.id);
    expect(row.patientId).toBe(patient.patient.id);
  });
});

describe('GET /api/appointments', () => {
  it('scopes the list by role', async () => {
    const { patient, book, doctor } = await scenario();
    const mine = (await book(patient.client, '09:00')).body.id;
    const other = await patientClient(app, prisma);
    const theirs = (await book(other.client, '09:30')).body.id;
    const otherDoctor = await workingDoctor();

    const ids = async (client: TestClient, query = '') =>
      ((await client.get(`/api/appointments${query}`)).body.appointments ?? []).map(
        (a: { id: string }) => a.id,
      );
    expect(await ids(patient.client)).toEqual([mine]);
    // A patient can't widen their scope by naming someone else.
    expect(await ids(patient.client, `?patientId=${other.patient.id}`)).toEqual([]);

    const range = `?from=${SOON}&to=${SOON}`;
    expect(await ids(doctor.client, range)).toEqual(expect.arrayContaining([mine, theirs]));
    expect(await ids(otherDoctor.client, range)).not.toContain(mine);
    expect(await ids(otherDoctor.client, `${range}&doctorId=${doctor.doctor!.id}`)).toEqual([]);

    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    expect(await ids(reception, `${range}&doctorId=${doctor.doctor!.id}`)).toEqual([mine, theirs]);
    expect(await ids(reception, `?patientId=${other.patient.id}`)).toEqual([theirs]);
  });

  it('needs a date range for staff schedules', async () => {
    const { client } = await staffClient(app, prisma, 'receptionist');
    const res = await client.get('/api/appointments');
    expect(res.status).toBe(400);
    expect((await client.get(`/api/appointments?from=${SOON}&to=2099-01-01`)).status).toBe(400);
  });

  it('requires sign-in', async () => {
    expect((await (await anonClient(app)).get('/api/appointments')).status).toBe(401);
  });
});

describe('GET /api/appointments/:id', () => {
  it("is 404 for someone else's appointment, and the probe is audited", async () => {
    const { patient, book } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    const other = await patientClient(app, prisma);
    expect((await other.client.get(`/api/appointments/${id}`)).status).toBe(404);
    const otherDoctor = await workingDoctor();
    expect((await otherDoctor.client.get(`/api/appointments/${id}`)).status).toBe(404);
    expect((await other.client.get('/api/appointments/not-a-uuid')).status).toBe(404);

    const denied = await prisma.auditLog.findFirst({
      where: { action: 'appointment.access_denied', entityId: id, actorUserId: other.user.id },
    });
    expect(denied).not.toBeNull();
    const viewed = await prisma.auditLog.count({
      where: { action: 'appointment.view', entityId: id, actorUserId: other.user.id },
    });
    expect(viewed).toBe(0);
  });
});

describe('PATCH /api/appointments/:id/reschedule', () => {
  it('moves the appointment and resets it to booked', async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    await prisma.appointment.update({ where: { id }, data: { status: 'confirmed' } });
    const res = await patient.client.patch(`/api/appointments/${id}/reschedule`, {
      startsAt: at(SOON, '14:00'),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'booked', startsAtLocal: `${SOON}T14:00` });
    // The old time is free again.
    const other = await patientClient(app, prisma);
    const rebook = await other.client.post('/api/appointments', {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: res.body.appointmentType.id,
      startsAt: at(SOON, '09:00'),
    });
    expect(rebook.status).toBe(201);
  });

  it('allows moving to an overlapping time on the same doctor', async () => {
    const { patient, book } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    const res = await patient.client.patch(`/api/appointments/${id}/reschedule`, {
      startsAt: at(SOON, '09:00'),
    });
    expect(res.status).toBe(200);
  });

  it('is closed to patients inside the cutoff, but open to reception', async () => {
    const { patient, doctor, type } = await scenario();
    const row = await insertAppointment({
      patientId: patient.patient.id,
      doctorId: doctor.doctor!.id,
      typeId: type.id,
      startsAt: new Date(Date.now() + 3 * HOUR),
      bookedByUserId: patient.user.id,
    });
    const list = (await patient.client.get('/api/appointments')).body.appointments;
    expect(list.find((a: { id: string }) => a.id === row.id).canChange).toBe(false);

    const res = await patient.client.patch(`/api/appointments/${row.id}/reschedule`, {
      startsAt: at(SOON, '09:00'),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CHANGE_WINDOW_CLOSED');
    expect(res.body.error.message).toMatch(/call the clinic/);

    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const moved = await reception.patch(`/api/appointments/${row.id}/reschedule`, {
      startsAt: at(SOON, '09:00'),
    });
    expect(moved.status).toBe(200);
  });

  it('validates the body and rejects doctors', async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    expect((await patient.client.patch(`/api/appointments/${id}/reschedule`, {})).status).toBe(400);
    const move = { startsAt: at(SOON, '10:00') };
    expect((await doctor.client.patch(`/api/appointments/${id}/reschedule`, move)).status).toBe(
      403,
    );
    const anon = await anonClient(app);
    expect((await anon.patch(`/api/appointments/${id}/reschedule`, move)).status).toBe(401);
  });
});

describe('PATCH /api/appointments/:id/cancel', () => {
  it('cancels for the patient and frees the slot', async () => {
    const { patient, book } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    const res = await patient.client.patch(`/api/appointments/${id}/cancel`, {
      reason: 'Feeling better',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled_by_patient', canChange: false });
    expect(res.body.cancelledReason).toBe('Feeling better');
    const other = await patientClient(app, prisma);
    expect((await book(other.client, '09:00')).status).toBe(201);
    // Already cancelled.
    expect((await patient.client.patch(`/api/appointments/${id}/cancel`, {})).status).toBe(409);
  });

  it('records reception cancellations as cancelled by the clinic', async () => {
    const { patient, book } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const res = await reception.patch(`/api/appointments/${id}/cancel`, {});
    expect(res.body.status).toBe('cancelled_by_clinic');
    const events = await prisma.appointmentEvent.findMany({
      where: { appointmentId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.toStatus)).toEqual(['booked', 'cancelled_by_clinic']);
  });

  it("is 404 for another patient's appointment and 403 for doctors", async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    const other = await patientClient(app, prisma);
    expect((await other.client.patch(`/api/appointments/${id}/cancel`, {})).status).toBe(404);
    expect((await doctor.client.patch(`/api/appointments/${id}/cancel`, {})).status).toBe(403);
    const tooLong = { reason: 'x'.repeat(201) };
    expect((await patient.client.patch(`/api/appointments/${id}/cancel`, tooLong)).status).toBe(
      400,
    );
  });
});

describe('PATCH /api/appointments/:id/status', () => {
  async function started(status: 'booked' | 'checked_in' = 'booked') {
    const s = await scenario();
    const row = await insertAppointment({
      patientId: s.patient.patient.id,
      doctorId: s.doctor.doctor!.id,
      typeId: s.type.id,
      startsAt: new Date(Date.now() - 5 * MINUTE),
      bookedByUserId: s.patient.user.id,
      status,
    });
    return { ...s, row };
  }

  it('lets reception check a patient in and the doctor complete the appointment', async () => {
    const { row, doctor } = await started();
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const checkIn = await reception.patch(`/api/appointments/${row.id}/status`, {
      status: 'checked_in',
    });
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.status).toBe('checked_in');
    // Reception can't complete; the doctor can.
    expect(
      (await reception.patch(`/api/appointments/${row.id}/status`, { status: 'completed' })).status,
    ).toBe(403);
    const done = await doctor.client.patch(`/api/appointments/${row.id}/status`, {
      status: 'completed',
    });
    expect(done.body.status).toBe('completed');
    const audit = await prisma.auditLog.count({
      where: { action: 'appointment.status', entityId: row.id },
    });
    expect(audit).toBe(2);
  });

  it('rejects impossible transitions and early check-in / no-show', async () => {
    const { row, doctor, patient, book } = await started('checked_in');
    const noShow = await doctor.client.patch(`/api/appointments/${row.id}/status`, {
      status: 'no_show',
    });
    expect(noShow.status).toBe(409);

    const future = (await book(patient.client, '09:00')).body.id;
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const early = await reception.patch(`/api/appointments/${future}/status`, {
      status: 'checked_in',
    });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/day of their appointment/);
    expect(
      (await reception.patch(`/api/appointments/${future}/status`, { status: 'no_show' })).status,
    ).toBe(409);
    expect(
      (await reception.patch(`/api/appointments/${future}/status`, { status: 'confirmed' })).body
        .status,
    ).toBe('confirmed');
  });

  it('validates the status, and is closed to patients and other doctors', async () => {
    const { row, patient } = await started();
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    expect(
      (await reception.patch(`/api/appointments/${row.id}/status`, { status: 'booked' })).status,
    ).toBe(400);
    const body = { status: 'checked_in' };
    expect((await patient.client.patch(`/api/appointments/${row.id}/status`, body)).status).toBe(
      403,
    );
    const otherDoctor = await workingDoctor();
    expect(
      (await otherDoctor.client.patch(`/api/appointments/${row.id}/status`, body)).status,
    ).toBe(404);
    const anon = await anonClient(app);
    expect((await anon.patch(`/api/appointments/${row.id}/status`, body)).status).toBe(401);
  });
});

describe('/api/appointments/:id/notes', () => {
  it('lets the doctor add and amend encrypted notes, oldest first', async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    const first = await doctor.client.post(`/api/appointments/${id}/notes`, {
      body: 'Knee examined; mild swelling.',
    });
    expect(first.status).toBe(201);
    const amend = await doctor.client.post(`/api/appointments/${id}/notes`, {
      body: 'Correction: left knee.',
      amendsNoteId: first.body.id,
    });
    expect(amend.status).toBe(201);
    expect(amend.body.amendsNoteId).toBe(first.body.id);

    const row = await prisma.clinicalNote.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(row.bodyEnc).not.toContain('Knee');

    const list = await doctor.client.get(`/api/appointments/${id}/notes`);
    expect(list.status).toBe(200);
    expect(list.body.notes.map((n: { body: string }) => n.body)).toEqual([
      'Knee examined; mild swelling.',
      'Correction: left knee.',
    ]);
    expect(list.body.notes[0].authorName).toBe(doctor.doctor!.displayName);
    const viewed = await prisma.auditLog.count({
      where: { action: 'clinical_note.view', entityId: id },
    });
    expect(viewed).toBe(1);
  });

  it('is closed to reception, admins and patients (403) and other doctors (404)', async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    await doctor.client.post(`/api/appointments/${id}/notes`, { body: 'Private note' });

    for (const role of ['receptionist', 'admin'] as const) {
      const { client } = await staffClient(app, prisma, role);
      expect((await client.get(`/api/appointments/${id}/notes`)).status).toBe(403);
      expect((await client.post(`/api/appointments/${id}/notes`, { body: 'x' })).status).toBe(403);
    }
    expect((await patient.client.get(`/api/appointments/${id}/notes`)).status).toBe(403);
    const otherDoctor = await workingDoctor();
    expect((await otherDoctor.client.get(`/api/appointments/${id}/notes`)).status).toBe(404);
    expect((await (await anonClient(app)).get(`/api/appointments/${id}/notes`)).status).toBe(401);
  });

  it('validates the note and what it amends', async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    expect((await doctor.client.post(`/api/appointments/${id}/notes`, { body: ' ' })).status).toBe(
      400,
    );
    const elsewhere = await doctor.client.post(`/api/appointments/${id}/notes`, {
      body: 'Amends nothing here',
      amendsNoteId: randomUUID(),
    });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.error.details[0].path).toBe('amendsNoteId');
  });

  it('refuses notes on cancelled appointments', async () => {
    const { patient, book, doctor } = await scenario();
    const id = (await book(patient.client, '09:00')).body.id;
    await patient.client.patch(`/api/appointments/${id}/cancel`, {});
    const res = await doctor.client.post(`/api/appointments/${id}/notes`, { body: 'Late note' });
    expect(res.status).toBe(409);
  });
});
