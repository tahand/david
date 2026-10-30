import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { formatInTimeZone } from 'date-fns-tz';
import type { Mailer } from '../../lib/email.js';
import { appointmentMessage, type AppointmentNotice } from '../../lib/emailTemplates.js';
import { buildIcs } from '../../lib/ics.js';
import { getClinicSettings } from '../../lib/settings.js';

export type { AppointmentNotice };

export interface AppointmentNotifierDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  logger: Logger;
  appUrl: string;
  timezone: string;
  now?: () => Date;
}

/**
 * Appointment emails with .ics attachments (SPEC §7.4). Sends to the
 * patient's verified login email, or their contact email if they have no
 * usable login. Patients with neither get no email.
 */
export class AppointmentNotifier {
  private readonly now: () => Date;

  constructor(private readonly deps: AppointmentNotifierDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Returns false when the patient has no email address to send to. */
  async send(kind: AppointmentNotice, appointmentId: string): Promise<boolean> {
    const { prisma, timezone, appUrl } = this.deps;
    const [a, settings, changes] = await Promise.all([
      prisma.appointment.findUniqueOrThrow({
        where: { id: appointmentId },
        include: {
          doctor: { select: { displayName: true } },
          patient: {
            select: {
              contactEmail: true,
              deletedAt: true,
              user: {
                select: { email: true, emailVerifiedAt: true, isActive: true, deletedAt: true },
              },
            },
          },
        },
      }),
      getClinicSettings(prisma),
      prisma.appointmentEvent.count({ where: { appointmentId } }),
    ]);
    if (a.patient.deletedAt) return false;
    const user = a.patient.user;
    const login = user && user.isActive && !user.deletedAt && user.emailVerifiedAt ? user : null;
    const to = login?.email ?? a.patient.contactEmail;
    if (!to) return false;

    const manageUrl = login ? new URL('/appointments', appUrl).toString() : null;
    const message = appointmentMessage(kind, {
      to,
      clinicName: settings.clinicName,
      clinicAddress: settings.clinicAddress,
      clinicPhone: settings.clinicPhone,
      doctorName: a.doctor.displayName,
      when: formatInTimeZone(a.startsAt, timezone, "EEEE d MMMM yyyy 'at' HH:mm"),
      timezone,
      manageUrl,
    });

    if (kind !== 'reminder') {
      const method = kind === 'cancelled' ? 'CANCEL' : 'REQUEST';
      const ics = buildIcs({
        uid: `${a.id}@${new URL(appUrl).hostname}`,
        // Every change adds an appointment_events row, so later emails supersede earlier ones.
        sequence: changes,
        method,
        start: a.startsAt,
        end: a.endsAt,
        summary: `Appointment with ${a.doctor.displayName}`,
        location: `${settings.clinicName}, ${settings.clinicAddress}`,
        description: `${settings.clinicName}. To change it, call ${settings.clinicPhone}.`,
        url: manageUrl ?? undefined,
        now: this.now(),
      });
      message.attachments = [
        {
          filename: 'appointment.ics',
          content: ics,
          contentType: `text/calendar; charset=utf-8; method=${method}`,
        },
      ];
    }
    await this.deps.mailer.send(message);
    return true;
  }

  /** Fire-and-forget for request handlers: a failed email never fails the booking. */
  notifyInBackground(kind: AppointmentNotice, appointmentId: string): void {
    this.send(kind, appointmentId).catch((err: unknown) => {
      this.deps.logger.error({ err, kind, appointmentId }, 'failed to send appointment email');
    });
  }
}
