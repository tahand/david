import type { Page } from '@playwright/test';
import {
  PASSWORD,
  createUser,
  createWorkingDoctor,
  enrolMfa,
  expect,
  expectAccessible,
  expectNoHorizontalScroll,
  linkFrom,
  openDevice,
  prisma,
  signIn,
  signInStaff,
  test,
  uid,
  uniqueEmail,
  waitForEmail,
} from './support';

const TZ = 'Europe/London';

/** Today's date in clinic time, e.g. 2026-11-03. */
const clinicToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, dateStyle: 'short' }).format(new Date());

/** A wall-clock time today in clinic time, as a UTC instant. */
function todayAt(time: string): Date {
  const guess = new Date(`${clinicToday()}T${time}:00Z`);
  const shown = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(guess);
  const [h, m] = shown.split(':').map(Number);
  const [wantH, wantM] = time.split(':').map(Number);
  return new Date(guess.getTime() - ((h! - wantH!) * 60 + (m! - wantM!)) * 60_000);
}

/** A patient without a login (created by reception) with an appointment at 12:00 today. */
async function patientBookedToday(doctorId: string, typeId: string, bookedBy: string) {
  const lastName = `E2e${uid()}`;
  const patient = await prisma.patient.create({
    data: {
      firstName: 'Sam',
      lastName,
      dateOfBirth: new Date('1979-06-07'),
      contactEmail: uniqueEmail('walkin'),
    },
  });
  const startsAt = todayAt('12:00');
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId,
      appointmentTypeId: typeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 15 * 60_000),
      bookedByUserId: bookedBy,
    },
  });
  return { patient, appointment, name: `Sam ${lastName}` };
}

test('staff must enrol in MFA before anything else; a doctor then records a clinical note', async ({
  page,
}) => {
  const doc = await createWorkingDoctor();
  const { appointment, name } = await patientBookedToday(doc.doctor.id, doc.type.id, doc.user.id);

  await signIn(page, doc.user.email);
  await page.waitForURL('**/mfa/setup');
  await expect(
    page.getByText('Staff accounts must use two-step verification before continuing.'),
  ).toBeVisible();
  // SPEC §15: staff cannot reach anything until MFA is enrolled.
  await page.goto('/schedule');
  await page.waitForURL('**/mfa/setup');
  const api = await page.request.get('/api/appointments');
  expect(api.status()).toBe(403);
  expect((await api.json()).error.code).toBe('MFA_ENROLMENT_REQUIRED');

  await enrolMfa(page);
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expectAccessible(page, 'doctor schedule');

  await page.getByRole('button', { name: new RegExp(`12:00–12:15 ${name}`) }).click();
  await page.getByLabel('New note').fill('Examined chest. Advised rest.');
  await page.getByRole('button', { name: 'Add note' }).click();
  // The note box empties once it is saved.
  await expect(page.getByLabel('New note')).toHaveValue('');
  await expect(page.getByText('Examined chest. Advised rest.').first()).toBeVisible();

  // Stored as ciphertext (SPEC §15: unreadable when inspected directly).
  await expect
    .poll(() => prisma.clinicalNote.count({ where: { appointmentId: appointment.id } }))
    .toBe(1);
  const note = await prisma.clinicalNote.findFirstOrThrow({
    where: { appointmentId: appointment.id },
  });
  expect(note.bodyEnc).toMatch(/^v1:/);
  expect(note.bodyEnc).not.toContain('chest');
});

async function bookFromWizard(page: Page, typeName: string, doctorName: string) {
  await page.getByLabel(typeName).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(doctorName).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  await page
    .getByRole('button', { name: /^\d\d:\d\d/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Book appointment' }).click();
}

test('reception checks a patient in and books for another patient', async ({ page }) => {
  const doc = await createWorkingDoctor();
  const today = await patientBookedToday(doc.doctor.id, doc.type.id, doc.user.id);
  await signInStaff(page, 'receptionist');
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible();

  const column = page.getByRole('region', { name: new RegExp(doc.name) });
  await expect(column.getByText(today.name).first()).toBeVisible();
  await column.getByRole('button', { name: /^Check in/ }).click();
  await expect(column.getByText(/Checked in/i).first()).toBeVisible();
  await expectAccessible(page, 'front desk');
  const row = await prisma.appointment.findUniqueOrThrow({ where: { id: today.appointment.id } });
  expect(row.status).toBe('checked_in');

  // Search by surname and book on their behalf.
  await page.getByRole('link', { name: 'Patients' }).first().click();
  await page.getByLabel('Search patients').fill(today.patient.lastName);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: new RegExp(today.patient.lastName) }).click();
  await page.getByRole('link', { name: 'Book appointment' }).click();
  await bookFromWizard(page, doc.type.name, doc.name);
  await expect(page.getByText('Appointment booked.')).toBeVisible();
  expect(
    await prisma.appointment.count({ where: { patientId: today.patient.id, status: 'booked' } }),
  ).toBe(1);
});

test('an admin invites a receptionist, who sets a password and must enrol MFA; the audit log shows it', async ({
  page,
  browser,
}) => {
  test.slow();
  await signInStaff(page, 'admin');
  await page.getByRole('link', { name: 'Users' }).first().click();
  await expectAccessible(page, 'admin users');
  await page.getByRole('link', { name: 'Add staff member' }).click();
  const email = uniqueEmail('invited');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Role').selectOption('receptionist');
  await page.getByRole('button', { name: 'Create account and send invitation' }).click();
  await expect(page.getByText('Account created. An invitation has been emailed.')).toBeVisible();
  const userId = page.url().split('/').pop()!;

  // The new receptionist, on their own device.
  const invite = await waitForEmail(email, /Set up your account/);
  const them = await openDevice(browser);
  await them.page.goto(linkFrom(invite.text));
  await them.page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await them.page.getByLabel('Confirm new password').fill(PASSWORD);
  await them.page.getByRole('button', { name: 'Change password' }).click();
  await expect(them.page.getByText(/Your password has been changed/)).toBeVisible();
  await signIn(them.page, email);
  await them.page.waitForURL('**/mfa/setup');
  await them.close();

  await page.goto(`/admin/audit-logs?entity=${userId}`);
  await expect(page.getByText('admin.user.created')).toBeVisible();
  await expect(page.getByText('auth.password.reset')).toBeVisible();
  await expectAccessible(page, 'audit log');
});

test('the last-resort lockout: 10 failed sign-ins lock the account and email the user', async ({
  page,
  browser,
}) => {
  test.slow();
  const user = await createUser('patient');
  // 5 attempts per minute per IP, so spread the attempts over devices.
  for (let device = 0; device < 2; device++) {
    const d = await openDevice(browser);
    for (let i = 0; i < 5; i++) {
      await signIn(d.page, user.email, `wrong password ${device}${i}`);
      await expect(d.page.getByRole('alert')).toBeVisible();
    }
    await d.close();
  }
  await signIn(page, user.email);
  await expect(page.getByRole('alert')).toContainText('Too many unsuccessful sign-in attempts');
  const email = await waitForEmail(user.email, /temporarily locked/);
  expect(email.text).toContain('15 minutes');
});

test('staff screens fit a phone @phone', async ({ page, browser }) => {
  test.slow();
  const doc = await createWorkingDoctor();
  await patientBookedToday(doc.doctor.id, doc.type.id, doc.user.id);

  await signInStaff(page, 'doctor', doc.user.email);
  for (const path of ['/schedule', '/availability', '/patients']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, `doctor ${path}`);
  }

  const admin = await openDevice(browser);
  await admin.page.setViewportSize({ width: 360, height: 780 });
  await signInStaff(admin.page, 'admin');
  for (const path of [
    '/front-desk',
    '/admin/users',
    '/admin/users/new',
    '/admin/appointment-types',
    '/admin/settings',
    '/admin/audit-logs',
  ]) {
    await admin.page.goto(path);
    await expect(admin.page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(admin.page);
    await expectAccessible(admin.page, `admin ${path}`);
  }
  await admin.close();
});
