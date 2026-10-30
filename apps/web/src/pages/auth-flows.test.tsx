import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiError, currentPath, meFor, mockApi, renderApp } from '../test/mockApi';

const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('route guards (SPEC §10)', () => {
  it('sends signed-out users to /login with a next parameter', async () => {
    mockApi({});
    const { router } = renderApp('/dashboard');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(currentPath(router)).toBe('/login?next=%2Fdashboard');
  });

  it('forces staff without MFA to the enrolment screen', async () => {
    mockApi({
      'GET /api/auth/me': {
        body: meFor('doctor', { mfaEnabled: false, mfaEnrolmentRequired: true }),
      },
      'POST /api/auth/mfa/setup': {
        body: {
          otpauthUri: 'otpauth://totp/x',
          qrCodeDataUrl: 'data:image/png;base64,AA==',
          manualKey: 'JBSWY3DPEHPK3PXP',
        },
      },
    });
    const { router } = renderApp('/schedule');
    await screen.findByRole('heading', { name: 'Set up two-step verification' });
    expect(currentPath(router)).toBe('/mfa/setup');
    expect(screen.getByText(/Staff accounts must use two-step verification/)).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /QR code/ })).toHaveAttribute(
      'src',
      'data:image/png;base64,AA==',
    );
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    // Staff nav stays hidden until enrolled.
    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument();
  });

  it('shows "You don\'t have access" for the wrong role', async () => {
    mockApi({ 'GET /api/auth/me': { body: meFor('patient') } });
    renderApp('/admin/users');
    expect(
      await screen.findByRole('heading', { name: "You don't have access" }),
    ).toBeInTheDocument();
  });

  it('redirects signed-in users away from /login', async () => {
    mockApi({ 'GET /api/auth/me': { body: meFor('receptionist') } });
    const { router } = renderApp('/login');
    await screen.findByRole('heading', { name: 'Front desk' });
    expect(currentPath(router)).toBe('/front-desk');
  });
});

describe('login (SPEC §5.1)', () => {
  it('has correctly labelled, autocomplete-friendly fields and links', async () => {
    mockApi({});
    renderApp('/login');
    const email = await screen.findByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByText('Test Clinic')).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    mockApi({});
    renderApp('/login');
    const pw = await screen.findByLabelText('Password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(pw).toHaveAttribute('type', 'password');
  });

  it('signs in and follows a safe next', async () => {
    const api = mockApi({ 'POST /api/auth/login': { body: meFor('patient') } });
    const { router } = renderApp('/login?next=%2Faccount%2Fsecurity');
    await screen.findByLabelText('Email');
    api.routes['GET /api/auth/sessions'] = { body: { sessions: [] } };
    type('Email', 'Patient@Example.test');
    type('Password', 'a long password here');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Account security' });
    expect(currentPath(router)).toBe('/account/security');
    expect(api.callsTo('POST', '/api/auth/login')[0]!.body).toEqual({
      email: 'patient@example.test',
      password: 'a long password here',
    });
  });

  it('ignores an unsafe next and goes to the role home', async () => {
    mockApi({ 'POST /api/auth/login': { body: meFor('patient') } });
    const { router } = renderApp('/login?next=%2F%2Fevil.example');
    type(await screen.findByLabelText('Email').then(() => 'Email'), 'p@example.test');
    type('Password', 'a long password here');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(currentPath(router)).toBe('/dashboard');
  });

  it('shows the generic error in an alert', async () => {
    mockApi({
      'POST /api/auth/login': apiError(
        401,
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
      ),
    });
    renderApp('/login');
    await screen.findByLabelText('Email');
    type('Email', 'p@example.test');
    type('Password', 'wrong');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('shows the lockout message', async () => {
    mockApi({
      'POST /api/auth/login': apiError(
        423,
        'ACCOUNT_LOCKED',
        'Too many unsuccessful sign-in attempts. Try again later or reset your password.',
      ),
    });
    renderApp('/login');
    await screen.findByLabelText('Email');
    type('Email', 'p@example.test');
    type('Password', 'whatever');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Too many unsuccessful sign-in attempts/,
    );
  });

  it('validates before calling the API', async () => {
    const api = mockApi({});
    renderApp('/login');
    await screen.findByLabelText('Email');
    type('Email', 'not-an-email');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', '/api/auth/login')).toHaveLength(0);
  });
});

describe('MFA step (SPEC §5.2)', () => {
  it('auto-submits on the sixth digit and lands on the home page', async () => {
    const api = mockApi({
      'POST /api/auth/login': { body: { mfaRequired: true } },
      'POST /api/auth/mfa/verify': { body: meFor('patient', { mfaEnabled: true }) },
    });
    const { router } = renderApp('/login');
    await screen.findByLabelText('Email');
    type('Email', 'p@example.test');
    type('Password', 'a long password here');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const code = await screen.findByLabelText('Authentication code');
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    fireEvent.change(code, { target: { value: '12 34 56' } });
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(api.callsTo('POST', '/api/auth/mfa/verify')[0]!.body).toEqual({ code: '123456' });
    expect(currentPath(router)).toBe('/dashboard');
  });

  it('switches to a recovery code', async () => {
    const api = mockApi({ 'POST /api/auth/mfa/verify': { body: meFor('patient') } });
    renderApp('/login/mfa');
    fireEvent.click(await screen.findByRole('button', { name: 'Use a recovery code instead' }));
    type('Recovery code', 'abcde-fgh23');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByRole('heading', { name: 'Welcome' });
    expect(api.callsTo('POST', '/api/auth/mfa/verify')[0]!.body).toEqual({
      recoveryCode: 'abcde-fgh23',
    });
  });

  it('shows the error and clears the code on a wrong code', async () => {
    mockApi({
      'POST /api/auth/mfa/verify': apiError(400, 'INVALID_CREDENTIALS', 'That code is incorrect'),
    });
    renderApp('/login/mfa');
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '000000' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is incorrect');
    expect(screen.getByLabelText('Authentication code')).toHaveValue('');
  });

  it('"Back to sign in" cancels the pending session', async () => {
    const api = mockApi({ 'POST /api/auth/logout': { status: 204 } });
    const { router } = renderApp('/login/mfa');
    fireEvent.click(await screen.findByRole('button', { name: 'Back to sign in' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(api.callsTo('POST', '/api/auth/logout')).toHaveLength(1);
    expect(currentPath(router)).toBe('/login');
  });
});

describe('registration (SPEC §5.3)', () => {
  const fill = () => {
    type('First name', 'Test');
    type('Last name', 'Patient');
    type('Date of birth', '1990-02-03');
    type('Email', 'new@example.test');
    type('Mobile phone', '07700 900123');
    type('Password', 'a long new password');
    type('Confirm password', 'a long new password');
  };

  it('requires matching passwords and accepted terms', async () => {
    const api = mockApi({});
    renderApp('/register');
    await screen.findByLabelText('First name');
    fill();
    type('Confirm password', 'something else');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByText('You must accept the privacy notice and terms')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/auth/register')).toHaveLength(0);
  });

  it('submits and shows the check-your-email confirmation', async () => {
    const api = mockApi({
      'POST /api/auth/register': {
        status: 201,
        body: { message: 'Check your email to confirm your address, then sign in.' },
      },
    });
    renderApp('/register');
    await screen.findByLabelText('First name');
    fill();
    fireEvent.click(screen.getByLabelText(/I have read and accept/));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Check your email' });
    const body = api.callsTo('POST', '/api/auth/register')[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      email: 'new@example.test',
      acceptTerms: true,
      dateOfBirth: '1990-02-03',
    });
    expect(body).not.toHaveProperty('confirmPassword');
  });

  it('puts server password errors on the password field', async () => {
    mockApi({
      'POST /api/auth/register': apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
        {
          path: 'password',
          message: 'This password has appeared in a data breach. Choose a different one',
        },
      ]),
    });
    renderApp('/register');
    await screen.findByLabelText('First name');
    fill();
    fireEvent.click(screen.getByLabelText(/I have read and accept/));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/appeared in a data breach/)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('email and password links', () => {
  it('verifies an email token exactly once, even in StrictMode, and hides it from the URL', async () => {
    const api = mockApi({ 'POST /api/auth/verify-email': { body: { message: 'ok' } } });
    const { router } = renderApp('/verify-email?token=abcdefghijklmnopqrstuvwxyz');
    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/auth/verify-email')).toHaveLength(1);
    expect(currentPath(router)).toBe('/verify-email');
  });

  it('always shows the same forgot-password message', async () => {
    mockApi({ 'POST /api/auth/forgot-password': { body: { message: 'x' } } });
    renderApp('/forgot-password');
    type(await screen.findByLabelText('Email').then(() => 'Email'), 'who@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(
      await screen.findByText("If an account exists, we've emailed you a link"),
    ).toBeInTheDocument();
  });

  it('resets the password with the token from the link', async () => {
    const api = mockApi({ 'POST /api/auth/reset-password': { body: { message: 'ok' } } });
    renderApp('/reset-password?token=tok_abcdefghijklmnop');
    type(
      await screen.findByLabelText('New password').then(() => 'New password'),
      'a fresh long password',
    );
    type('Confirm new password', 'a fresh long password');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByText(/Your password has been changed/);
    expect(api.callsTo('POST', '/api/auth/reset-password')[0]!.body).toEqual({
      token: 'tok_abcdefghijklmnop',
      password: 'a fresh long password',
    });
  });
});

describe('account security (SPEC §5.3)', () => {
  const sessions = {
    sessions: [
      {
        id: 's1',
        ip: '10.0.0.1',
        userAgent: 'Firefox',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        current: true,
      },
      {
        id: 's2',
        ip: '10.0.0.2',
        userAgent: 'Safari',
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        current: false,
      },
    ],
  };

  it('lists sessions and revokes another device', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('patient', { mfaEnabled: true }) },
      'GET /api/auth/sessions': { body: sessions },
      'DELETE /api/auth/sessions/s2': { status: 204 },
    });
    renderApp('/account/security');
    const list = await screen.findByText('Safari');
    expect(screen.getByText('This device')).toBeInTheDocument();
    const row = list.closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: /Sign out/ }));
    await waitFor(() => expect(api.callsTo('DELETE', '/api/auth/sessions/s2')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('does not offer staff a way to turn MFA off', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      'GET /api/auth/sessions': { body: sessions },
    });
    renderApp('/account/security');
    await screen.findByText(/required for staff accounts/);
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
  });

  it('signs out everywhere, clears cached data and returns to login', async () => {
    let signedIn = true;
    const api = mockApi({
      'GET /api/auth/me': () =>
        signedIn ? { body: meFor('patient') } : apiError(401, 'UNAUTHENTICATED'),
      'GET /api/auth/sessions': { body: sessions },
      'POST /api/auth/logout-all': () => {
        signedIn = false;
        return { status: 204 };
      },
    });
    const { router, queryClient } = renderApp('/account/security');
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out of all devices' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(api.callsTo('POST', '/api/auth/logout-all')).toHaveLength(1);
    expect(currentPath(router)).toBe('/login');
    expect(queryClient.getQueryData(['auth', 'sessions'])).toBeUndefined();
  });
});

describe('global 401 handling', () => {
  it('redirects to login when an authenticated request returns 401', async () => {
    let signedIn = true;
    mockApi({
      'GET /api/auth/me': () =>
        signedIn ? { body: meFor('patient') } : apiError(401, 'UNAUTHENTICATED'),
      'GET /api/auth/sessions': () => {
        signedIn = false; // e.g. the session was revoked from another device
        return apiError(401, 'UNAUTHENTICATED');
      },
    });
    const { router } = renderApp('/account/security');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(currentPath(router)).toBe('/login?next=%2Faccount%2Fsecurity&reason=expired');
    expect(screen.getByText('Your session has ended. Please sign in again.')).toBeInTheDocument();
  });
});

describe('inactivity timeout (SPEC §10)', () => {
  it('warns 2 minutes before the timeout, can extend, and signs out after', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let signedIn = true;
    const api = mockApi({
      'GET /api/auth/me': () =>
        signedIn ? { body: meFor('doctor') } : apiError(401, 'UNAUTHENTICATED'),
      'POST /api/auth/logout': () => {
        signedIn = false;
        return { status: 204 };
      },
    });
    const { router } = renderApp('/schedule');
    await screen.findByRole('heading', { name: 'Schedule' });

    // Staff idle = 30 min; we sign out 1 min early, warning 2 min before that.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(26 * 60_000);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    const dialog = await screen.findByRole('dialog', { name: 'Are you still there?' });
    expect(within(dialog).getByRole('button', { name: 'Stay signed in' })).toHaveFocus();

    const before = api.callsTo('GET', '/api/auth/me').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay signed in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.callsTo('GET', '/api/auth/me').length).toBe(before + 1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29 * 60_000 + 1000);
    });
    await waitFor(() => expect(currentPath(router)).toBe('/login?reason=timeout'), {
      timeout: 3000,
    });
    expect(
      await screen.findByText('You were signed out because of inactivity.'),
    ).toBeInTheDocument();
    // The server session is ended too, not just local state.
    expect(api.callsTo('POST', '/api/auth/logout')).toHaveLength(1);
  });
});
