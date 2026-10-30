import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_CLINIC_SETTINGS } from '@clinic/shared';
import type { MemoryMailer } from '../../lib/email.js';
import { PASSWORD, createUser, login } from '../../test/auth-fixtures.js';
import type { TestClient } from '../../test/client.js';
import { anonClient, patientClient, staffClient, uniqueName } from '../../test/clients.js';
import { fakeEmail, testPrisma } from '../../test/db.js';
import { buildTestApp } from '../../test/helpers.js';
import { appointmentType, insertAppointment, HOUR } from '../../test/scheduling.js';

let prisma: PrismaClient;
let app: Express;
let mailer: MemoryMailer;

beforeAll(() => {
  prisma = testPrisma();
  ({ app, mailer } = buildTestApp({
    prisma,
    rateLimits: { globalPerMinute: 10_000, credentialPerMinute: 10_000 },
  }));
});
afterAll(async () => {
  await prisma.$disconnect();
});

const admin = () => staffClient(app, prisma, 'admin');
const flushEmails = () => new Promise((r) => setTimeout(r, 20));
const linkToken = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

// -----------------------------------------------------------------------------

describe('admin authorisation', () => {
  const routes: [string, string][] = [
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users'],
    ['GET', '/api/admin/appointment-types'],
    ['GET', '/api/admin/settings'],
    ['PUT', '/api/admin/settings'],
    ['GET', '/api/admin/audit-logs'],
  ];
  const call = (c: TestClient, method: string, path: string) =>
    method === 'GET' ? c.get(path) : method === 'PUT' ? c.put(path, {}) : c.post(path, {});

  it.each(routes)('%s %s requires sign-in', async (method, path) => {
    const res = await call(await anonClient(app), method, path);
    expect(res.status).toBe(401);
  });

  it.each(['doctor', 'receptionist'] as const)('refuses a %s', async (role) => {
    const { client } = await staffClient(app, prisma, role);
    for (const [method, path] of routes) {
      const res = await call(client, method, path);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('refuses a patient', async () => {
    const { client } = await patientClient(app, prisma);
    expect((await client.get('/api/admin/users')).status).toBe(403);
  });

  it('refuses an admin who has not enrolled in MFA', async () => {
    const user = await createUser(prisma, { role: 'admin' });
    const c = await anonClient(app);
    await login(c, user.email);
    const res = await c.get('/api/admin/users');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_ENROLMENT_REQUIRED');
  });

  it('sends no-store', async () => {
    const { client } = await admin();
    const res = await client.get('/api/admin/users');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('staff accounts', () => {
  it('creates a receptionist who sets a password from the emailed link, then must enrol MFA', async () => {
    const { client, user: actor } = await admin();
    const email = fakeEmail('new.reception');
    const res = await client.post('/api/admin/users', {
      email,
      role: 'receptionist',
      isActive: false,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email,
      role: 'receptionist',
      isActive: true,
      invitePending: true,
      emailVerified: false,
      mfaEnabled: false,
      doctor: null,
    });

    await flushEmails();
    const invite = mailer.last(email)!;
    expect(invite.subject).toMatch(/Set up your account/);
    const token = linkToken(invite.text);
    const row = await prisma.emailToken.findFirstOrThrow({
      where: { userId: res.body.id, type: 'invite' },
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(71 * HOUR);

    // Nobody can sign in before choosing a password.
    const c = await anonClient(app);
    expect((await login(c, email)).status).toBe(401);

    const newPassword = 'a staff member passphrase';
    expect(
      (await c.post('/api/auth/reset-password', { token, password: newPassword })).status,
    ).toBe(200);
    const signedIn = await login(c, email, newPassword);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.mfaEnrolmentRequired).toBe(true);
    expect(signedIn.body.user.emailVerified).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.user.created', entityId: res.body.id },
    });
    expect(audit.actorUserId).toBe(actor.id);
    expect(audit.metadata).toEqual({ role: 'receptionist' });
  });

  it('creates a doctor with a profile, who appears in the doctor list', async () => {
    const { client } = await admin();
    const name = `Dr ${uniqueName()}`;
    const missing = await client.post('/api/admin/users', { email: fakeEmail(), role: 'doctor' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details[0].path).toBe('doctor.displayName');

    const res = await client.post('/api/admin/users', {
      email: fakeEmail('dr'),
      role: 'doctor',
      doctor: { displayName: name, specialty: 'General Practice', registrationNumber: '' },
    });
    expect(res.status).toBe(201);
    expect(res.body.doctor).toMatchObject({
      displayName: name,
      specialty: 'General Practice',
      registrationNumber: null,
      isBookable: true,
    });
    const doctors = await client.get('/api/doctors');
    expect(doctors.body.doctors.map((d: { displayName: string }) => d.displayName)).toContain(name);
  });

  it('validates input and rejects duplicate emails', async () => {
    const { client } = await admin();
    expect((await client.post('/api/admin/users', { email: 'nope', role: 'admin' })).status).toBe(
      400,
    );
    expect(
      (await client.post('/api/admin/users', { email: fakeEmail(), role: 'patient' })).status,
    ).toBe(400);
    const existing = await createUser(prisma, { role: 'patient' });
    const dup = await client.post('/api/admin/users', {
      email: existing.email.toUpperCase(),
      role: 'receptionist',
    });
    expect(dup.status).toBe(409);
  });

  it('lists and filters users', async () => {
    const { client } = await admin();
    const name = uniqueName();
    const created = await client.post('/api/admin/users', {
      email: fakeEmail(`${name}.rec`),
      role: 'receptionist',
    });
    const byQuery = await client.get(`/api/admin/users?q=${name.toLowerCase()}`);
    expect(byQuery.status).toBe(200);
    expect(byQuery.body.users.map((u: { id: string }) => u.id)).toEqual([created.body.id]);

    const byRole = await client.get(`/api/admin/users?q=${name}&role=doctor`);
    expect(byRole.body.users).toEqual([]);
    const inactive = await client.get(`/api/admin/users?q=${name}&status=inactive`);
    expect(inactive.body.users).toEqual([]);
    expect((await client.get('/api/admin/users?role=superuser')).status).toBe(400);
    expect((await client.get('/api/admin/users?page=0')).status).toBe(400);
  });

  it('returns 404 for unknown or malformed IDs', async () => {
    const { client } = await admin();
    const unknown = '5f0c1f3e-1111-4222-8333-444455556666';
    expect((await client.get(`/api/admin/users/${unknown}`)).status).toBe(404);
    expect((await client.get('/api/admin/users/not-a-uuid')).status).toBe(404);
    expect((await client.patch(`/api/admin/users/${unknown}`, { isActive: false })).status).toBe(
      404,
    );
    expect((await client.post(`/api/admin/users/${unknown}/mfa-reset`)).status).toBe(404);
  });

  it('changes a role, signing the user out everywhere', async () => {
    const { client } = await admin();
    const target = await staffClient(app, prisma, 'receptionist');
    expect((await target.client.get('/api/auth/me')).status).toBe(200);

    const noName = await client.patch(`/api/admin/users/${target.user.id}`, { role: 'doctor' });
    expect(noName.status).toBe(400);

    const res = await client.patch(`/api/admin/users/${target.user.id}`, {
      role: 'doctor',
      doctor: { displayName: `Dr ${uniqueName()}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('doctor');
    expect(res.body.doctor.displayName).toMatch(/^Dr /);
    expect((await target.client.get('/api/auth/me')).status).toBe(401);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.user.updated', entityId: target.user.id },
    });
    expect(audit.metadata).toMatchObject({ fromRole: 'receptionist', toRole: 'doctor' });
  });

  it('hides a doctor whose role is changed away from doctor', async () => {
    const { client } = await admin();
    const name = `Dr ${uniqueName()}`;
    const doc = await staffClient(app, prisma, 'doctor', name);
    const res = await client.patch(`/api/admin/users/${doc.user.id}`, { role: 'receptionist' });
    expect(res.status).toBe(200);
    const doctors = await client.get('/api/doctors');
    expect(doctors.body.doctors.map((d: { displayName: string }) => d.displayName)).not.toContain(
      name,
    );
    // The profile is kept for history.
    expect(await prisma.doctor.findUnique({ where: { userId: doc.user.id } })).not.toBeNull();
  });

  it('refuses to remove a doctor who has upcoming appointments', async () => {
    const { client } = await admin();
    const doc = await staffClient(app, prisma, 'doctor', `Dr ${uniqueName()}`);
    const { patient, user } = await patientClient(app, prisma);
    const type = await appointmentType(prisma);
    await insertAppointment(prisma, {
      patientId: patient.id,
      doctorId: doc.doctor!.id,
      typeId: type.id,
      startsAt: new Date(Date.now() + 48 * HOUR),
      bookedByUserId: user.id,
    });
    for (const body of [{ role: 'receptionist' }, { isActive: false }]) {
      const res = await client.patch(`/api/admin/users/${doc.user.id}`, body);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/1 upcoming appointment/);
    }
  });

  it('deactivates and reactivates an account', async () => {
    const { client } = await admin();
    const target = await staffClient(app, prisma, 'receptionist');
    const off = await client.patch(`/api/admin/users/${target.user.id}`, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    expect((await target.client.get('/api/auth/me')).status).toBe(401);
    expect((await login(await anonClient(app), target.user.email)).status).toBe(401);

    const on = await client.patch(`/api/admin/users/${target.user.id}`, { isActive: true });
    expect(on.body.isActive).toBe(true);
    expect((await login(await anonClient(app), target.user.email)).status).toBe(200);
  });

  it("won't let admins demote, deactivate, reset or un-MFA themselves", async () => {
    const { client, user } = await admin();
    for (const body of [{ role: 'receptionist' }, { isActive: false }]) {
      expect((await client.patch(`/api/admin/users/${user.id}`, body)).status).toBe(409);
    }
    expect((await client.post(`/api/admin/users/${user.id}/password-reset`)).status).toBe(409);
    expect((await client.post(`/api/admin/users/${user.id}/mfa-reset`)).status).toBe(409);
    expect((await client.patch(`/api/admin/users/${user.id}`, {})).status).toBe(400);
  });

  it('only gives doctor profiles to doctors, and never a staff role to a patient', async () => {
    const { client } = await admin();
    const rec = await staffClient(app, prisma, 'receptionist');
    const res = await client.patch(`/api/admin/users/${rec.user.id}`, {
      doctor: { displayName: 'Nope' },
    });
    expect(res.status).toBe(400);
    const { user: patient } = await patientClient(app, prisma);
    expect((await client.patch(`/api/admin/users/${patient.id}`, { role: 'admin' })).status).toBe(
      409,
    );
  });

  it('forces a password reset: old password stops working and a new link is emailed', async () => {
    const { client } = await admin();
    const target = await staffClient(app, prisma, 'receptionist');
    const res = await client.post(`/api/admin/users/${target.user.id}/password-reset`);
    expect(res.status).toBe(200);
    expect((await target.client.get('/api/auth/me')).status).toBe(401);
    expect((await login(await anonClient(app), target.user.email, PASSWORD)).status).toBe(401);

    await flushEmails();
    const email = mailer.last(target.user.email)!;
    expect(email.subject).toMatch(/Choose a new password/);
    const c = await anonClient(app);
    const reset = await c.post('/api/auth/reset-password', {
      token: linkToken(email.text),
      password: 'my replacement passphrase',
    });
    expect(reset.status).toBe(200);
    expect((await login(c, target.user.email, 'my replacement passphrase')).status).toBe(200);
    expect(
      await prisma.auditLog.count({
        where: { action: 'admin.user.password_reset', entityId: target.user.id },
      }),
    ).toBe(1);
  });

  it('resets MFA so a staff member must enrol again', async () => {
    const { client } = await admin();
    const target = await staffClient(app, prisma, 'doctor', `Dr ${uniqueName()}`);
    const res = await client.post(`/api/admin/users/${target.user.id}/mfa-reset`);
    expect(res.status).toBe(200);
    expect(res.body.mfaEnabled).toBe(false);
    expect(await prisma.mfaRecoveryCode.count({ where: { userId: target.user.id } })).toBe(0);
    expect((await target.client.get('/api/auth/me')).status).toBe(401);

    const again = await anonClient(app);
    const signedIn = await login(again, target.user.email);
    expect(signedIn.body.user.mfaEnrolmentRequired).toBe(true);
    // The old authenticator's secret is gone, so its codes are useless now.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
    expect(row.mfaSecretEnc).toBeNull();
  });
});

describe('appointment types', () => {
  it('creates, lists (including inactive) and edits types', async () => {
    const { client } = await admin();
    const name = `Type ${uniqueName()}`;
    const created = await client.post('/api/admin/appointment-types', {
      name,
      durationMinutes: '20',
      colour: '#a1b2c3',
      patientBookable: false,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name,
      durationMinutes: 20,
      colour: '#A1B2C3',
      patientBookable: false,
      isActive: true,
    });

    const edited = await client.patch(`/api/admin/appointment-types/${created.body.id}`, {
      isActive: false,
      durationMinutes: 25,
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ isActive: false, durationMinutes: 25 });

    const list = await client.get('/api/admin/appointment-types');
    const mine = list.body.appointmentTypes.find((t: { id: string }) => t.id === created.body.id);
    expect(mine.isActive).toBe(false);
    // Inactive types disappear from the booking list.
    const bookable = await client.get('/api/appointment-types');
    expect(bookable.body.appointmentTypes.map((t: { id: string }) => t.id)).not.toContain(
      created.body.id,
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: created.body.id, action: { startsWith: 'admin.appointment_type.' } },
      }),
    ).toBe(2);
  });

  it('validates and rejects duplicate names', async () => {
    const { client } = await admin();
    const name = `Type ${uniqueName()}`;
    await client.post('/api/admin/appointment-types', {
      name,
      durationMinutes: 15,
      colour: '#000000',
    });
    const dup = await client.post('/api/admin/appointment-types', {
      name,
      durationMinutes: 15,
      colour: '#000000',
    });
    expect(dup.status).toBe(409);
    for (const body of [
      { name: '', durationMinutes: 15, colour: '#000000' },
      { name: 'X', durationMinutes: 2, colour: '#000000' },
      { name: 'X', durationMinutes: 15, colour: 'red' },
    ]) {
      expect((await client.post('/api/admin/appointment-types', body)).status).toBe(400);
    }
    const unknown = '5f0c1f3e-1111-4222-8333-444455556666';
    expect(
      (await client.patch(`/api/admin/appointment-types/${unknown}`, { isActive: false })).status,
    ).toBe(404);
    expect((await client.patch(`/api/admin/appointment-types/${unknown}`, {})).status).toBe(400);
  });
});

describe('settings', () => {
  const restore = async () => {
    await prisma.clinicSetting.upsert({
      where: { key: 'clinicPhone' },
      create: { key: 'clinicPhone', value: DEFAULT_CLINIC_SETTINGS.clinicPhone },
      update: { value: DEFAULT_CLINIC_SETTINGS.clinicPhone },
    });
  };
  afterAll(restore);

  it('reads and partially updates settings, auditing the keys changed', async () => {
    const { client } = await admin();
    const before = await client.get('/api/admin/settings');
    expect(before.status).toBe(200);
    expect(before.body).toHaveProperty('retentionYears');

    const res = await client.put('/api/admin/settings', { clinicPhone: '01632 960999', bogus: 1 });
    expect(res.status).toBe(200);
    expect(res.body.clinicPhone).toBe('01632 960999');
    expect(res.body).not.toHaveProperty('bogus');
    expect(res.body.bookingMaxDaysAhead).toBe(before.body.bookingMaxDaysAhead);
    expect((await (await anonClient(app)).get('/api/clinic')).body.clinicPhone).toBe(
      '01632 960999',
    );

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'admin.settings.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toEqual({ keys: ['clinicPhone'] });
    await restore();
  });

  it('rejects invalid values and empty updates', async () => {
    const { client } = await admin();
    for (const body of [
      { bookingMaxDaysAhead: 0 },
      { theme: 'neon' },
      { retentionYears: 'eight' },
      {},
    ]) {
      const res = await client.put('/api/admin/settings', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe('audit log', () => {
  it('filters by actor, entity, action prefix and date, newest first', async () => {
    const { client, user } = await admin();
    const target = await staffClient(app, prisma, 'receptionist');
    await client.post(`/api/admin/users/${target.user.id}/mfa-reset`);
    await client.patch(`/api/admin/users/${target.user.id}`, { isActive: false });

    const byEntity = await client.get(
      `/api/admin/audit-logs?entity=${target.user.id}&action=admin.`,
    );
    expect(byEntity.status).toBe(200);
    expect(byEntity.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'admin.user.updated',
      'admin.user.mfa_reset',
    ]);
    expect(byEntity.body.entries[0]).toMatchObject({
      actorUserId: user.id,
      actorEmail: user.email,
    });

    const byEmail = await client.get(
      `/api/admin/audit-logs?actor=${encodeURIComponent(user.email)}&action=admin.user.mfa_reset`,
    );
    expect(byEmail.body.entries).toHaveLength(1);

    const unknownActor = await client.get(`/api/admin/audit-logs?actor=${fakeEmail('ghost')}`);
    expect(unknownActor.body.entries).toEqual([]);

    const past = await client.get(
      `/api/admin/audit-logs?entity=${target.user.id}&from=2020-01-01&to=2020-01-31`,
    );
    expect(past.body.entries).toEqual([]);
  });

  it('audits viewing the audit log, recording filter names only', async () => {
    const { client, user } = await admin();
    await client.get('/api/admin/audit-logs?action=auth.');
    const row = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: user.id, action: 'admin.audit_logs.viewed' },
    });
    expect(row.metadata).toEqual({ filters: ['action'], page: 1 });
  });

  it('validates dates', async () => {
    const { client } = await admin();
    expect((await client.get('/api/admin/audit-logs?from=31/01/2026')).status).toBe(400);
    expect((await client.get('/api/admin/audit-logs?from=2026-02-01&to=2026-01-01')).status).toBe(
      400,
    );
  });
});
