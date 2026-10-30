import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AvailabilityResponse } from '@clinic/shared';
import { apiError, currentPath, meFor, mockApi, renderApp } from '../test/mockApi';

const DOC = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const availability = (overrides: Partial<AvailabilityResponse> = {}): AvailabilityResponse => ({
  doctorId: DOC,
  timezone: 'Europe/London',
  rules: [
    {
      id: 'r1',
      weekday: 1,
      startTime: '09:00',
      endTime: '12:00',
      validFrom: '2026-10-30',
      validTo: null,
    },
  ],
  exceptions: [
    {
      id: 'e1',
      type: 'unavailable',
      reason: 'Holiday',
      startsAt: '2026-12-21T00:00:00.000Z',
      endsAt: '2026-12-24T00:00:00.000Z',
      startsAtLocal: '2026-12-21T00:00',
      endsAtLocal: '2026-12-24T00:00',
    },
  ],
  ...overrides,
});

const doctorRoutes = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  'GET /api/auth/me': { body: meFor('doctor') },
  'GET /api/doctors/me': {
    body: { id: DOC, displayName: 'Dr Test', specialty: null, bio: null, isBookable: true },
  },
  [`GET /api/doctors/${DOC}/availability`]: { body: availability() },
  ...extra,
});

const day = (name: string) => screen.getByRole('group', { name });

describe('availability page (doctor)', () => {
  it('shows weekly hours and upcoming exceptions in clinic time', async () => {
    mockApi(doctorRoutes());
    renderApp('/availability');
    expect(await screen.findByLabelText('Monday hours 1 from')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday hours 1 until')).toHaveValue('12:00');
    expect(within(day('Tuesday')).getByText('Not working')).toBeInTheDocument();
    expect(screen.getByText(/clinic time \(Europe\/London\)/)).toBeInTheDocument();
    expect(screen.getByText('Mon 21 Dec 2026 – Wed 23 Dec 2026 (all day)')).toBeInTheDocument();
    expect(screen.getByText('Holiday')).toBeInTheDocument();
  });

  it('adds hours to a day and saves the whole week', async () => {
    const api = mockApi(
      doctorRoutes({
        [`PUT /api/doctors/${DOC}/availability`]: (body) => ({
          body: availability({ rules: [], ...(body as object) } as Partial<AvailabilityResponse>),
        }),
      }),
    );
    renderApp('/availability');
    await screen.findByLabelText('Monday hours 1 from');
    fireEvent.click(screen.getByRole('button', { name: 'Add hours on Tuesday' }));
    expect(screen.getByLabelText('Tuesday hours 1 from')).toHaveValue('09:00');
    fireEvent.change(screen.getByLabelText('Tuesday hours 1 until'), {
      target: { value: '13:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }));
    expect(await screen.findByText(/Weekly hours saved/)).toBeInTheDocument();
    expect(api.callsTo('PUT', `/api/doctors/${DOC}/availability`)[0]!.body).toEqual({
      rules: [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 2, startTime: '09:00', endTime: '13:30' },
      ],
    });
  });

  it('catches overlapping hours before sending', async () => {
    const api = mockApi(doctorRoutes());
    renderApp('/availability');
    await screen.findByLabelText('Monday hours 1 from');
    fireEvent.click(screen.getByRole('button', { name: 'Add hours on Monday' }));
    // The new block starts an hour after the last one ends; pull it back into an overlap.
    expect(screen.getByLabelText('Monday hours 2 from')).toHaveValue('13:00');
    fireEvent.change(screen.getByLabelText('Monday hours 2 from'), { target: { value: '11:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }));
    expect(await screen.findByText('Overlaps other hours on the same day')).toBeInTheDocument();
    expect(screen.getByLabelText('Monday hours 2 from')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('PUT', `/api/doctors/${DOC}/availability`)).toHaveLength(0);
  });

  it("copies Monday's hours to the other weekdays", async () => {
    const api = mockApi(
      doctorRoutes({ [`PUT /api/doctors/${DOC}/availability`]: { body: availability() } }),
    );
    renderApp('/availability');
    await screen.findByLabelText('Monday hours 1 from');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Monday to Tuesday–Friday' }));
    expect(screen.getByLabelText('Friday hours 1 until')).toHaveValue('12:00');
    expect(within(day('Saturday')).getByText('Not working')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }));
    await screen.findByText(/Weekly hours saved/);
    const sent = api.callsTo('PUT', `/api/doctors/${DOC}/availability`)[0]!.body as {
      rules: { weekday: number }[];
    };
    expect(sent.rules.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it('removes a block', async () => {
    mockApi(doctorRoutes());
    renderApp('/availability');
    await screen.findByLabelText('Monday hours 1 from');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Monday hours 1' }));
    expect(within(day('Monday')).getByText('Not working')).toBeInTheDocument();
  });

  it('adds whole days off as local midnight to the midnight after the last day', async () => {
    let current = availability({ exceptions: [] });
    const api = mockApi(
      doctorRoutes({
        [`GET /api/doctors/${DOC}/availability`]: () => ({ body: current }),
        [`POST /api/doctors/${DOC}/exceptions`]: () => {
          current = availability();
          return { status: 201, body: current.exceptions[0] };
        },
      }),
    );
    renderApp('/availability');
    expect(await screen.findByText('No upcoming time off or extra sessions.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('First day'), { target: { value: '2026-12-21' } });
    fireEvent.change(screen.getByLabelText(/Last day/), { target: { value: '2026-12-23' } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'Holiday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Time off added.')).toBeInTheDocument();
    expect(api.callsTo('POST', `/api/doctors/${DOC}/exceptions`)[0]!.body).toEqual({
      type: 'unavailable',
      startsAt: '2026-12-21T00:00',
      endsAt: '2026-12-24T00:00',
      reason: 'Holiday',
    });
    expect(
      await screen.findByText('Mon 21 Dec 2026 – Wed 23 Dec 2026 (all day)'),
    ).toBeInTheDocument();
  });

  it('treats a blank last day as a single day', async () => {
    const api = mockApi(
      doctorRoutes({
        [`POST /api/doctors/${DOC}/exceptions`]: {
          status: 201,
          body: availability().exceptions[0],
        },
      }),
    );
    renderApp('/availability');
    fireEvent.change(await screen.findByLabelText('First day'), {
      target: { value: '2026-12-25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByText('Time off added.');
    expect(api.callsTo('POST', `/api/doctors/${DOC}/exceptions`)[0]!.body).toMatchObject({
      startsAt: '2026-12-25T00:00',
      endsAt: '2026-12-26T00:00',
      reason: null,
    });
  });

  it('validates timed sessions before sending, and shows server errors on the field', async () => {
    const api = mockApi(
      doctorRoutes({
        [`POST /api/doctors/${DOC}/exceptions`]: apiError(400, 'VALIDATION_ERROR', 'Invalid', [
          { path: 'endsAt', message: 'This time has already passed' },
        ]),
      }),
    );
    renderApp('/availability');
    fireEvent.click(await screen.findByLabelText('Whole days'));
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'extra' } });
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-12-01T18:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-12-01T17:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('End must be after the start')).toBeInTheDocument();
    expect(api.callsTo('POST', `/api/doctors/${DOC}/exceptions`)).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-12-01T20:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('This time has already passed')).toBeInTheDocument();
    expect(screen.getByLabelText('Ends')).toHaveAttribute('aria-invalid', 'true');
  });

  it('deletes an exception', async () => {
    const api = mockApi(
      doctorRoutes({ [`DELETE /api/doctors/${DOC}/exceptions/e1`]: { status: 204 } }),
    );
    renderApp('/availability');
    fireEvent.click(await screen.findByRole('button', { name: /Delete time off/ }));
    await waitFor(() =>
      expect(api.callsTo('DELETE', `/api/doctors/${DOC}/exceptions/e1`)).toHaveLength(1),
    );
  });

  it('explains when the account has no doctor profile', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      'GET /api/doctors/me': apiError(404, 'NOT_FOUND', 'No doctor profile'),
    });
    renderApp('/availability');
    expect(await screen.findByText(/has no doctor profile/)).toBeInTheDocument();
  });
});

describe('availability page (admin)', () => {
  it('chooses a doctor and edits their schedule', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('admin') },
      'GET /api/doctors': {
        body: {
          doctors: [
            {
              id: DOC,
              displayName: 'Dr Alex Example',
              specialty: null,
              bio: null,
              isBookable: true,
            },
            {
              id: OTHER,
              displayName: 'Dr Sam Sample',
              specialty: null,
              bio: null,
              isBookable: true,
            },
          ],
        },
      },
      [`GET /api/doctors/${DOC}/availability`]: { body: availability() },
      [`GET /api/doctors/${OTHER}/availability`]: {
        body: availability({ doctorId: OTHER, rules: [], exceptions: [] }),
      },
    });
    const { router } = renderApp('/availability');
    expect(await screen.findByLabelText('Monday hours 1 from')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Doctor'), { target: { value: OTHER } });
    await waitFor(() => expect(currentPath(router)).toBe(`/availability?doctor=${OTHER}`));
    const monday = await screen.findByRole('group', { name: 'Monday' });
    expect(await within(monday).findByText('Not working')).toBeInTheDocument();
  });

  it('is not available to reception or patients', async () => {
    mockApi({ 'GET /api/auth/me': { body: meFor('receptionist') } });
    renderApp('/availability');
    expect(
      await screen.findByRole('heading', { name: "You don't have access" }),
    ).toBeInTheDocument();
  });
});
