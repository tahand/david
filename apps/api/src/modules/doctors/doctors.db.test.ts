import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { addCalendarDays, weekdayOf, zonedToUtc, zonedToday } from '../../lib/clinicTime.js';
import { anonClient, patientClient, staffClient } from '../../test/clients.js';
import { testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';

const TZ = 'Europe/London';

let prisma: PrismaClient;
let app: Express;
beforeAll(() => {
  prisma = testPrisma();
  app = buildTestApp({ prisma }).app;
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** First Monday at least `minDays` ahead in clinic time. */
function mondayAhead(minDays: number): string {
  let d = addCalendarDays(zonedToday(TZ), minDays);
  while (weekdayOf(d) !== 1) d = addCalendarDays(d, 1);
  return d;
}
const SOON = mondayAhead(8); // inside the 60-day patient horizon
const FAR = mondayAhead(70); // beyond it

const MONDAY_9_TO_10 = { rules: [{ weekday: 1, startTime: '09:00', endTime: '10:00' }] };

async function appointmentType(overrides: { patientBookable?: boolean; isActive?: boolean } = {}) {
  return prisma.appointmentType.create({
    data: { name: `Type ${randomUUID()}`, durationMinutes: 15, colour: '#123456', ...overrides },
  });
}

async function bookedAppointment(doctorId: string, local: string, bookedByUserId: string) {
  const patient = await prisma.patient.create({
    data: { firstName: 'Fake', lastName: 'Booked', dateOfBirth: new Date('1980-01-01') },
  });
  const type = await appointmentType();
  const startsAt = zonedToUtc(local, TZ);
  return prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId,
      appointmentTypeId: type.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 15 * 60_000),
      bookedByUserId,
    },
  });
}

const slotTimes = (body: { slots: { time: string }[] }) => body.slots.map((s) => s.time);

describe('GET /api/doctors', () => {
  it('lists active doctors; patients only see bookable ones', async () => {
    const bookable = await staffClient(app, prisma, 'doctor', `Dr A ${randomUUID()}`);
    const hidden = await staffClient(app, prisma, 'doctor', `Dr B ${randomUUID()}`);
    await prisma.doctor.update({ where: { id: hidden.doctor!.id }, data: { isBookable: false } });
    const gone = await staffClient(app, prisma, 'doctor', `Dr C ${randomUUID()}`);
    await prisma.user.update({ where: { id: gone.user.id }, data: { isActive: false } });

    const { client: patient } = await patientClient(app, prisma);
    const res = await patient.get('/api/doctors');
    expect(res.status).toBe(200);
    const ids = res.body.doctors.map((d: { id: string }) => d.id);
    expect(ids).toContain(bookable.doctor!.id);
    expect(ids).not.toContain(hidden.doctor!.id);
    expect(ids).not.toContain(gone.doctor!.id);
    // Public fields only.
    expect(Object.keys(res.body.doctors[0]).sort()).toEqual(
      ['bio', 'displayName', 'id', 'isBookable', 'specialty'].sort(),
    );

    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const staffIds = (await reception.get('/api/doctors')).body.doctors.map(
      (d: { id: string }) => d.id,
    );
    expect(staffIds).toContain(hidden.doctor!.id);
    expect(staffIds).not.toContain(gone.doctor!.id);
  });

  it('401s without a session', async () => {
    expect((await (await anonClient(app)).get('/api/doctors')).status).toBe(401);
  });
});

describe('GET /api/doctors/me', () => {
  it("returns the signed-in doctor's profile", async () => {
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const res = await client.get('/api/doctors/me');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(doctor!.id);
  });

  it('404s for an admin without a doctor profile, 403s for reception, 401s signed out', async () => {
    expect(
      (await (await staffClient(app, prisma, 'admin')).client.get('/api/doctors/me')).status,
    ).toBe(404);
    expect(
      (await (await staffClient(app, prisma, 'receptionist')).client.get('/api/doctors/me')).status,
    ).toBe(403);
    expect((await (await anonClient(app)).get('/api/doctors/me')).status).toBe(401);
  });
});

describe('GET/PUT /api/doctors/:id/availability', () => {
  it('lets a doctor replace and read back their weekly hours', async () => {
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const path = `/api/doctors/${doctor!.id}/availability`;
    const put = await client.put(path, {
      rules: [
        { weekday: 1, startTime: '13:00', endTime: '17:00' },
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 3, startTime: '09:00', endTime: '12:30' },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.body.timezone).toBe(TZ);
    expect(
      put.body.rules.map((r: { weekday: number; startTime: string; endTime: string }) => [
        r.weekday,
        r.startTime,
        r.endTime,
      ]),
    ).toEqual([
      [1, '09:00', '12:00'],
      [1, '13:00', '17:00'],
      [3, '09:00', '12:30'],
    ]);
    expect(put.body.rules[0].validFrom).toBe(zonedToday(TZ));

    // A second PUT replaces, rather than adds to, the schedule.
    await client.put(path, MONDAY_9_TO_10);
    const get = await client.get(path);
    expect(get.status).toBe(200);
    expect(get.body.rules).toHaveLength(1);

    const audit = await prisma.auditLog.findMany({
      where: { action: 'availability.update', entityId: doctor!.id },
    });
    expect(audit).toHaveLength(2);
  });

  it('lets an admin manage any doctor', async () => {
    const { doctor } = await staffClient(app, prisma, 'doctor');
    const { client: admin } = await staffClient(app, prisma, 'admin');
    const res = await admin.put(`/api/doctors/${doctor!.id}/availability`, MONDAY_9_TO_10);
    expect(res.status).toBe(200);
  });

  it('rejects overlapping blocks and bad times', async () => {
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const res = await client.put(`/api/doctors/${doctor!.id}/availability`, {
      rules: [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '11:00', endTime: '13:00' },
        { weekday: 2, startTime: '10:00', endTime: '09:00' },
        { weekday: 7, startTime: '9am', endTime: '10:00' },
      ],
    });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['rules.2.endTime', 'rules.3.weekday', 'rules.3.startTime']),
    );
  });

  it('flags overlaps against valid blocks', async () => {
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const res = await client.put(`/api/doctors/${doctor!.id}/availability`, {
      rules: [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '11:00', endTime: '13:00' },
      ],
    });
    expect(res.body.error.details).toEqual([
      { path: 'rules.1.startTime', message: 'Overlaps other hours on the same day' },
    ]);
  });

  it("403s for another doctor's schedule and for reception; 404s for unknown doctors", async () => {
    const { doctor: other } = await staffClient(app, prisma, 'doctor');
    const { client } = await staffClient(app, prisma, 'doctor');
    expect((await client.get(`/api/doctors/${other!.id}/availability`)).status).toBe(403);
    expect(
      (await client.put(`/api/doctors/${other!.id}/availability`, MONDAY_9_TO_10)).status,
    ).toBe(403);
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    expect((await reception.get(`/api/doctors/${other!.id}/availability`)).status).toBe(403);
    const { client: admin } = await staffClient(app, prisma, 'admin');
    expect((await admin.get(`/api/doctors/${randomUUID()}/availability`)).status).toBe(404);
    expect((await admin.get('/api/doctors/not-a-uuid/availability')).status).toBe(404);
  });

  it('401s without a session and 403s for patients', async () => {
    const { doctor } = await staffClient(app, prisma, 'doctor');
    const path = `/api/doctors/${doctor!.id}/availability`;
    expect((await (await anonClient(app)).get(path)).status).toBe(401);
    expect((await (await patientClient(app, prisma)).client.get(path)).status).toBe(403);
  });
});

describe('POST/DELETE /api/doctors/:id/exceptions', () => {
  it('adds time off in clinic-local time and deletes it', async () => {
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const base = `/api/doctors/${doctor!.id}`;
    const res = await client.post(`${base}/exceptions`, {
      type: 'unavailable',
      startsAt: `${FAR}T09:00`,
      endsAt: `${FAR}T13:00`,
      reason: 'Training',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'unavailable',
      reason: 'Training',
      startsAtLocal: `${FAR}T09:00`,
      endsAtLocal: `${FAR}T13:00`,
      startsAt: zonedToUtc(`${FAR}T09:00`, TZ).toISOString(),
    });
    const listed = await client.get(`${base}/availability`);
    expect(listed.body.exceptions.map((e: { id: string }) => e.id)).toEqual([res.body.id]);

    const del = await client.delete(`${base}/exceptions/${res.body.id}`);
    expect(del.status).toBe(204);
    expect((await client.get(`${base}/availability`)).body.exceptions).toEqual([]);
    expect((await client.delete(`${base}/exceptions/${res.body.id}`)).status).toBe(404);

    const actions = (
      await prisma.auditLog.findMany({
        where: { entityId: res.body.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['availability_exception.create', 'availability_exception.delete']);
  });

  it('rejects invalid ranges and times already in the past', async () => {
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const path = `/api/doctors/${doctor!.id}/exceptions`;
    const backwards = await client.post(path, {
      type: 'extra',
      startsAt: `${FAR}T13:00`,
      endsAt: `${FAR}T09:00`,
    });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.details[0].path).toBe('endsAt');

    const past = await client.post(path, {
      type: 'unavailable',
      startsAt: '2020-01-01T09:00',
      endsAt: '2020-01-01T10:00',
    });
    expect(past.status).toBe(400);
    expect(past.body.error.details[0].message).toMatch(/already passed/);

    const malformed = await client.post(path, { type: 'holiday', startsAt: 'tomorrow' });
    expect(malformed.status).toBe(400);
  });

  it("can't delete another doctor's exception through your own ID", async () => {
    const other = await staffClient(app, prisma, 'doctor');
    const created = await other.client.post(`/api/doctors/${other.doctor!.id}/exceptions`, {
      type: 'unavailable',
      startsAt: `${FAR}T09:00`,
      endsAt: `${FAR}T10:00`,
    });
    const { client, doctor } = await staffClient(app, prisma, 'doctor');
    const res = await client.delete(`/api/doctors/${doctor!.id}/exceptions/${created.body.id}`);
    expect(res.status).toBe(404);
    expect(await prisma.availabilityException.count({ where: { id: created.body.id } })).toBe(1);
  });

  it('401s without a session and 403s for other doctors', async () => {
    const { doctor } = await staffClient(app, prisma, 'doctor');
    const body = { type: 'unavailable', startsAt: `${FAR}T09:00`, endsAt: `${FAR}T10:00` };
    const path = `/api/doctors/${doctor!.id}/exceptions`;
    expect((await (await anonClient(app)).post(path, body)).status).toBe(401);
    expect((await (await staffClient(app, prisma, 'doctor')).client.post(path, body)).status).toBe(
      403,
    );
  });
});

describe('GET /api/doctors/:id/slots', () => {
  async function scheduledDoctor() {
    const doc = await staffClient(app, prisma, 'doctor');
    await doc.client.put(`/api/doctors/${doc.doctor!.id}/availability`, MONDAY_9_TO_10);
    return doc;
  }

  it('offers working hours minus appointments and time off, in clinic time', async () => {
    const { client, doctor, user } = await scheduledDoctor();
    const type = await appointmentType();
    await bookedAppointment(doctor!.id, `${SOON}T09:15`, user.id);
    await client.post(`/api/doctors/${doctor!.id}/exceptions`, {
      type: 'unavailable',
      startsAt: `${SOON}T09:30`,
      endsAt: `${SOON}T09:45`,
    });

    const { client: patient } = await patientClient(app, prisma);
    const res = await patient.get(
      `/api/doctors/${doctor!.id}/slots?from=${SOON}&to=${SOON}&typeId=${type.id}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(slotTimes(res.body)).toEqual(['09:00', '09:45']);
    expect(res.body.slots[0]).toEqual({
      date: SOON,
      time: '09:00',
      startsAt: zonedToUtc(`${SOON}T09:00`, TZ).toISOString(),
      endsAt: zonedToUtc(`${SOON}T09:15`, TZ).toISOString(),
    });
  });

  it('frees the time again when an appointment is cancelled', async () => {
    const { doctor, user } = await scheduledDoctor();
    const type = await appointmentType();
    const appt = await bookedAppointment(doctor!.id, `${SOON}T09:00`, user.id);
    await prisma.appointment.update({
      where: { id: appt.id },
      data: { status: 'cancelled_by_patient' },
    });
    const { client } = await staffClient(app, prisma, 'receptionist');
    const res = await client.get(
      `/api/doctors/${doctor!.id}/slots?from=${SOON}&to=${SOON}&typeId=${type.id}`,
    );
    expect(slotTimes(res.body)).toEqual(['09:00', '09:15', '09:30', '09:45']);
  });

  it('keeps patients inside the booking horizon but not staff', async () => {
    const { doctor } = await scheduledDoctor();
    const type = await appointmentType();
    const path = `/api/doctors/${doctor!.id}/slots?from=${FAR}&to=${FAR}&typeId=${type.id}`;
    const { client: patient } = await patientClient(app, prisma);
    expect((await patient.get(path)).body.slots).toEqual([]);
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    expect(slotTimes((await reception.get(path)).body)).toHaveLength(4);
  });

  it('hides staff-only types and non-bookable doctors from patients', async () => {
    const { doctor } = await scheduledDoctor();
    const staffOnly = await appointmentType({ patientBookable: false });
    const range = `from=${SOON}&to=${SOON}`;
    const { client: patient } = await patientClient(app, prisma);
    const { client: reception } = await staffClient(app, prisma, 'receptionist');

    const typePath = `/api/doctors/${doctor!.id}/slots?${range}&typeId=${staffOnly.id}`;
    expect((await patient.get(typePath)).status).toBe(404);
    expect((await reception.get(typePath)).status).toBe(200);

    const type = await appointmentType();
    await prisma.doctor.update({ where: { id: doctor!.id }, data: { isBookable: false } });
    const doctorPath = `/api/doctors/${doctor!.id}/slots?${range}&typeId=${type.id}`;
    expect((await patient.get(doctorPath)).status).toBe(404);
    expect((await reception.get(doctorPath)).status).toBe(200);
  });

  it('404s for inactive types and unknown doctors', async () => {
    const { doctor } = await scheduledDoctor();
    const inactive = await appointmentType({ isActive: false });
    const { client } = await staffClient(app, prisma, 'receptionist');
    const range = `from=${SOON}&to=${SOON}`;
    expect(
      (await client.get(`/api/doctors/${doctor!.id}/slots?${range}&typeId=${inactive.id}`)).status,
    ).toBe(404);
    expect(
      (await client.get(`/api/doctors/${randomUUID()}/slots?${range}&typeId=${inactive.id}`))
        .status,
    ).toBe(404);
  });

  it('validates the query', async () => {
    const { doctor } = await scheduledDoctor();
    const { client } = await patientClient(app, prisma);
    const base = `/api/doctors/${doctor!.id}/slots`;
    const tooLong = await client.get(
      `${base}?from=${SOON}&to=${addCalendarDays(SOON, 40)}&typeId=${randomUUID()}`,
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.details[0]).toEqual({
      path: 'to',
      message: 'Ask for at most 31 days at a time',
    });
    expect((await client.get(`${base}?from=${SOON}&to=${SOON}`)).status).toBe(400);
    expect((await client.get(`${base}?from=soon&to=${SOON}&typeId=${randomUUID()}`)).status).toBe(
      400,
    );
  });

  it('401s without a session', async () => {
    const { doctor } = await scheduledDoctor();
    const res = await (
      await anonClient(app)
    ).get(`/api/doctors/${doctor!.id}/slots?from=${SOON}&to=${SOON}&typeId=${randomUUID()}`);
    expect(res.status).toBe(401);
  });
});
