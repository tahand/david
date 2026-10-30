import type { PrismaClient } from '@prisma/client';
import type { AppointmentNotifier } from '../modules/appointments/notifications.js';

const HOUR = 3_600_000;
/** SPEC §7.4: remind 24 hours before. */
export const REMINDER_LEAD_HOURS = 24;
const BATCH = 200;

export interface ReminderResult {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Emails a reminder for appointments starting in the next 24 hours, for
 * patients who consented to reminders. Idempotent: each appointment is claimed
 * by setting `reminder_sent_at` before sending (released again if sending
 * fails), so overlapping or repeated runs never send twice. Appointments
 * booked less than 24 hours ahead are skipped; the booking email covers them.
 */
export async function sendDueReminders(deps: {
  prisma: PrismaClient;
  notifier: Pick<AppointmentNotifier, 'send'>;
  now?: Date;
}): Promise<ReminderResult> {
  const { prisma, notifier } = deps;
  const now = deps.now ?? new Date();
  const horizon = new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR);
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.status IN ('booked', 'confirmed')
      AND a.reminder_sent_at IS NULL
      AND a.starts_at > ${now} AND a.starts_at <= ${horizon}
      AND a.created_at <= a.starts_at - make_interval(hours => ${REMINDER_LEAD_HOURS}::integer)
      AND p.reminder_consent AND p.deleted_at IS NULL
    ORDER BY a.starts_at
    LIMIT ${BATCH}`;

  const result: ReminderResult = { sent: 0, skipped: 0, failed: 0 };
  for (const { id } of due) {
    const { count } = await prisma.appointment.updateMany({
      where: { id, reminderSentAt: null, status: { in: ['booked', 'confirmed'] } },
      data: { reminderSentAt: now },
    });
    if (count === 0) continue; // claimed by another run, or changed meanwhile
    try {
      // No email address: nothing to send, and nothing to retry.
      if (await notifier.send('reminder', id)) result.sent += 1;
      else result.skipped += 1;
    } catch {
      await prisma.appointment.updateMany({
        where: { id, reminderSentAt: now },
        data: { reminderSentAt: null },
      });
      result.failed += 1;
    }
  }
  return result;
}
