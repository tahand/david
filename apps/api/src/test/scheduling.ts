import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  addCalendarDays,
  dateStringToColumn,
  timeStringToColumn,
  weekdayOf,
  zonedToUtc,
  zonedToday,
} from '../lib/clinicTime.js';
import { staffClient, uniqueName } from './clients.js';

export const TZ = 'Europe/London';
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** First Monday at least `minDays` ahead in clinic time. */
export function mondayAhead(minDays: number): string {
  let d = addCalendarDays(zonedToday(TZ), minDays);
  while (weekdayOf(d) !== 1) d = addCalendarDays(d, 1);
  return d;
}

/** UTC ISO instant for a clinic-local date and time. */
export const at = (date: string, time: string) => zonedToUtc(`${date}T${time}`, TZ).toISOString();

export async function appointmentType(
  prisma: PrismaClient,
  overrides: { patientBookable?: boolean } = {},
) {
  return prisma.appointmentType.create({
    data: { name: `Type ${randomUUID()}`, durationMinutes: 15, colour: '#123456', ...overrides },
  });
}

/** A signed-in doctor who works 08:00–18:00 every day. */
export async function workingDoctor(app: Express, prisma: PrismaClient) {
  const doc = await staffClient(app, prisma, 'doctor', `Dr ${uniqueName()}`);
  await prisma.availabilityRule.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      doctorId: doc.doctor!.id,
      weekday,
      startTime: timeStringToColumn('08:00'),
      endTime: timeStringToColumn('18:00'),
      validFrom: dateStringToColumn(zonedToday(TZ)),
    })),
  });
  return doc;
}

/** Inserts an appointment directly, e.g. one in the past or with a chosen creation time. */
export async function insertAppointment(
  prisma: PrismaClient,
  opts: {
    patientId: string;
    doctorId: string;
    typeId: string;
    startsAt: Date;
    bookedByUserId: string;
    status?: 'booked' | 'confirmed' | 'checked_in' | 'completed';
    createdAt?: Date;
  },
) {
  return prisma.appointment.create({
    data: {
      patientId: opts.patientId,
      doctorId: opts.doctorId,
      appointmentTypeId: opts.typeId,
      startsAt: opts.startsAt,
      endsAt: new Date(opts.startsAt.getTime() + 15 * MINUTE),
      bookedByUserId: opts.bookedByUserId,
      status: opts.status ?? 'booked',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
}
