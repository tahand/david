/**
 * Development seed: demo doctors, a receptionist, appointment types, clinic
 * settings and obviously fake patients (SPEC §14 phase 2). Idempotent.
 *
 * All people are fictional: emails use the reserved `.test` TLD and phone
 * numbers come from Ofcom's drama ranges. No admin is seeded — the first admin
 * is created with `npm run create-admin` (SPEC §3).
 *
 * Runs as app_user (DATABASE_URL), which also proves the grants suffice.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient, type Prisma, type SexAtBirth } from '@prisma/client';
import { DEFAULT_CLINIC_SETTINGS } from '@clinic/shared';
import { hashPassword } from '../src/lib/password.js';

const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'demo-password-not-for-production';

const prisma = new PrismaClient();

/** Wall-clock time for @db.Time columns (date part is ignored). */
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

const appointmentTypes = [
  { name: 'Standard consultation', durationMinutes: 15, colour: '#2563EB', patientBookable: true },
  { name: 'Long consultation', durationMinutes: 30, colour: '#7C3AED', patientBookable: true },
  { name: 'Telephone consultation', durationMinutes: 10, colour: '#059669', patientBookable: true },
  { name: 'Minor procedure', durationMinutes: 45, colour: '#DC2626', patientBookable: false },
];

const FULL_WEEK = [1, 2, 3, 4, 5];
const doctors = [
  {
    email: 'dr.example@example.test',
    displayName: 'Dr Alex Example',
    specialty: 'General Practice',
    registrationNumber: 'DEMO-0001',
    bio: 'Demo doctor for development. Not a real person.',
    weekdays: FULL_WEEK,
  },
  {
    email: 'dr.sample@example.test',
    displayName: 'Dr Sam Sample',
    specialty: 'General Practice',
    registrationNumber: 'DEMO-0002',
    bio: 'Demo doctor for development. Not a real person.',
    weekdays: FULL_WEEK,
  },
  {
    email: 'dr.placeholder@example.test',
    displayName: 'Dr Jordan Placeholder',
    specialty: 'Paediatrics',
    registrationNumber: 'DEMO-0003',
    bio: 'Demo doctor for development (part-time). Not a real person.',
    weekdays: [2, 4],
  },
];

interface FakePatient {
  first: string;
  last: string;
  dob: string;
  sex: SexAtBirth;
  postcode: string;
  /** false = created by reception without a login. */
  hasLogin: boolean;
  verified?: boolean;
}

const patients: FakePatient[] = [
  {
    first: 'Test',
    last: 'Patient',
    dob: '1985-03-14',
    sex: 'female',
    postcode: 'EX1 1AB',
    hasLogin: true,
    verified: true,
  },
  {
    first: 'Demo',
    last: 'Person',
    dob: '1972-11-02',
    sex: 'male',
    postcode: 'EX1 2CD',
    hasLogin: true,
    verified: true,
  },
  {
    first: 'Fictional',
    last: 'Fixture',
    dob: '1999-07-21',
    sex: 'female',
    postcode: 'EX2 3EF',
    hasLogin: true,
    verified: false,
  },
  {
    first: 'Sample',
    last: 'Record',
    dob: '2015-01-30',
    sex: 'male',
    postcode: 'EX2 4GH',
    hasLogin: false,
  },
  {
    first: 'Mock',
    last: 'Exampleson',
    dob: '1948-05-09',
    sex: 'not_stated',
    postcode: 'EX3 5JK',
    hasLogin: false,
  },
  {
    first: 'Dummy',
    last: 'Dataperson',
    dob: '1990-12-25',
    sex: 'intersex',
    postcode: 'EX3 6LM',
    hasLogin: true,
    verified: true,
  },
];

async function upsertUser(
  email: string,
  role: Prisma.UserCreateInput['role'],
  passwordHash: string,
  verified: boolean,
) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, role, passwordHash, emailVerifiedAt: verified ? new Date() : null },
  });
}

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  for (const [key, value] of Object.entries(DEFAULT_CLINIC_SETTINGS)) {
    await prisma.clinicSetting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  for (const t of appointmentTypes) {
    await prisma.appointmentType.upsert({ where: { name: t.name }, update: t, create: t });
  }

  for (const d of doctors) {
    const user = await upsertUser(d.email, 'doctor', passwordHash, true);
    const { email: _email, weekdays, ...profile } = d;
    const doctor = await prisma.doctor.upsert({
      where: { userId: user.id },
      update: profile,
      create: { ...profile, userId: user.id },
    });
    // Replace the weekly pattern: 09:00–12:30 and 13:30–17:00 on working days.
    await prisma.availabilityRule.deleteMany({ where: { doctorId: doctor.id } });
    await prisma.availabilityRule.createMany({
      data: weekdays.flatMap((weekday) => [
        {
          doctorId: doctor.id,
          weekday,
          startTime: time('09:00'),
          endTime: time('12:30'),
          validFrom: date('2026-01-01'),
        },
        {
          doctorId: doctor.id,
          weekday,
          startTime: time('13:30'),
          endTime: time('17:00'),
          validFrom: date('2026-01-01'),
        },
      ]),
    });
  }

  await upsertUser('reception@example.test', 'receptionist', passwordHash, true);

  for (const [i, p] of patients.entries()) {
    const n = String(i + 1).padStart(3, '0');
    const email = `${p.first}.${p.last}@example.test`.toLowerCase();
    const user = p.hasLogin
      ? await upsertUser(email, 'patient', passwordHash, p.verified ?? false)
      : null;
    const data = {
      firstName: p.first,
      lastName: p.last,
      dateOfBirth: date(p.dob),
      sexAtBirth: p.sex,
      contactEmail: p.hasLogin ? null : email,
      phoneMobile: `07700 900${n}`,
      addressLine1: `${i + 1} Fictional Road`,
      city: 'Exampletown',
      postcode: p.postcode,
      country: 'GB',
      reminderConsent: true,
      consentVersion: p.hasLogin ? DEFAULT_CLINIC_SETTINGS.consentVersion : null,
      consentAt: p.hasLogin ? new Date() : null,
      gpDetails: {
        name: 'Demo Surgery',
        practice: 'Exampletown Health Centre',
        phone: '01632 960001',
      },
    };
    // Patients without a login have no natural key; match on name + DOB.
    const existing = await prisma.patient.findFirst({
      where: user
        ? { userId: user.id }
        : { firstName: p.first, lastName: p.last, dateOfBirth: data.dateOfBirth },
    });
    if (existing) {
      await prisma.patient.update({ where: { id: existing.id }, data });
    } else {
      await prisma.patient.create({ data: { ...data, userId: user?.id ?? null } });
    }
  }

  console.log('Seed complete.');
  console.log(`  Doctors: ${doctors.map((d) => d.email).join(', ')}`);
  console.log('  Receptionist: reception@example.test');
  console.log(`  Patients with logins: ${patients.filter((p) => p.hasLogin).length}`);
  console.log(`  Password for all seeded logins: ${SEED_PASSWORD}`);
  console.log(
    '  Staff must enrol in MFA on first login. Create an admin with `npm run create-admin`.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
