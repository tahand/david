import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { THEMES } from '../../../packages/shared/src/theme';
import { MAILPIT_URL, WEB_URL } from '../env';
import {
  AMELIA,
  DOCTORS,
  PASSWORD,
  STAFF,
  TYPES,
  WALK_INS,
  addAppointment,
  api,
  codeFor,
  prisma,
  seedBase,
  today,
  type Seeded,
} from './demo-data';
import { GUIDE_IMAGES, RAW_DIR } from './demo-env';

test.describe.configure({ mode: 'serial' });

const VIEWPORTS: Record<string, BrowserContextOptions> = {
  // User guide: crisp at A4 width without huge files.
  guide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 },
  // Marketing: retina desktop and phone.
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
};

async function open(browser: Browser, kind: keyof typeof VIEWPORTS): Promise<Page> {
  const context = await browser.newContext({
    ...VIEWPORTS[kind],
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    // Separate client IP per browser, as with real separate users (rate limits).
    extraHTTPHeaders: { 'X-Forwarded-For': `10.9.${randomInt(256)}.${randomInt(1, 255)}` },
  });
  return context.newPage();
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // Fonts and any spinners.
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('status', { name: /Loading/ })).toHaveCount(0);
}

/** Saves a user-guide screenshot. */
async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await settle(page);
  await page.screenshot({
    path: path.join(GUIDE_IMAGES, `${name}.png`),
    fullPage: opts.fullPage ?? false,
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Saves a raw capture for the marketing composites. */
async function raw(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await settle(page);
  await page.screenshot({
    path: path.join(RAW_DIR, `${name}.png`),
    fullPage: opts.fullPage ?? false,
    animations: 'disabled',
    caret: 'hide',
  });
}

async function signIn(
  page: Page,
  email: string,
  code?: () => Promise<string>,
  beforeCode?: () => Promise<void>,
) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (code) {
    await expect(page.getByLabel('Authentication code')).toBeVisible();
    await beforeCode?.();
    await page.getByLabel('Authentication code').fill(await code());
  }
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(/Sign in|Two-step/);
}

let seed: Seeded;
const patientIds: Record<string, string> = {};
const day = today();

test('build the demo clinic', async ({ browser }) => {
  seed = await seedBase();

  // Reception adds the walk-in patients through the API, so encrypted fields
  // (emergency contacts, medical summaries) are written exactly as in real use.
  const page = await open(browser, 'guide');
  await signIn(page, STAFF.reception.email, () =>
    codeFor(seed.staff.reception.userId, seed.staff.reception.secret),
  );
  for (const p of WALK_INS) {
    const created = await api<{ id: string }>(page, 'POST', '/patients', {
      ...p,
      addressLine1: `${10 + WALK_INS.indexOf(p) * 7} Station Road`,
      city: 'Exampleton',
      country: 'United Kingdom',
      contactEmail: `${p.firstName}.${p.lastName}@example.com`.toLowerCase(),
      reminderConsent: true,
      emergencyContact: {
        name: p.lastName === 'Morgan' ? 'Rachel Morgan' : `Sam ${p.lastName}`,
        relationship: p.lastName === 'Morgan' ? 'Mother' : 'Partner',
        phone: '07700 900999',
      },
    });
    patientIds[p.firstName] = created.id;
  }
  patientIds.Amelia = seed.ameliaPatientId;

  const summaries: Record<string, unknown> = {
    Amelia: {
      allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
      medications: [{ name: 'Salbutamol inhaler', dose: '100 micrograms', frequency: 'As needed' }],
      conditions: [{ condition: 'Asthma', diagnosedDate: '2004-06-01', notes: 'Well controlled' }],
      gpDetails: { name: 'Dr Priya Shah', practice: 'Maple Grove Clinic', phone: '01632 960123' },
      accessibilityNeeds: null,
    },
    James: {
      allergies: [],
      medications: [{ name: 'Ramipril', dose: '5 mg', frequency: 'Once daily' }],
      conditions: [{ condition: 'Hypertension', diagnosedDate: '2019-02-14', notes: null }],
      gpDetails: null,
      accessibilityNeeds: null,
    },
    Sofia: {
      allergies: [{ substance: 'Peanuts', reaction: 'Anaphylaxis', severity: 'severe' }],
      medications: [
        { name: 'Adrenaline auto-injector', dose: '300 micrograms', frequency: 'Emergency use' },
      ],
      conditions: [],
      gpDetails: null,
      accessibilityNeeds: null,
    },
    Margaret: {
      allergies: [],
      medications: [
        { name: 'Metformin', dose: '500 mg', frequency: 'Twice daily' },
        { name: 'Atorvastatin', dose: '20 mg', frequency: 'At night' },
      ],
      conditions: [
        { condition: 'Type 2 diabetes', diagnosedDate: '2012-09-10', notes: 'Annual review due' },
      ],
      gpDetails: null,
      accessibilityNeeds: 'Uses a wheelchair; ground-floor room please.',
    },
  };
  for (const [who, summary] of Object.entries(summaries)) {
    await api(page, 'PUT', `/patients/${patientIds[who]}/medical-summary`, summary);
  }

  // A realistic day: some seen, some waiting, some still to come.
  const t = (name: string) => ({
    typeId: seed.types[name]!,
    durationMinutes: TYPES.find((x) => x.name === name)!.durationMinutes,
  });
  const shah = seed.doctors.shah.doctorId;
  const reed = seed.doctors.reed.doctorId;
  const lewis = seed.doctors.lewis.doctorId;
  const by = seed.staff.reception.userId;
  type Slot = {
    p: string;
    d: string;
    time: string;
    typeId: string;
    durationMinutes: number;
    status?: 'completed' | 'checked_in' | 'confirmed';
  };
  const today: Slot[] = [
    {
      p: 'Margaret',
      d: shah,
      time: '08:30',
      ...t('Long consultation'),
      status: 'completed' as const,
    },
    {
      p: 'James',
      d: shah,
      time: '09:00',
      ...t('Standard consultation'),
      status: 'completed' as const,
    },
    {
      p: 'Sofia',
      d: shah,
      time: '09:30',
      ...t('Standard consultation'),
      status: 'checked_in' as const,
    },
    {
      p: 'Daniel',
      d: shah,
      time: '10:00',
      ...t('Standard consultation'),
      status: 'confirmed' as const,
    },
    { p: 'Arjun', d: shah, time: '11:00', ...t('Annual health check') },
    { p: 'Chloe', d: shah, time: '14:00', ...t('Telephone consultation') },
    {
      p: 'Arjun',
      d: reed,
      time: '08:45',
      ...t('Standard consultation'),
      status: 'completed' as const,
    },
    {
      p: 'Chloe',
      d: reed,
      time: '09:15',
      ...t('Standard consultation'),
      status: 'checked_in' as const,
    },
    { p: 'Daniel', d: reed, time: '11:30', ...t('Minor procedure') },
    { p: 'Margaret', d: reed, time: '15:00', ...t('Standard consultation') },
    { p: 'Leah', d: lewis, time: '10:00', ...t('Long consultation'), status: 'confirmed' as const },
    { p: 'James', d: lewis, time: '13:30', ...t('Telephone consultation') },
  ];
  for (const a of today) {
    await addAppointment({
      patientId: patientIds[a.p]!,
      doctorId: a.d,
      typeId: a.typeId,
      durationMinutes: a.durationMinutes,
      date: day,
      time: a.time,
      bookedBy: by,
      status: a.status,
    });
  }
  // Amelia's history.
  const lastMonth = new Date(`${day}T00:00:00Z`);
  lastMonth.setUTCDate(lastMonth.getUTCDate() - 33);
  await addAppointment({
    patientId: seed.ameliaPatientId,
    doctorId: shah,
    ...t('Standard consultation'),
    date: lastMonth.toISOString().slice(0, 10),
    time: '10:15',
    bookedBy: seed.ameliaUserId,
    status: 'completed',
  });
  await page.context().close();

  // Dr Shah writes up the morning's consultations.
  const doctor = await open(browser, 'guide');
  await signIn(doctor, DOCTORS[0].email, () =>
    codeFor(seed.doctors.shah.userId, seed.doctors.shah.secret!),
  );
  const done = await prisma.appointment.findMany({
    where: { doctorId: shah, status: 'completed' },
    include: { patient: true },
  });
  const notes: Record<string, string> = {
    Margaret:
      'Diabetes review. HbA1c 52 mmol/mol, improved from 58. Feet checked: no ulceration. Continue metformin. Retinal screening booked.',
    James:
      'BP 138/86, down from 152/94 on ramipril. No side effects reported. Continue current dose, recheck in 3 months.',
    Amelia:
      'Asthma review. Peak flow 420 L/min (predicted 450). Inhaler technique good. No change to treatment.',
  };
  for (const a of done) {
    const body = notes[a.patient.firstName];
    if (body) await api(doctor, 'POST', `/appointments/${a.id}/notes`, { body });
  }
  await doctor.context().close();
});

test('public screens', async ({ browser }) => {
  const page = await open(browser, 'guide');
  await page.goto('/login');
  await page.getByLabel('Email').fill(AMELIA.email);
  await shot(page, '01-sign-in');

  await page.goto('/register');
  await page.getByLabel('First name').fill('Noah');
  await page.getByLabel('Last name').fill('Clarke');
  await page.getByLabel('Date of birth').fill('1995-07-21');
  await page.getByLabel('Email').fill('noah.clarke@example.com');
  await page.getByLabel('Mobile phone').fill('07700 900777');
  await shot(page, '02-register', { fullPage: true });

  await page.goto('/forgot-password');
  await shot(page, '03-forgot-password');
  await page.context().close();
});

test('patient journey', async ({ browser }) => {
  const page = await open(browser, 'guide');
  await signIn(page, AMELIA.email);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await shot(page, '10-patient-dashboard');

  // Booking wizard.
  await page.getByRole('link', { name: 'Book' }).first().click();
  await expect(page.getByRole('heading', { name: 'Book an appointment' })).toBeVisible();
  await page.getByLabel(/Standard consultation/).check();
  await shot(page, '11-book-type');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/Dr Priya Shah/).check();
  await shot(page, '12-book-doctor');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  const slot = page.getByRole('button', { name: /^10:30/ }).first();
  await slot.click();
  await shot(page, '13-book-time');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByLabel('Reason for visit (optional)')
    .fill('Follow-up on asthma, inhaler running low.');
  await shot(page, '14-book-confirm');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.getByText('Your appointment is booked.')).toBeVisible();
  await shot(page, '15-appointments', { fullPage: true });

  await page
    .getByRole('link', { name: /^Reschedule/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Reschedule appointment' })).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  await page
    .getByRole('button', { name: /^14:00/ })
    .first()
    .click();
  await shot(page, '16-reschedule');
  await page
    .getByRole('link', { name: /Appointments/ })
    .first()
    .click();

  await page
    .getByRole('button', { name: /^Cancel\b/ })
    .first()
    .click();
  await page
    .getByRole('dialog', { name: 'Cancel appointment' })
    .getByLabel(/Reason/)
    .fill('Away that week');
  await shot(page, '17-cancel');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Keep|Close|Back/ })
    .first()
    .click()
    .catch(() => page.keyboard.press('Escape'));

  await page.goto('/dashboard');
  await shot(page, '18-dashboard-booked');
  await page.goto('/profile');
  await shot(page, '19-profile', { fullPage: true });
  await page.goto('/account/security');
  await shot(page, '20-account-security', { fullPage: true });
  await page.context().close();
});

test('first sign-in for staff: two-step verification', async ({ browser }) => {
  const page = await open(browser, 'guide');
  await signIn(page, DOCTORS[2].email);
  await page.waitForURL('**/mfa/setup');
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await shot(page, '04-mfa-setup', { fullPage: true });
  await page.context().close();

  // The sign-in code screen, as an enrolled staff member sees it.
  const again = await open(browser, 'guide');
  await signIn(
    again,
    STAFF.reception.email,
    () => codeFor(seed.staff.reception.userId, seed.staff.reception.secret),
    async () => {
      await shot(again, '05-sign-in-code');
    },
  );
  await again.context().close();
});

test('doctor screens', async ({ browser }) => {
  const page = await open(browser, 'guide');
  await signIn(page, DOCTORS[0].email, () =>
    codeFor(seed.doctors.shah.userId, seed.doctors.shah.secret!),
  );
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await shot(page, '30-doctor-schedule');
  await page.getByRole('button', { name: /09:00–09:15 James Okafor/ }).click();
  await expect(page.getByText(/BP 138\/86/)).toBeVisible();
  await shot(page, '31-doctor-appointment', { fullPage: true });

  await page.getByRole('link', { name: 'Patients' }).first().click();
  await page.getByLabel('Search patients').fill('Ellis');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: /Ellis, Margaret/ }).click();
  await expect(page.getByRole('heading', { name: /Margaret Ellis/ })).toBeVisible();
  await shot(page, '32-doctor-patient', { fullPage: true });

  await page.getByRole('link', { name: 'Availability' }).first().click();
  await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();
  await shot(page, '33-availability', { fullPage: true });
  await page.context().close();
});

test('reception screens', async ({ browser }) => {
  const page = await open(browser, 'guide');
  await signIn(page, STAFF.reception.email, () =>
    codeFor(seed.staff.reception.userId, seed.staff.reception.secret),
  );
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible();
  await shot(page, '40-front-desk', { fullPage: true });
  const column = page.getByRole('region', { name: /Dr Priya Shah/ });
  await column
    .getByRole('button', { name: /^Check in/ })
    .first()
    .click();
  await expect(column.getByText(/Checked in/i).first()).toBeVisible();

  await page.getByRole('link', { name: 'Patients' }).first().click();
  await page.getByLabel('Search patients').fill('EX4');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('link', { name: /Okafor, James/ })).toBeVisible();
  await shot(page, '41-patient-search');

  await page.getByRole('link', { name: /Okafor, James/ }).click();
  await expect(page.getByRole('heading', { name: /James Okafor/ })).toBeVisible();
  await shot(page, '42-patient-record', { fullPage: true });

  await page.goto('/patients/new');
  await page.getByLabel('First name').fill('Ruth');
  await page.getByLabel('Last name').fill('Adeyemi');
  await page.getByLabel('Date of birth').fill('1957-02-11');
  await shot(page, '43-new-patient');
  await page.context().close();
});

test('admin screens', async ({ browser }) => {
  const page = await open(browser, 'guide');
  await signIn(page, STAFF.manager.email, () =>
    codeFor(seed.staff.manager.userId, seed.staff.manager.secret),
  );
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await shot(page, '50-admin-users');

  await page.getByRole('link', { name: 'Add staff member' }).click();
  await page.getByLabel('Work email').fill('ben.carter@maplegrove.example');
  await page.getByLabel('Role').selectOption('doctor');
  await page.getByLabel('Name shown to patients').fill('Dr Ben Carter');
  await page.getByLabel('Specialty (optional)').fill('General Practice');
  await shot(page, '51-admin-new-staff', { fullPage: true });
  await page.getByRole('button', { name: 'Create account and send invitation' }).click();
  await expect(page.getByText('Account created. An invitation has been emailed.')).toBeVisible();
  await shot(page, '52-admin-user', { fullPage: true });

  await page.getByRole('link', { name: 'Appointment types' }).first().click();
  await expect(page.getByRole('heading', { name: 'Appointment types' })).toBeVisible();
  await shot(page, '53-admin-types', { fullPage: true });
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('heading', { name: 'Clinic settings' })).toBeVisible();
  await shot(page, '54-admin-settings', { fullPage: true });
  await page.getByRole('link', { name: 'Audit log' }).first().click();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await shot(page, '55-admin-audit');
  await page.context().close();
});

test('booking confirmation email', async ({ browser }) => {
  // The real message, read back from Mailpit, shown in a simple mail-client frame.
  const search = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${AMELIA.email}" subject:"Appointment booked"`)}&limit=1`,
  );
  const { messages } = (await search.json()) as { messages: { ID: string }[] };
  const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0]!.ID}`)).json()) as {
    Subject: string;
    From: { Name: string; Address: string };
    Text: string;
    Attachments: { FileName: string }[];
  };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // The demo runs on localhost; show the link as the clinic's public address would be.
  msg.Text = msg.Text.replaceAll(WEB_URL, 'https://appointments.maplegrove.example');
  const page = await open(browser, 'guide');
  await page.setContent(`<!doctype html><html><body style="margin:0;font:15px/1.5 system-ui,sans-serif;background:#eef1f5">
    <div style="max-width:760px;margin:0 auto;background:#fff;border-radius:10px;box-shadow:0 2px 12px #0002;overflow:hidden">
      <div style="padding:18px 24px;border-bottom:1px solid #e3e7ed">
        <div style="font-size:19px;font-weight:600;color:#0f172a">${esc(msg.Subject)}</div>
        <div style="color:#475569;margin-top:4px">From ${esc(msg.From.Name || msg.From.Address)} &lt;${esc(msg.From.Address)}&gt; · To ${esc(AMELIA.email)}</div>
      </div>
      <pre style="margin:0;padding:20px 24px;font:inherit;white-space:pre-wrap;color:#1e293b">${esc(msg.Text)}</pre>
      <div style="padding:0 24px 22px">${msg.Attachments.map((a) => `<span style="display:inline-block;border:1px solid #cbd5e1;border-radius:6px;padding:6px 12px;color:#334155">📅 ${esc(a.FileName)}</span>`).join(' ')}</div>
    </div></body></html>`);
  await page.setViewportSize({ width: 860, height: 640 });
  // Just the message, not the empty window around it.
  await page
    .locator('body > div')
    .screenshot({ path: path.join(GUIDE_IMAGES, '21-email-booked.png') });
  await page.context().close();
});

test('marketing captures', async ({ browser }) => {
  // Desktop, retina.
  const desk = await open(browser, 'desktop');
  await signIn(desk, DOCTORS[0].email, () =>
    codeFor(seed.doctors.shah.userId, seed.doctors.shah.secret!),
  );
  await raw(desk, 'desktop-schedule');
  await desk.getByRole('button', { name: /09:30–09:45 Sofia Rossi/ }).click();
  await expect(desk.getByText('Peanuts')).toBeVisible();
  await raw(desk, 'desktop-appointment');
  await desk.context().close();

  const front = await open(browser, 'desktop');
  await signIn(front, STAFF.reception.email, () =>
    codeFor(seed.staff.reception.userId, seed.staff.reception.secret),
  );
  await raw(front, 'desktop-front-desk');
  await front.context().close();

  // Phone: the patient side.
  const phone = await open(browser, 'phone');
  await signIn(phone, AMELIA.email);
  await raw(phone, 'phone-dashboard');
  await phone.goto('/book');
  await phone.getByLabel(/Long consultation/).check();
  await phone.getByRole('button', { name: 'Continue' }).click();
  await phone.getByLabel(/Dr Tom Reed/).check();
  await phone.getByRole('button', { name: 'Continue' }).click();
  await phone.getByRole('button', { name: 'Next week' }).click();
  await phone
    .getByRole('button', { name: /^09:00/ })
    .first()
    .click();
  await raw(phone, 'phone-book-time');
  await phone.goto('/appointments');
  await raw(phone, 'phone-appointments');
  await phone.context().close();

  // Each colour theme, previewed with ?theme= on the sign-in page.
  for (const theme of THEMES) {
    const p = await open(browser, 'phone');
    await p.goto(`/login?theme=${theme.id}`);
    await raw(p, `theme-${theme.id}`);
    await p.context().close();
  }
  writeFileSync(path.join(RAW_DIR, 'themes.json'), JSON.stringify(THEMES));
});
