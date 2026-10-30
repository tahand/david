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
  test,
  totp,
  uid,
  uniqueEmail,
  waitForEmail,
} from './support';

/** Picks a slot two weeks out, clear of the 24-hour change cut-off. */
async function pickSlot(page: Page, index: number) {
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: 'Next week' }).click();
  const day = page
    .locator('fieldset')
    .filter({ has: page.getByRole('button', { name: /^\d\d:\d\d/ }) })
    .first();
  const slot = day.getByRole('button', { name: /^\d\d:\d\d/ }).nth(index);
  const time = (await slot.innerText()).slice(0, 5);
  await slot.click();
  return time;
}

test('a patient registers, verifies, enables MFA, completes their profile, books, moves and cancels', async ({
  page,
  browser,
}) => {
  test.slow();
  const { name: doctor, type } = await createWorkingDoctor();
  const email = uniqueEmail('patient');
  const lastName = `E2e${uid()}`;

  // Registration and MFA set-up happen on one device; the rest on another,
  // which also keeps each device under the 5-per-minute credential limit.
  const first = await openDevice(browser);
  const setup = first.page;

  // --- register (SPEC §5.3)
  await setup.goto('/register');
  await setup.getByLabel('First name').fill('Robin');
  await setup.getByLabel('Last name').fill(lastName);
  await setup.getByLabel('Date of birth').fill('1988-04-12');
  await setup.getByLabel('Email').fill(email);
  await setup.getByLabel('Mobile phone').fill('07700 900456');
  await setup.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await setup.getByLabel('Confirm password').fill(PASSWORD);
  await setup.getByLabel(/I have read and accept/).check();
  await setup.getByRole('button', { name: 'Create account' }).click();
  await expect(setup.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Consent is recorded with its version and time.
  const patient = await prisma.patient.findFirstOrThrow({ where: { lastName } });
  expect(patient.consentVersion).toBeTruthy();
  expect(patient.consentAt).not.toBeNull();

  // --- verify email from the real message
  const verify = await waitForEmail(email, /Confirm your email/);
  await setup.goto(linkFrom(verify.text));
  await expect(setup.getByText('Your email address is confirmed.')).toBeVisible();

  // --- sign in and enable MFA (optional for patients)
  await signIn(setup, email);
  await expect(setup.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expectAccessible(setup, 'patient dashboard');
  await setup.getByRole('link', { name: 'Set up two-step verification' }).click();
  const secret = await enrolMfa(setup);
  await expect(setup.getByRole('heading', { name: 'Account security' })).toBeVisible();

  // Sign out, then sign in on another device: the code is now required.
  await setup.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(setup.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await first.close();

  await signIn(page, email);
  await page.getByLabel('Authentication code').fill(await totp(secret, 1));
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();

  // --- complete the profile
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Edit details' }).click();
  await page.getByLabel('Address line 1 (optional)').fill('12 Test Lane');
  await page.getByLabel('Town or city (optional)').fill('Exampletown');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your details have been saved.')).toBeVisible();
  await expect(page.getByText('12 Test Lane')).toBeVisible();
  await expectAccessible(page, 'profile');

  // --- book
  await page.goto('/book');
  await page.getByLabel(type.name).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(doctor).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const bookedAt = await pickSlot(page, 0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Reason for visit (optional)').fill('Persistent cough');
  await expectAccessible(page, 'booking confirmation');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page.getByText('Your appointment is booked.')).toBeVisible();
  const upcoming = page
    .getByRole('region', { name: 'Upcoming' })
    .or(page.locator('section').filter({ hasText: 'Upcoming' }));
  await expect(upcoming.getByText(new RegExp(bookedAt)).first()).toBeVisible();

  const booked = await waitForEmail(email, /Appointment booked/);
  expect(booked.attachments.map((a) => a.FileName)).toContain('appointment.ics');
  expect(booked.text).toContain(doctor);
  // SPEC §7.4: no medical details in emails.
  expect(booked.text).not.toContain('Persistent cough');
  expect(booked.text).not.toContain(type.name);
  // The reason is stored encrypted, not as plain text.
  const row = await prisma.appointment.findFirstOrThrow({ where: { patientId: patient.id } });
  expect(row.reasonForVisitEnc).toMatch(/^v1:/);
  expect(row.reasonForVisitEnc).not.toContain('cough');

  // --- reschedule
  await page.getByRole('link', { name: /^Reschedule/ }).click();
  await expect(page.getByRole('heading', { name: 'Reschedule appointment' })).toBeVisible();
  const movedTo = await pickSlot(page, 1);
  await page.getByRole('button', { name: 'Move appointment' }).click();
  await expect(page.getByText('Your appointment has been moved.')).toBeVisible();
  await expect(page.getByText(new RegExp(movedTo)).first()).toBeVisible();
  await waitForEmail(email, /Appointment moved/);

  // --- cancel
  await page.getByRole('button', { name: /^Cancel\b/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel appointment' });
  await dialog.getByLabel(/Reason/).fill('Feeling better');
  await dialog.getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(page.getByText('Your appointment has been cancelled.')).toBeVisible();
  const cancelled = await waitForEmail(email, /Appointment cancelled/);
  expect(cancelled.attachments.map((a) => a.FileName)).toContain('appointment.ics');
  await expectAccessible(page, 'appointments');
});

test('patient pages fit a phone @phone', async ({ page }) => {
  const email = uniqueEmail('phone.patient');
  const user = await createUser('patient', { email });
  await prisma.patient.create({
    data: {
      userId: user.id,
      firstName: 'Pip',
      lastName: `E2e${uid()}`,
      dateOfBirth: new Date('1992-03-04'),
    },
  });
  await signIn(page, email);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  for (const path of ['/dashboard', '/book', '/appointments', '/profile', '/account/security']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, path);
  }
});
