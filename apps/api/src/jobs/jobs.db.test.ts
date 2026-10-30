import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { type PrismaClient } from '@prisma/client';
import { createUser } from '../test/auth-fixtures.js';
import { uniqueName } from '../test/clients.js';
import { createSchedulingFixture, testPrisma } from '../test/db.js';
import { HOUR, MINUTE, insertAppointment } from '../test/scheduling.js';
import { sendDueReminders } from './reminders.js';
import { eraseExpiredPatients } from './retention.js';
import { cleanupExpired } from './sessionCleanup.js';

let prisma: PrismaClient;
beforeAll(() => {
  prisma = testPrisma();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

describe('sendDueReminders', () => {
  /** An appointment `hoursAhead` from now, booked `bookedDaysAgo` ago. */
  async function upcoming(
    hoursAhead: number,
    opts: { consent?: boolean; bookedDaysAgo?: number } = {},
  ) {
    const f = await createSchedulingFixture(prisma);
    await prisma.patient.update({
      where: { id: f.patient.id },
      data: { reminderConsent: opts.consent ?? true },
    });
    return insertAppointment(prisma, {
      patientId: f.patient.id,
      doctorId: f.doctor.id,
      typeId: f.type.id,
      startsAt: new Date(Date.now() + hoursAhead * HOUR),
      bookedByUserId: f.doctorUser.id,
      createdAt: new Date(Date.now() - (opts.bookedDaysAgo ?? 3) * DAY),
    });
  }

  const recorder = (fail: string[] = []) => {
    const sent: string[] = [];
    return {
      sent,
      notifier: {
        send: vi.fn(async (_kind: string, id: string) => {
          if (fail.includes(id)) throw new Error('SMTP down');
          sent.push(id);
          return true;
        }),
      },
    };
  };

  it('reminds consenting patients once, inside the 24-hour window', async () => {
    const due = await upcoming(3);
    const later = await upcoming(30);
    const noConsent = await upcoming(3, { consent: false });
    const bookedLate = await upcoming(3, { bookedDaysAgo: 0 });

    const first = recorder();
    await sendDueReminders({ prisma, notifier: first.notifier });
    expect(first.sent).toContain(due.id);
    expect(first.sent).not.toContain(later.id);
    expect(first.sent).not.toContain(noConsent.id);
    expect(first.sent).not.toContain(bookedLate.id);
    expect(first.notifier.send).toHaveBeenCalledWith('reminder', due.id);
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: due.id } });
    expect(row.reminderSentAt).not.toBeNull();

    // Idempotent: a second run (or an overlapping one) doesn't send again.
    const second = recorder();
    await sendDueReminders({ prisma, notifier: second.notifier });
    expect(second.sent).not.toContain(due.id);
  });

  it('runs concurrently without sending twice', async () => {
    const due = await upcoming(4);
    const a = recorder();
    const b = recorder();
    await Promise.all([
      sendDueReminders({ prisma, notifier: a.notifier }),
      sendDueReminders({ prisma, notifier: b.notifier }),
    ]);
    expect([...a.sent, ...b.sent].filter((id) => id === due.id)).toHaveLength(1);
  });

  it('releases the claim when sending fails, so the next run retries', async () => {
    const due = await upcoming(5);
    const failing = recorder([due.id]);
    const result = await sendDueReminders({ prisma, notifier: failing.notifier });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: due.id } })).reminderSentAt,
    ).toBeNull();

    const retry = recorder();
    await sendDueReminders({ prisma, notifier: retry.notifier });
    expect(retry.sent).toContain(due.id);
  });
});

describe('cleanupExpired', () => {
  it('deletes dead sessions, spent tokens and expired rate limits only', async () => {
    const user = await createUser(prisma);
    const now = Date.now();
    const session = (data: Partial<Prisma.SessionUncheckedCreateInput>) =>
      prisma.session.create({
        data: {
          userId: user.id,
          idHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(now + HOUR),
          ...data,
        },
      });
    const live = await session({});
    const expired = await session({ expiresAt: new Date(now - MINUTE) });
    const idle = await session({ lastSeenAt: new Date(now - 2 * HOUR) });

    const token = (data: Partial<Prisma.EmailTokenUncheckedCreateInput>) =>
      prisma.emailToken.create({
        data: {
          userId: user.id,
          type: 'verify_email',
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(now + HOUR),
          ...data,
        },
      });
    const freshToken = await token({});
    const oldToken = await token({ expiresAt: new Date(now - 2 * DAY) });
    const usedToken = await token({ usedAt: new Date(now - 2 * DAY) });

    const limitKey = `test:${randomUUID()}`;
    await prisma.rateLimit.create({ data: { key: limitKey, expire: new Date(now - MINUTE) } });

    await cleanupExpired({ prisma });
    const sessionIds = (await prisma.session.findMany({ where: { userId: user.id } })).map(
      (s) => s.id,
    );
    expect(sessionIds).toEqual([live.id]);
    expect(sessionIds).not.toContain(expired.id);
    expect(sessionIds).not.toContain(idle.id);
    const tokenIds = (await prisma.emailToken.findMany({ where: { userId: user.id } })).map(
      (t) => t.id,
    );
    expect(tokenIds).toEqual([freshToken.id]);
    expect(tokenIds).not.toContain(oldToken.id);
    expect(tokenIds).not.toContain(usedToken.id);
    expect(await prisma.rateLimit.count({ where: { key: limitKey } })).toBe(0);
  });
});

describe('eraseExpiredPatients', () => {
  /** A patient with a login, an appointment, events and amended notes. */
  async function patientWithHistory(opts: {
    deletedYearsAgo: number | null;
    lastVisitYearsAgo: number;
  }) {
    const f = await createSchedulingFixture(prisma);
    const user = await createUser(prisma, { role: 'patient' });
    await prisma.session.create({
      data: { userId: user.id, idHash: randomBytes(32).toString('hex'), expiresAt: new Date() },
    });
    const patient = await prisma.patient.update({
      where: { id: f.patient.id },
      data: {
        userId: user.id,
        lastName: uniqueName(),
        deletedAt:
          opts.deletedYearsAgo === null ? null : new Date(Date.now() - opts.deletedYearsAgo * YEAR),
      },
    });
    const appointment = await insertAppointment(prisma, {
      patientId: patient.id,
      doctorId: f.doctor.id,
      typeId: f.type.id,
      startsAt: new Date(Date.now() - opts.lastVisitYearsAgo * YEAR),
      bookedByUserId: user.id,
      status: 'completed',
    });
    await prisma.appointmentEvent.create({
      data: { appointmentId: appointment.id, toStatus: 'booked', actorUserId: user.id },
    });
    const note = await prisma.clinicalNote.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        authorDoctorId: f.doctor.id,
        bodyEnc: 'ciphertext',
      },
    });
    const amendment = await prisma.clinicalNote.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        authorDoctorId: f.doctor.id,
        bodyEnc: 'ciphertext',
        amendsNoteId: note.id,
      },
    });
    await prisma.clinicalNote.create({
      data: {
        appointmentId: appointment.id,
        patientId: patient.id,
        authorDoctorId: f.doctor.id,
        bodyEnc: 'ciphertext',
        amendsNoteId: amendment.id,
      },
    });
    return { patient, user, appointment, doctor: f.doctor };
  }

  it('erases patients deleted longer ago than the retention period, and audits it', async () => {
    const due = await patientWithHistory({ deletedYearsAgo: 9, lastVisitYearsAgo: 10 });
    await eraseExpiredPatients({ prisma });

    expect(await prisma.patient.findUnique({ where: { id: due.patient.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: due.user.id } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: due.user.id } })).toBe(0);
    expect(await prisma.appointment.count({ where: { patientId: due.patient.id } })).toBe(0);
    expect(await prisma.clinicalNote.count({ where: { patientId: due.patient.id } })).toBe(0);
    expect(
      await prisma.appointmentEvent.count({ where: { appointmentId: due.appointment.id } }),
    ).toBe(0);
    // The doctor is untouched.
    expect(await prisma.doctor.findUnique({ where: { id: due.doctor.id } })).not.toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'patient.erase', entityId: due.patient.id },
    });
    expect(audit).toMatchObject({ actorUserId: null, metadata: { retentionYears: 8 } });
  });

  it('keeps patients still inside the retention period', async () => {
    const recentlyDeleted = await patientWithHistory({ deletedYearsAgo: 1, lastVisitYearsAgo: 10 });
    const recentVisit = await patientWithHistory({ deletedYearsAgo: 9, lastVisitYearsAgo: 2 });
    const active = await patientWithHistory({ deletedYearsAgo: null, lastVisitYearsAgo: 10 });
    await eraseExpiredPatients({ prisma });
    for (const kept of [recentlyDeleted, recentVisit, active]) {
      expect(await prisma.patient.findUnique({ where: { id: kept.patient.id } })).not.toBeNull();
      expect(await prisma.clinicalNote.count({ where: { patientId: kept.patient.id } })).toBe(3);
    }
  });

  it('enforces the rule in the database, whatever the app asks for', async () => {
    const recent = await patientWithHistory({ deletedYearsAgo: 0.5, lastVisitYearsAgo: 2 });
    const [row] = await prisma.$queryRaw<{ erased: boolean }[]>`
      SELECT erase_patient(${recent.patient.id}::uuid, 1) AS erased`;
    expect(row!.erased).toBe(false);
    await expect(
      prisma.$queryRaw`SELECT erase_patient(${recent.patient.id}::uuid, 0)`,
    ).rejects.toThrow(/at least one year/);
    // app_user still can't delete patients or notes directly.
    await expect(prisma.patient.delete({ where: { id: recent.patient.id } })).rejects.toThrow();
    await expect(
      prisma.clinicalNote.deleteMany({ where: { patientId: recent.patient.id } }),
    ).rejects.toThrow();
  });
});
