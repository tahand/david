import { randomBytes, randomInt } from 'node:crypto';
import {
  expect,
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PrismaClient, type Role } from '@prisma/client';
import argon2 from 'argon2';
import { generate } from 'otplib';
import { MAILPIT_URL, TEST_DATABASE_URL } from '../env';

export const PASSWORD = 'an e2e test passphrase';

// ------------------------------------------------------------------ fixtures

interface Guard {
  violations: string[];
  errors: string[];
}

/** Gives a browser context its own client IP and records CSP violations. */
async function prepareContext(context: BrowserContext): Promise<void> {
  // X-Forwarded-For passes through the preview proxy, so per-IP rate limits
  // see each context as a separate user, as they would be in real life.
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
  await context.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`);
    });
  });
}

/** Collects uncaught errors and CSP violations on a page; `check()` asserts there were none. */
function watchPage(page: Page) {
  const guard: Guard = { violations: [], errors: [] };
  page.on('pageerror', (err) => guard.errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) {
      guard.violations.push(msg.text());
    }
  });
  return async () => {
    if (!page.isClosed()) {
      const recorded = await page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => [] as string[]);
      guard.violations.push(...recorded);
    }
    expect(guard.violations, 'CSP violations').toEqual([]);
    expect(guard.errors, 'uncaught page errors').toEqual([]);
  };
}

/**
 * A second browser (another device, another IP) with the same checks as the
 * test's own page. Call `close()` at the end of the test.
 */
export async function openDevice(browser: Browser) {
  const context = await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' });
  await prepareContext(context);
  const page = await context.newPage();
  const check = watchPage(page);
  return {
    page,
    close: async () => {
      await check();
      await context.close();
    },
  };
}

/** Every test's page fails on a CSP violation or an uncaught error. */
export const test = base.extend<{ guard: void }>({
  context: async ({ context }, use) => {
    await prepareContext(context);
    await use(context);
  },
  guard: [
    async ({ page }, use) => {
      const check = watchPage(page);
      await use();
      await check();
    },
    { auto: true },
  ],
});
export { expect };

// ------------------------------------------------------------------ database

export const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
test.afterAll(async () => {
  await prisma.$disconnect();
});

/** Short unique token for names and emails, so tests never collide. */
export const uid = () => randomBytes(4).toString('hex');
export const uniqueEmail = (prefix: string) => `${prefix}.${uid()}@example.test`;

const hash = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });

export async function createUser(role: Role, opts: { email?: string; password?: string } = {}) {
  return prisma.user.create({
    data: {
      email: opts.email ?? uniqueEmail(role),
      role,
      passwordHash: await hash(opts.password ?? PASSWORD),
      emailVerifiedAt: new Date(),
    },
  });
}

/** A doctor who works 08:00–18:00 every day, and a dedicated appointment type. */
export async function createWorkingDoctor() {
  const name = `Dr E2E ${uid()}`;
  const user = await createUser('doctor');
  const doctor = await prisma.doctor.create({
    data: { userId: user.id, displayName: name, specialty: 'General Practice' },
  });
  await prisma.availabilityRule.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      doctorId: doctor.id,
      weekday,
      startTime: new Date('1970-01-01T08:00:00Z'),
      endTime: new Date('1970-01-01T18:00:00Z'),
      validFrom: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
    })),
  });
  const type = await prisma.appointmentType.create({
    data: { name: `E2E consultation ${uid()}`, durationMinutes: 15, colour: '#2563EB' },
  });
  return { user, doctor, name, type };
}

// ------------------------------------------------------------------ email

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Waits for an email to `to` whose subject matches, and returns its text. */
export async function waitForEmail(to: string, subject: RegExp, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`,
    );
    const { messages } = (await res.json()) as { messages: MailpitMessage[] };
    const match = messages.find((m) => subject.test(m.Subject));
    if (match) {
      const full = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const body = (await full.json()) as { Text: string; Attachments?: { FileName: string }[] };
      return { subject: match.Subject, text: body.Text, attachments: body.Attachments ?? [] };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No email to ${to} matching ${subject} within ${timeoutMs} ms`);
}

export const linkFrom = (text: string) => {
  const url = /(https?:\/\/\S+token=[\w-]+)/.exec(text)?.[1];
  if (!url) throw new Error('No link in email');
  return new URL(url).pathname + new URL(url).search;
};

// ------------------------------------------------------------------ auth

export const totp = (secret: string, stepsAhead = 0) =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + stepsAhead * 30 });

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Completes /mfa/setup from the manual key on screen; returns the secret. */
export async function enrolMfa(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
  const key = (await page.locator('code').first().innerText()).replace(/\s+/g, '');
  await page.getByLabel('6-digit code').fill(await totp(key));
  await expect(page.getByRole('heading', { name: 'Two-step verification is on' })).toBeVisible();
  await page.getByLabel(/I have saved my recovery codes/).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  return key;
}

/** A signed-in staff member with MFA enrolled through the UI. */
export async function signInStaff(page: Page, role: Exclude<Role, 'patient'>, email?: string) {
  const user = email
    ? await prisma.user.findUniqueOrThrow({ where: { email } })
    : await createUser(role);
  await signIn(page, user.email);
  await page.waitForURL('**/mfa/setup');
  const secret = await enrolMfa(page);
  return { user, secret };
}

// ------------------------------------------------------------------ checks

/** WCAG 2.1 AA scan with axe; fails with a readable list of problems. */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help} — ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(', ')}`,
  );
  expect(summary, `accessibility problems on ${label}`).toEqual([]);
}

/** No horizontal page scrolling (CLAUDE.md: mobile-first). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page is wider than the viewport').toBeLessThanOrEqual(0);
}
