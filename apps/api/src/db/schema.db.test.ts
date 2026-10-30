import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createSchedulingFixture, fakeEmail, testPrisma } from '../test/db.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = testPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const at = (iso: string) => new Date(iso);

describe('no_overlap exclusion constraint (SPEC §7.2)', () => {
  async function book(
    f: Awaited<ReturnType<typeof createSchedulingFixture>>,
    startsAt: string,
    endsAt: string,
    status: 'booked' | 'cancelled_by_patient' | 'checked_in' = 'booked',
  ) {
    return prisma.appointment.create({
      data: {
        patientId: f.patient.id,
        doctorId: f.doctor.id,
        appointmentTypeId: f.type.id,
        bookedByUserId: f.doctorUser.id,
        startsAt: at(startsAt),
        endsAt: at(endsAt),
        status,
      },
    });
  }

  it('rejects an overlapping appointment for the same doctor', async () => {
    const f = await createSchedulingFixture(prisma);
    await book(f, '2027-01-04T09:00:00Z', '2027-01-04T09:15:00Z');
    await expect(book(f, '2027-01-04T09:10:00Z', '2027-01-04T09:25:00Z')).rejects.toThrow(
      /no_overlap/,
    );
  });

  it('allows back-to-back appointments', async () => {
    const f = await createSchedulingFixture(prisma);
    await book(f, '2027-01-04T09:00:00Z', '2027-01-04T09:15:00Z');
    await expect(book(f, '2027-01-04T09:15:00Z', '2027-01-04T09:30:00Z')).resolves.toBeDefined();
  });

  it('ignores cancelled appointments', async () => {
    const f = await createSchedulingFixture(prisma);
    await book(f, '2027-01-04T10:00:00Z', '2027-01-04T10:15:00Z', 'cancelled_by_patient');
    await expect(book(f, '2027-01-04T10:00:00Z', '2027-01-04T10:15:00Z')).resolves.toBeDefined();
  });

  it('treats checked_in as occupying the slot', async () => {
    const f = await createSchedulingFixture(prisma);
    await book(f, '2027-01-04T11:00:00Z', '2027-01-04T11:15:00Z', 'checked_in');
    await expect(book(f, '2027-01-04T11:05:00Z', '2027-01-04T11:20:00Z')).rejects.toThrow(
      /no_overlap/,
    );
  });

  it('allows the same time with a different doctor', async () => {
    const a = await createSchedulingFixture(prisma);
    const b = await createSchedulingFixture(prisma);
    await book(a, '2027-01-04T12:00:00Z', '2027-01-04T12:15:00Z');
    await expect(book(b, '2027-01-04T12:00:00Z', '2027-01-04T12:15:00Z')).resolves.toBeDefined();
  });

  it('lets exactly one of two simultaneous bookings succeed (SPEC §15)', async () => {
    const f = await createSchedulingFixture(prisma);
    const results = await Promise.allSettled([
      book(f, '2027-01-05T09:00:00Z', '2027-01-05T09:15:00Z'),
      book(f, '2027-01-05T09:00:00Z', '2027-01-05T09:15:00Z'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('rejects appointments that end before they start', async () => {
    const f = await createSchedulingFixture(prisma);
    await expect(book(f, '2027-01-04T13:15:00Z', '2027-01-04T13:00:00Z')).rejects.toThrow(
      /appointments_time_order/,
    );
  });
});

describe('table constraints', () => {
  it('treats email as case-insensitive and unique (citext)', async () => {
    const email = fakeEmail('Case');
    await prisma.user.create({ data: { email, role: 'patient', passwordHash: 'x' } });
    await expect(
      prisma.user.create({
        data: { email: email.toUpperCase(), role: 'patient', passwordHash: 'x' },
      }),
    ).rejects.toThrow(/Unique constraint/);
    const found = await prisma.user.findUnique({ where: { email: email.toUpperCase() } });
    expect(found?.email).toBe(email);
  });

  it('validates availability rule weekday and time order', async () => {
    const { doctor } = await createSchedulingFixture(prisma);
    const rule = (weekday: number, start: string, end: string) =>
      prisma.availabilityRule.create({
        data: {
          doctorId: doctor.id,
          weekday,
          startTime: at(`1970-01-01T${start}:00Z`),
          endTime: at(`1970-01-01T${end}:00Z`),
        },
      });
    await expect(rule(1, '09:00', '12:00')).resolves.toBeDefined();
    await expect(rule(7, '09:00', '12:00')).rejects.toThrow(/availability_rules_weekday/);
    await expect(rule(1, '12:00', '09:00')).rejects.toThrow(/availability_rules_time_order/);
  });

  it('validates appointment type colour and duration', async () => {
    await expect(
      prisma.appointmentType.create({
        data: { name: fakeEmail('t'), durationMinutes: 15, colour: 'red' },
      }),
    ).rejects.toThrow(/appointment_types_colour/);
    await expect(
      prisma.appointmentType.create({
        data: { name: fakeEmail('t'), durationMinutes: 0, colour: '#000000' },
      }),
    ).rejects.toThrow(/appointment_types_duration/);
  });
});

describe('app_user privileges (SPEC §8)', () => {
  it('can insert and read audit logs but never update or delete them', async () => {
    const log = await prisma.auditLog.create({ data: { action: 'test.insert' } });
    expect(await prisma.auditLog.findUnique({ where: { id: log.id } })).not.toBeNull();
    await expect(
      prisma.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(prisma.$executeRaw`TRUNCATE audit_logs`).rejects.toThrow(/permission denied/);
  });

  it('cannot update or delete clinical notes', async () => {
    const f = await createSchedulingFixture(prisma);
    const appt = await prisma.appointment.create({
      data: {
        patientId: f.patient.id,
        doctorId: f.doctor.id,
        appointmentTypeId: f.type.id,
        bookedByUserId: f.doctorUser.id,
        startsAt: at('2027-02-01T09:00:00Z'),
        endsAt: at('2027-02-01T09:15:00Z'),
      },
    });
    const note = await prisma.clinicalNote.create({
      data: {
        appointmentId: appt.id,
        patientId: f.patient.id,
        authorDoctorId: f.doctor.id,
        bodyEnc: 'ciphertext',
      },
    });
    await expect(
      prisma.clinicalNote.update({ where: { id: note.id }, data: { bodyEnc: 'x' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(prisma.clinicalNote.delete({ where: { id: note.id } })).rejects.toThrow(
      /permission denied/,
    );
    // Amendments are new rows.
    await expect(
      prisma.clinicalNote.create({
        data: {
          appointmentId: appt.id,
          patientId: f.patient.id,
          authorDoctorId: f.doctor.id,
          bodyEnc: 'ciphertext-2',
          amendsNoteId: note.id,
        },
      }),
    ).resolves.toBeDefined();
  });

  it('cannot hard-delete patients or users (soft delete only)', async () => {
    const { patient, doctorUser } = await createSchedulingFixture(prisma);
    await expect(prisma.patient.delete({ where: { id: patient.id } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(prisma.user.delete({ where: { id: doctorUser.id } })).rejects.toThrow(
      /permission denied/,
    );
  });

  it('can delete ephemeral rows such as sessions', async () => {
    const user = await prisma.user.create({
      data: { email: fakeEmail(), role: 'patient', passwordHash: 'x' },
    });
    const s = await prisma.session.create({
      data: { idHash: fakeEmail('h'), userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });
    await expect(prisma.session.delete({ where: { id: s.id } })).resolves.toBeDefined();
  });

  it('has no DDL rights and cannot read migration history', async () => {
    await expect(prisma.$executeRaw`CREATE TABLE sneaky (id int)`).rejects.toThrow(
      /permission denied/,
    );
    await expect(prisma.$queryRaw`SELECT * FROM _prisma_migrations`).rejects.toThrow(
      /permission denied/,
    );
  });
});
