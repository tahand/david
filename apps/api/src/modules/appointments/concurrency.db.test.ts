import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { patientClient } from '../../test/clients.js';
import { testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';
import { appointmentType, at, mondayAhead, workingDoctor } from '../../test/scheduling.js';

let prisma: PrismaClient;
let app: Express;
beforeAll(() => {
  prisma = testPrisma();
  app = buildTestApp({
    prisma,
    rateLimits: { globalPerMinute: 1e6, credentialPerMinute: 1e6 },
  }).app;
});
afterAll(() => prisma.$disconnect());

/**
 * SPEC §15: two simultaneous bookings for a slot → exactly one succeeds, the
 * rest get 409. Under contention, inserts into the no_overlap exclusion
 * constraint used to deadlock (500s, and sometimes no winner at all) until
 * bookings queued per doctor (AppointmentService.lockDoctorSchedule).
 */
it(
  'simultaneous bookings for one slot: one winner, the rest 409, never a 500',
  { timeout: 300_000 },
  async () => {
    const tally: Record<number, number> = {};
    const patients = await Promise.all(Array.from({ length: 6 }, () => patientClient(app, prisma)));
    let roundsWithoutOneWinner = 0;
    for (let round = 0; round < 15; round++) {
      const doc = await workingDoctor(app, prisma);
      const type = await appointmentType(prisma);
      const day = mondayAhead(9 + round);
      const res = await Promise.all(
        patients.map((p) =>
          p.client.post('/api/appointments', {
            doctorId: doc.doctor!.id,
            appointmentTypeId: type.id,
            startsAt: at(day, '11:00'),
          }),
        ),
      );
      for (const r of res) tally[r.status] = (tally[r.status] ?? 0) + 1;
      if (res.filter((r) => r.status === 201).length !== 1) roundsWithoutOneWinner++;
      // Free the patients' upcoming-appointment allowance for the next round.
      await prisma.appointment.updateMany({
        where: { doctorId: doc.doctor!.id },
        data: { status: 'cancelled_by_clinic' },
      });
    }
    expect(tally[500], JSON.stringify(tally)).toBeUndefined();
    expect(roundsWithoutOneWinner).toBe(0);
  },
);
