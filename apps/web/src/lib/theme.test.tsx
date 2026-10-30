import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, renderApp } from '../test/mockApi';

const clinic = (theme: string) => ({
  body: {
    clinicName: 'Test Clinic',
    clinicPhone: '01632 960000',
    clinicAddress: '1 Test St',
    consentVersion: 'v-test',
    healthIdLabel: 'NHS number',
    timezone: 'Europe/London',
    theme,
  },
});

const currentTheme = () => document.documentElement.dataset.theme;

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('clinic theme', () => {
  it("applies the clinic's theme to <html>", async () => {
    mockApi({ 'GET /api/clinic': clinic('serene-and-professional') });
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() => expect(currentTheme()).toBe('serene-and-professional'));
  });

  it('defaults to Trust & Calm', async () => {
    mockApi({});
    renderApp('/login');
    await waitFor(() => expect(currentTheme()).toBe('trust-and-calm'));
  });

  it('previews another theme with ?theme=', async () => {
    mockApi({ 'GET /api/clinic': clinic('trust-and-calm') });
    renderApp('/login?theme=warm-and-compassionate');
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() => expect(currentTheme()).toBe('warm-and-compassionate'));
  });

  it('ignores unknown theme names', async () => {
    mockApi({ 'GET /api/clinic': clinic('natural-and-healing') });
    renderApp('/login?theme=neon');
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() => expect(currentTheme()).toBe('natural-and-healing'));
  });
});
