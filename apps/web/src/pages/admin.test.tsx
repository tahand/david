import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_CLINIC_SETTINGS, type AdminUserDto } from '@clinic/shared';
import { apiError, currentPath, meFor, mockApi, renderApp } from '../test/mockApi';

const ADMIN_ID = meFor('admin').user.id;

const adminUser = (overrides: Partial<AdminUserDto> = {}): AdminUserDto => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'reception@example.test',
  role: 'receptionist',
  isActive: true,
  emailVerified: true,
  mfaEnabled: true,
  invitePending: false,
  lockedUntil: null,
  lastLoginAt: '2026-10-30T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
  doctor: null,
  ...overrides,
});

const asAdmin = (table: Parameters<typeof mockApi>[0]) =>
  mockApi({ 'GET /api/auth/me': { body: meFor('admin') }, ...table });

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('admin access', () => {
  it.each(['/admin/users', '/admin/settings', '/admin/audit-logs', '/admin/appointment-types'])(
    '%s is admin-only',
    async (path) => {
      mockApi({ 'GET /api/auth/me': { body: meFor('receptionist') } });
      renderApp(path);
      expect(
        await screen.findByRole('heading', { name: "You don't have access" }),
      ).toBeInTheDocument();
    },
  );

  it('shows the admin navigation', async () => {
    asAdmin({ 'GET /api/admin/users': { body: { users: [], hasMore: false } } });
    renderApp('/admin/users');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    for (const label of ['Users', 'Appointment types', 'Settings', 'Audit log']) {
      expect(await within(nav).findByRole('link', { name: label })).toBeInTheDocument();
    }
  });
});

describe('users', () => {
  it('lists users with status badges and filters through the URL', async () => {
    const api = asAdmin({
      'GET /api/admin/users': {
        body: {
          users: [
            adminUser(),
            adminUser({
              id: '2',
              email: 'new@example.test',
              invitePending: true,
              mfaEnabled: false,
              lastLoginAt: null,
            }),
            adminUser({ id: '3', email: 'gone@example.test', isActive: false }),
          ],
          hasMore: false,
        },
      },
      'GET /api/admin/users?q=dr&role=doctor': { body: { users: [], hasMore: false } },
    });
    const { router } = renderApp('/admin/users');
    expect(await screen.findByRole('link', { name: 'reception@example.test' })).toHaveAttribute(
      'href',
      '/admin/users/11111111-1111-4111-8111-111111111111',
    );
    const list = screen.getByRole('list', { name: 'Users, page 1' });
    expect(within(list).getByText('Invite pending')).toBeInTheDocument();
    expect(within(list).getByText('Deactivated')).toBeInTheDocument();

    type('Search', 'dr');
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'doctor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No users match these filters.')).toBeInTheDocument();
    expect(currentPath(router)).toBe('/admin/users?q=dr&role=doctor');
    expect(api.callsTo('GET', '/api/admin/users?q=dr&role=doctor')).toHaveLength(1);
  });

  it('creates a doctor, requiring the patient-facing name', async () => {
    const created = adminUser({
      id: '44444444-4444-4444-8444-444444444444',
      email: 'dr.new@example.test',
      role: 'doctor',
      invitePending: true,
      mfaEnabled: false,
      doctor: {
        id: 'd',
        displayName: 'Dr New',
        specialty: null,
        registrationNumber: null,
        bio: null,
        isBookable: true,
      },
    });
    const api = asAdmin({
      'POST /api/admin/users': { status: 201, body: created },
      [`GET /api/admin/users/${created.id}`]: { body: created },
    });
    const { router } = renderApp('/admin/users/new');
    type(
      await screen.findByLabelText('Work email').then(() => 'Work email'),
      'dr.new@example.test',
    );
    expect(screen.queryByLabelText('Name shown to patients')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'doctor' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create account and send invitation' }),
    );
    expect(await screen.findByText('Enter the name patients will see')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/admin/users')).toHaveLength(0);

    type('Name shown to patients', 'Dr New');
    fireEvent.click(screen.getByRole('button', { name: 'Create account and send invitation' }));
    expect(
      await screen.findByText('Account created. An invitation has been emailed.'),
    ).toBeInTheDocument();
    expect(currentPath(router)).toBe(`/admin/users/${created.id}`);
    expect(api.callsTo('POST', '/api/admin/users')[0]!.body).toMatchObject({
      email: 'dr.new@example.test',
      role: 'doctor',
      doctor: { displayName: 'Dr New', isBookable: true },
    });
  });

  it('does not send a doctor profile for other roles', async () => {
    const created = adminUser({ id: '55555555-5555-4555-8555-555555555555' });
    const api = asAdmin({
      'POST /api/admin/users': { status: 201, body: created },
      [`GET /api/admin/users/${created.id}`]: { body: created },
    });
    renderApp('/admin/users/new');
    type(await screen.findByLabelText('Work email').then(() => 'Work email'), 'r@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Create account and send invitation' }));
    await waitFor(() => expect(api.callsTo('POST', '/api/admin/users')).toHaveLength(1));
    expect(api.callsTo('POST', '/api/admin/users')[0]!.body).toEqual({
      email: 'r@example.test',
      role: 'receptionist',
    });
  });

  it('shows a duplicate-email error from the server', async () => {
    asAdmin({
      'POST /api/admin/users': apiError(
        409,
        'CONFLICT',
        'A user with this email address already exists',
      ),
    });
    renderApp('/admin/users/new');
    type(await screen.findByLabelText('Work email').then(() => 'Work email'), 'dup@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Create account and send invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('deactivates an account after confirmation', async () => {
    const u = adminUser();
    const api = asAdmin({
      [`GET /api/admin/users/${u.id}`]: { body: u },
      [`PATCH /api/admin/users/${u.id}`]: { body: { ...u, isActive: false } },
    });
    renderApp(`/admin/users/${u.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate this account?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Account deactivated.')).toBeInTheDocument();
    expect(api.callsTo('PATCH', `/api/admin/users/${u.id}`)[0]!.body).toEqual({ isActive: false });
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('keeps the dialog open with the server message when an action is refused', async () => {
    const u = adminUser({
      role: 'doctor',
      doctor: {
        id: 'd',
        displayName: 'Dr Busy',
        specialty: null,
        registrationNumber: null,
        bio: null,
        isBookable: true,
      },
    });
    asAdmin({
      [`GET /api/admin/users/${u.id}`]: { body: u },
      [`PATCH /api/admin/users/${u.id}`]: apiError(
        409,
        'CONFLICT',
        'This doctor has 2 upcoming appointments. Move or cancel them first.',
      ),
    });
    renderApp(`/admin/users/${u.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('2 upcoming appointments');
  });

  it('resets a password and two-step verification', async () => {
    const u = adminUser();
    const api = asAdmin({
      [`GET /api/admin/users/${u.id}`]: { body: u },
      [`POST /api/admin/users/${u.id}/password-reset`]: { body: u },
      [`POST /api/admin/users/${u.id}/mfa-reset`]: { body: { ...u, mfaEnabled: false } },
    });
    renderApp(`/admin/users/${u.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }),
    );
    expect(
      await screen.findByText(/A link has been emailed to reception@example.test/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset two-step verification' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset' }),
    );
    expect(await screen.findByText('Two-step verification reset.')).toBeInTheDocument();
    expect(api.callsTo('POST', `/api/admin/users/${u.id}/mfa-reset`)).toHaveLength(1);
    // Nothing left to reset.
    expect(
      screen.queryByRole('button', { name: 'Reset two-step verification' }),
    ).not.toBeInTheDocument();
  });

  it('changes a role and explains the sign-out', async () => {
    const u = adminUser();
    const api = asAdmin({
      [`GET /api/admin/users/${u.id}`]: { body: u },
      [`PATCH /api/admin/users/${u.id}`]: { body: { ...u, role: 'admin' } },
    });
    renderApp(`/admin/users/${u.id}`);
    fireEvent.change(await screen.findByLabelText('Role'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(/has been signed out so the new role takes effect/),
    ).toBeInTheDocument();
    expect(api.callsTo('PATCH', `/api/admin/users/${u.id}`)[0]!.body).toEqual({ role: 'admin' });
  });

  it("hides role and account actions on the admin's own account", async () => {
    const self = adminUser({ id: ADMIN_ID, email: 'admin@example.test', role: 'admin' });
    asAdmin({ [`GET /api/admin/users/${ADMIN_ID}`]: { body: self } });
    renderApp(`/admin/users/${ADMIN_ID}`);
    expect(await screen.findByText(/You can't change your own role/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account security' })).toBeInTheDocument();
  });

  it('shows not-found for an unknown account', async () => {
    asAdmin({ 'GET /api/admin/users/nope': apiError(404, 'NOT_FOUND') });
    renderApp('/admin/users/nope');
    expect(await screen.findByText('This account does not exist.')).toBeInTheDocument();
  });
});

describe('appointment types', () => {
  const types = [
    {
      id: 't1',
      name: 'Standard consultation',
      durationMinutes: 15,
      colour: '#2563EB',
      patientBookable: true,
      isActive: true,
    },
    {
      id: 't2',
      name: 'Old clinic',
      durationMinutes: 30,
      colour: '#7C3AED',
      patientBookable: false,
      isActive: false,
    },
  ];

  it('lists types, edits one, and validates new ones', async () => {
    const api = asAdmin({
      'GET /api/admin/appointment-types': { body: { appointmentTypes: types } },
      'PATCH /api/admin/appointment-types/t1': { body: { ...types[0], durationMinutes: 20 } },
      'POST /api/admin/appointment-types': { status: 201, body: types[0] },
    });
    renderApp('/admin/appointment-types');
    const list = await screen.findByRole('list', { name: 'Appointment types' });
    expect(within(list).getAllByText('Standard consultation')[0]).toBeInTheDocument();
    expect(screen.getByText(/Staff booking only · Retired/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Standard consultation' }));
    fireEvent.change(within(list).getByLabelText('Length (minutes)'), { target: { value: '20' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved "Standard consultation".')).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/api/admin/appointment-types/t1')[0]!.body).toMatchObject({
      durationMinutes: 20,
      colour: '#2563EB',
    });

    const add = screen
      .getByRole('heading', { name: 'Add an appointment type' })
      .closest('section')!;
    fireEvent.change(within(add).getByLabelText('Name'), { target: { value: 'Travel advice' } });
    fireEvent.change(within(add).getByLabelText('Colour'), { target: { value: 'blue' } });
    fireEvent.click(within(add).getByRole('button', { name: 'Add appointment type' }));
    expect(await within(add).findByText('Use a colour like #2563EB')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/admin/appointment-types')).toHaveLength(0);
  });
});

describe('settings', () => {
  it('sends only the settings that changed', async () => {
    const api = asAdmin({
      'GET /api/admin/settings': { body: DEFAULT_CLINIC_SETTINGS },
      'PUT /api/admin/settings': (body) => ({
        body: { ...DEFAULT_CLINIC_SETTINGS, ...(body as object) },
      }),
    });
    renderApp('/admin/settings');
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: '01632 960555' } });
    fireEvent.change(screen.getByLabelText(/Latest booking/), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(api.callsTo('PUT', '/api/admin/settings')[0]!.body).toEqual({
      clinicPhone: '01632 960555',
      bookingMaxDaysAhead: 90,
    });
    // Public clinic info (branding, theme) is refreshed.
    await waitFor(() => expect(api.callsTo('GET', '/api/clinic').length).toBeGreaterThan(1));
  });

  it('validates numbers before saving', async () => {
    const api = asAdmin({ 'GET /api/admin/settings': { body: DEFAULT_CLINIC_SETTINGS } });
    renderApp('/admin/settings');
    fireEvent.change(await screen.findByLabelText(/Keep deleted records/), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Keep deleted records/)).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(api.callsTo('PUT', '/api/admin/settings')).toHaveLength(0);
  });
});

describe('audit log', () => {
  const entry = {
    id: 'a1',
    createdAt: '2026-10-30T10:00:00.000Z',
    action: 'admin.user.mfa_reset',
    actorUserId: ADMIN_ID,
    actorEmail: 'admin@example.test',
    entityType: 'user',
    entityId: '11111111-1111-4111-8111-111111111111',
    ip: '10.0.0.1',
    userAgent: 'Firefox',
    metadata: { changes: ['isActive'] },
  };

  it('shows entries and filters through the URL', async () => {
    const api = asAdmin({
      'GET /api/admin/audit-logs': { body: { entries: [entry], hasMore: true } },
      'GET /api/admin/audit-logs?action=auth.&from=2026-10-01': {
        body: { entries: [], hasMore: false },
      },
    });
    const { router } = renderApp('/admin/audit-logs');
    expect(await screen.findByText('admin.user.mfa_reset')).toBeInTheDocument();
    const entries = screen.getByRole('list', { name: 'Audit entries, page 1' });
    expect(within(entries).getByText('admin@example.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /user 11111111/ })).toHaveAttribute(
      'href',
      '/admin/users/11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByRole('button', { name: 'Older' })).toBeEnabled();

    type('Action', 'auth.');
    type('From', '2026-10-01');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();
    expect(currentPath(router)).toBe('/admin/audit-logs?action=auth.&from=2026-10-01');
    expect(api.callsTo('GET', '/api/admin/audit-logs?action=auth.&from=2026-10-01')).toHaveLength(
      1,
    );
  });

  it("shows the server's validation message", async () => {
    asAdmin({
      'GET /api/admin/audit-logs?from=2026-02-01&to=2026-01-01': apiError(
        400,
        'VALIDATION_ERROR',
        'Invalid request',
        [{ path: 'to', message: 'The end date must be on or after the start date' }],
      ),
    });
    renderApp('/admin/audit-logs?from=2026-02-01&to=2026-01-01');
    expect(
      await screen.findByText('The end date must be on or after the start date'),
    ).toBeInTheDocument();
  });
});
