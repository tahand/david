import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';
import { generate, generateSecret } from 'otplib';
import type { Page } from '@playwright/test';
import { FieldCipher } from '../../api/src/lib/crypto';
import { E2E_ENV } from '../env';
import { DEMO_DATABASE_URL } from './demo-env';

/**
 * A fictional clinic for documentation. Every person, email address and phone
 * number is invented: emails use reserved example domains and phone numbers
 * come from Ofcom's drama ranges (01632 960xxx, 07700 900xxx).
 */
export const prisma = new PrismaClient({ datasources: { db: { url: DEMO_DATABASE_URL } } });
export const PASSWORD = 'maple grove demo passphrase';
const TZ = 'Europe/London';

const cipher = FieldCipher.single(1, Buffer.from(E2E_ENV.DATA_ENCRYPTION_KEY!, 'base64'));

export const CLINIC = {
  clinicName: 'Maple Grove Clinic',
  clinicAddress: '14 Orchard Lane, Exampleton, EX4 7QP',
  clinicPhone: '01632 960123',
};

export const TYPES = [
  { name: 'Standard consultation', durationMinutes: 15, colour: '#2563EB', patientBookable: true },
  { name: 'Long consultation', durationMinutes: 30, colour: '#7C3AED', patientBookable: true },
  { name: 'Telephone consultation', durationMinutes: 10, colour: '#059669', patientBookable: true },
  { name: 'Annual health check', durationMinutes: 30, colour: '#D97706', patientBookable: true },
  { name: 'Minor procedure', durationMinutes: 45, colour: '#DC2626', patientBookable: false },
];

export const DOCTORS = [
  {
    key: 'shah',
    name: 'Dr Priya Shah',
    email: 'priya.shah@maplegrove.example',
    specialty: 'General Practice',
    mfa: true,
  },
  {
    key: 'reed',
    name: 'Dr Tom Reed',
    email: 'tom.reed@maplegrove.example',
    specialty: 'General Practice',
    mfa: true,
  },
  // Left without MFA so the guide can show first-time set-up.
  {
    key: 'lewis',
    name: 'Dr Hannah Lewis',
    email: 'hannah.lewis@maplegrove.example',
    specialty: 'Paediatrics',
    mfa: false,
  },
] as const;

export const STAFF = {
  reception: { email: 'reception@maplegrove.example', role: 'receptionist' as Role },
  manager: { email: 'practice.manager@maplegrove.example', role: 'admin' as Role },
};

export const AMELIA = {
  email: 'amelia.hart@example.com',
  firstName: 'Amelia',
  lastName: 'Hart',
  dateOfBirth: '1986-04-12',
};

/** Patients created by reception (no online account). */
export const WALK_INS = [
  {
    title: 'Mr',
    firstName: 'James',
    lastName: 'Okafor',
    dateOfBirth: '1974-09-03',
    postcode: 'EX4 2BD',
    phoneMobile: '07700 900211',
  },
  {
    title: 'Ms',
    firstName: 'Sofia',
    lastName: 'Rossi',
    dateOfBirth: '1991-01-27',
    postcode: 'EX4 6HN',
    phoneMobile: '07700 900245',
  },
  {
    title: 'Mrs',
    firstName: 'Margaret',
    lastName: 'Ellis',
    dateOfBirth: '1948-11-15',
    postcode: 'EX5 1QA',
    phoneMobile: '07700 900318',
  },
  {
    title: 'Mr',
    firstName: 'Daniel',
    lastName: 'Kowalski',
    dateOfBirth: '1983-06-30',
    postcode: 'EX4 9LT',
    phoneMobile: '07700 900372',
  },
  {
    title: 'Miss',
    firstName: 'Leah',
    lastName: 'Morgan',
    dateOfBirth: '2015-03-08',
    postcode: 'EX4 3RS',
    phoneMobile: '07700 900409',
  },
  {
    title: 'Mr',
    firstName: 'Arjun',
    lastName: 'Patel',
    dateOfBirth: '1962-12-02',
    postcode: 'EX6 7EW',
    phoneMobile: '07700 900455',
  },
  {
    title: 'Ms',
    firstName: 'Chloe',
    lastName: 'Bennett',
    dateOfBirth: '1999-08-19',
    postcode: 'EX4 5JP',
    phoneMobile: '07700 900512',
  },
];

const hash = (pw: string) =>
  argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 });

/** Today's date in clinic time. */
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short' }).format(new Date());

/** A wall-clock time on a clinic-time date, as a UTC instant. */
export function clinicInstant(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const shown = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(guess);
  const [h, m] = shown.split(':').map(Number);
  const [wh, wm] = time.split(':').map(Number);
  return new Date(guess.getTime() - ((h! - wh!) * 60 + (m! - wm!)) * 60_000);
}

export interface Seeded {
  doctors: Record<
    (typeof DOCTORS)[number]['key'],
    { userId: string; doctorId: string; secret: string | null }
  >;
  types: Record<string, string>;
  staff: Record<keyof typeof STAFF, { userId: string; secret: string }>;
  ameliaUserId: string;
  ameliaPatientId: string;
}

async function user(email: string, role: Role, withMfa: boolean) {
  const created = await prisma.user.create({
    data: { email, role, passwordHash: await hash(PASSWORD), emailVerifiedAt: new Date() },
  });
  let secret: string | null = null;
  if (withMfa) {
    secret = generateSecret();
    await prisma.user.update({
      where: { id: created.id },
      data: {
        mfaEnabled: true,
        mfaSecretEnc: cipher.encrypt(secret, `users.mfa_secret:${created.id}`),
      },
    });
  }
  return { userId: created.id, secret };
}

/** Clinic settings, appointment types, doctors with working hours, staff and one patient account. */
export async function seedBase(): Promise<Seeded> {
  for (const [key, value] of Object.entries(CLINIC)) {
    await prisma.clinicSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
  const types: Record<string, string> = {};
  for (const t of TYPES) types[t.name] = (await prisma.appointmentType.create({ data: t })).id;

  const validFrom = new Date(`${today()}T00:00:00Z`);
  validFrom.setUTCDate(validFrom.getUTCDate() - 30);
  const doctors = {} as Seeded['doctors'];
  for (const d of DOCTORS) {
    const u = await user(d.email, 'doctor', d.mfa);
    const doc = await prisma.doctor.create({
      data: {
        userId: u.userId,
        displayName: d.name,
        specialty: d.specialty,
        registrationNumber: `GMC ${7000000 + DOCTORS.indexOf(d) * 1234}`,
        bio: `${d.name.replace('Dr ', '')} has worked at Maple Grove since 2019.`,
      },
    });
    // Every day, so the schedule screenshots are full whatever day they are taken.
    await prisma.availabilityRule.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
        {
          doctorId: doc.id,
          weekday,
          startTime: new Date('1970-01-01T08:30:00Z'),
          endTime: new Date('1970-01-01T12:30:00Z'),
          validFrom,
        },
        {
          doctorId: doc.id,
          weekday,
          startTime: new Date('1970-01-01T13:30:00Z'),
          endTime: new Date('1970-01-01T17:30:00Z'),
          validFrom,
        },
      ]),
    });
    doctors[d.key] = { userId: u.userId, doctorId: doc.id, secret: u.secret };
  }

  const staff = {} as Seeded['staff'];
  for (const [key, s] of Object.entries(STAFF) as [
    keyof typeof STAFF,
    (typeof STAFF)[keyof typeof STAFF],
  ][]) {
    const u = await user(s.email, s.role, true);
    staff[key] = { userId: u.userId, secret: u.secret! };
  }

  const amelia = await user(AMELIA.email, 'patient', false);
  const ameliaPatient = await prisma.patient.create({
    data: {
      userId: amelia.userId,
      title: 'Ms',
      firstName: AMELIA.firstName,
      lastName: AMELIA.lastName,
      dateOfBirth: new Date(`${AMELIA.dateOfBirth}T00:00:00Z`),
      sexAtBirth: 'female',
      pronouns: 'she/her',
      phoneMobile: '07700 900123',
      addressLine1: '27 Willow Crescent',
      city: 'Exampleton',
      postcode: 'EX4 8AB',
      country: 'United Kingdom',
      preferredContact: 'email',
      reminderConsent: true,
      consentVersion: '2026-10-01',
      consentAt: new Date(),
    },
  });
  return { doctors, types, staff, ameliaUserId: amelia.userId, ameliaPatientId: ameliaPatient.id };
}

export async function addAppointment(opts: {
  patientId: string;
  doctorId: string;
  typeId: string;
  durationMinutes: number;
  date: string;
  time: string;
  bookedBy: string;
  status?: 'booked' | 'confirmed' | 'checked_in' | 'completed' | 'no_show';
}) {
  const startsAt = clinicInstant(opts.date, opts.time);
  return prisma.appointment.create({
    data: {
      patientId: opts.patientId,
      doctorId: opts.doctorId,
      appointmentTypeId: opts.typeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + opts.durationMinutes * 60_000),
      bookedByUserId: opts.bookedBy,
      status: opts.status ?? 'booked',
      events: { create: { toStatus: opts.status ?? 'booked', actorUserId: opts.bookedBy } },
    },
  });
}

/** Calls the API from inside a signed-in page (browser cookies, CSRF token). */
export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown) {
  const res = await page.evaluate(
    async ({ method, path, body }) => {
      const { csrfToken } = await (await fetch('/api/auth/csrf')).json();
      const r = await fetch(`/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    { method, path, body },
  );
  if (res.status >= 400)
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

/** A fresh TOTP code; clears the replay guard so the same user can sign in again. */
export async function codeFor(userId: string, secret: string) {
  await prisma.user.update({ where: { id: userId }, data: { mfaLastTimeStep: null } });
  return generate({ secret });
}
