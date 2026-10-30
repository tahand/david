import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { MemoryMailer } from '../../lib/email.js';
import { patientClient, staffClient, uniqueName } from '../../test/clients.js';
import { fakeEmail, testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';
import { appointmentType, at, mondayAhead, workingDoctor } from '../../test/scheduling.js';

let prisma: PrismaClient;
let app: Express;
let mailer: MemoryMailer;
beforeAll(() => {
  prisma = testPrisma();
  ({ app, mailer } = buildTestApp({ prisma }));
});
afterAll(async () => {
  await prisma.$disconnect();
});

const SOON = mondayAhead(8);
const ics = (message: { attachments?: { content: string }[] }) =>
  message.attachments?.[0]?.content ?? '';
const field = (calendar: string, name: string) =>
  new RegExp(`^${name}:(.*)$`, 'm').exec(calendar)?.[1]?.trim();

/** Waits for the background send to land. */
const emailsTo = (address: string, count: number) =>
  vi.waitFor(() => {
    expect(mailer.to(address)).toHaveLength(count);
    return mailer.to(address);
  });

async function setup() {
  const doctor = await workingDoctor(app, prisma);
  const type = await appointmentType(prisma);
  const patient = await patientClient(app, prisma);
  const body = (time: string) => ({
    doctorId: doctor.doctor!.id,
    appointmentTypeId: type.id,
    startsAt: at(SOON, time),
  });
  return { doctor, type, patient, body };
}

describe('appointment emails', () => {
  it('emails a booking, a move and a cancellation, each with a calendar file', async () => {
    const { patient, body, doctor, type } = await setup();
    const res = await patient.client.post('/api/appointments', {
      ...body('09:00'),
      reasonForVisit: 'Private symptoms',
    });
    expect(res.status).toBe(201);
    const id: string = res.body.id;

    const [booked] = await emailsTo(patient.user.email, 1);
    expect(booked!.subject).toMatch(/^Appointment booked/);
    expect(booked!.text).toContain('09:00');
    expect(booked!.text).toContain(doctor.doctor!.displayName);
    expect(booked!.text).toContain('/appointments');
    // Never medical details: not the reason, not even the appointment type.
    expect(booked!.text).not.toContain('Private symptoms');
    expect(booked!.text).not.toContain(type.name);
    expect(ics(booked!)).not.toContain(type.name);
    expect(field(ics(booked!), 'METHOD')).toBe('REQUEST');
    expect(field(ics(booked!), 'UID')).toBe(`${id}@localhost`);
    expect(field(ics(booked!), 'DTSTART')).toBe(
      at(SOON, '09:00').replace(/[-:]/g, '').replace('.000', ''),
    );

    await patient.client.patch(`/api/appointments/${id}/reschedule`, {
      startsAt: at(SOON, '10:00'),
    });
    const moved = (await emailsTo(patient.user.email, 2))[1]!;
    expect(moved.subject).toMatch(/^Appointment moved/);
    expect(field(ics(moved), 'UID')).toBe(`${id}@localhost`);
    expect(Number(field(ics(moved), 'SEQUENCE'))).toBeGreaterThan(
      Number(field(ics(booked!), 'SEQUENCE')),
    );

    await patient.client.patch(`/api/appointments/${id}/cancel`, {});
    const cancelled = (await emailsTo(patient.user.email, 3))[2]!;
    expect(cancelled.subject).toMatch(/^Appointment cancelled/);
    expect(field(ics(cancelled), 'METHOD')).toBe('CANCEL');
    expect(field(ics(cancelled), 'STATUS')).toBe('CANCELLED');
  });

  it('uses the contact email for patients without a login, and skips those with neither', async () => {
    const { body } = await setup();
    const { client: reception } = await staffClient(app, prisma, 'receptionist');
    const contactEmail = fakeEmail('contact');
    const withEmail = await prisma.patient.create({
      data: {
        firstName: 'No',
        lastName: uniqueName(),
        dateOfBirth: new Date('1970-01-01'),
        contactEmail,
      },
    });
    const without = await prisma.patient.create({
      data: { firstName: 'No', lastName: uniqueName(), dateOfBirth: new Date('1970-01-01') },
    });
    const before = mailer.sent.length;

    await reception.post('/api/appointments', { ...body('11:00'), patientId: withEmail.id });
    const [message] = await emailsTo(contactEmail, 1);
    expect(message!.text).toContain('call us on');
    expect(message!.text).not.toContain('/appointments');

    const res = await reception.post('/api/appointments', {
      ...body('12:00'),
      patientId: without.id,
    });
    expect(res.status).toBe(201);
    // Give a background send the chance to (wrongly) happen.
    await new Promise((r) => setTimeout(r, 50));
    expect(mailer.sent.slice(before).map((m) => m.to)).toEqual([contactEmail]);
  });

  it('still books when the email fails', async () => {
    const failing = buildTestApp({ prisma });
    vi.spyOn(failing.mailer, 'send').mockRejectedValue(new Error('SMTP down'));
    const doctor = await workingDoctor(failing.app, prisma);
    const type = await appointmentType(prisma);
    const patient = await patientClient(failing.app, prisma);
    const res = await patient.client.post('/api/appointments', {
      doctorId: doctor.doctor!.id,
      appointmentTypeId: type.id,
      startsAt: at(SOON, '13:00'),
    });
    expect(res.status).toBe(201);
  });
});
