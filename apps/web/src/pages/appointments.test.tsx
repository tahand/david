import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type {
  AppointmentDetail,
  AppointmentDto,
  AppointmentListResponse,
  DoctorProfile,
  Slot,
} from '@clinic/shared';
import { addCalendarDays, clinicToday } from '../lib/format';
import { patientRecord } from '../test/fixtures';
import { apiError, currentPath, meFor, mockApi, renderApp } from '../test/mockApi';

const TZ = 'Europe/London';
const TODAY = clinicToday(TZ);
const WEEK_END = addCalendarDays(TODAY, 6);
const SOON = addCalendarDays(TODAY, 3);

const TYPE = '11111111-1111-4111-8111-111111111111';
const DOC_A = '22222222-2222-4222-8222-222222222222';
const DOC_B = '33333333-3333-4333-8333-333333333333';
const PATIENT = '44444444-4444-4444-8444-444444444444';
const APPT = '55555555-5555-4555-8555-555555555555';

const doctor = (id: string, displayName: string): DoctorProfile => ({
  id,
  displayName,
  specialty: null,
  bio: null,
  isBookable: true,
});
const DOCTORS = [doctor(DOC_A, 'Dr Able'), doctor(DOC_B, 'Dr Baker')];
const TYPES = [
  {
    id: TYPE,
    name: 'Standard consultation',
    durationMinutes: 15,
    colour: '#2563eb',
    patientBookable: true,
  },
];

const slot = (date: string, time: string): Slot => ({
  startsAt: `${date}T${time}:00.000Z`,
  endsAt: `${date}T${time}:15.000Z`,
  date,
  time,
});
const slotsPath = (doctorId: string, from = TODAY, to = WEEK_END) =>
  `GET /api/doctors/${doctorId}/slots?${new URLSearchParams({ from, to, typeId: TYPE })}`;

const appointment = (overrides: Partial<AppointmentDto> = {}): AppointmentDto => ({
  id: APPT,
  status: 'booked',
  startsAt: `${SOON}T09:00:00.000Z`,
  endsAt: `${SOON}T09:15:00.000Z`,
  startsAtLocal: `${SOON}T09:00`,
  endsAtLocal: `${SOON}T09:15`,
  doctor: { id: DOC_A, displayName: 'Dr Able' },
  appointmentType: {
    id: TYPE,
    name: 'Standard consultation',
    durationMinutes: 15,
    colour: '#2563eb',
  },
  patient: {
    id: PATIENT,
    firstName: 'Pat',
    lastName: 'Example',
    preferredName: null,
    dateOfBirth: '1990-02-03',
  },
  cancelledReason: null,
  canChange: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});
const listOf = (...appointments: AppointmentDto[]): { body: AppointmentListResponse } => ({
  body: { appointments, timezone: TZ, changeCutoffHours: 24 },
});

const patientRoutes = (extra: Parameters<typeof mockApi>[0] = {}) => ({
  'GET /api/auth/me': { body: meFor('patient') },
  'GET /api/appointment-types': { body: { appointmentTypes: TYPES } },
  'GET /api/doctors': { body: { doctors: DOCTORS } },
  ...extra,
});

async function chooseAnyDoctorAndSlot(time: string, doctorName: string) {
  fireEvent.click(await screen.findByLabelText(/Standard consultation/));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(await screen.findByLabelText(/Any doctor/));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(`^${time} · ${doctorName}`) }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('booking wizard', () => {
  it('books the first free slot with any doctor', async () => {
    const api = mockApi(
      patientRoutes({
        [slotsPath(DOC_A)]: { body: { slots: [slot(SOON, '10:00')] } },
        [slotsPath(DOC_B)]: { body: { slots: [slot(SOON, '09:00')] } },
        'POST /api/appointments': { status: 201, body: appointment() },
        'GET /api/appointments': listOf(appointment()),
      }),
    );
    const { router } = renderApp('/book');
    await chooseAnyDoctorAndSlot('09:00', 'Dr Baker');

    expect(await screen.findByText('Dr Baker')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason for visit (optional)'), {
      target: { value: 'Check-up' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Book appointment' }));

    await waitFor(() => expect(currentPath(router)).toBe('/appointments'));
    expect(api.callsTo('POST', '/api/appointments')[0]!.body).toEqual({
      doctorId: DOC_B,
      appointmentTypeId: TYPE,
      startsAt: `${SOON}T09:00:00.000Z`,
      reasonForVisit: 'Check-up',
    });
    expect(await screen.findByText('Your appointment is booked.')).toBeInTheDocument();
  });

  it('returns to the times with a message when the slot was just taken', async () => {
    let slotCalls = 0;
    const api = mockApi(
      patientRoutes({
        [slotsPath(DOC_A)]: () => {
          slotCalls += 1;
          return { body: { slots: slotCalls === 1 ? [slot(SOON, '09:00')] : [] } };
        },
        [slotsPath(DOC_B)]: { body: { slots: [] } },
        'POST /api/appointments': apiError(
          409,
          'SLOT_UNAVAILABLE',
          'That time is no longer available. Please choose another time.',
        ),
      }),
    );
    renderApp('/book');
    await chooseAnyDoctorAndSlot('09:00', 'Dr Able');
    fireEvent.click(await screen.findByRole('button', { name: 'Book appointment' }));

    expect(await screen.findByText(/no longer available/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Date and time' })).toBeInTheDocument();
    expect(await screen.findByText(/No times are available this week/)).toBeInTheDocument();
    expect(api.callsTo('GET', slotsPath(DOC_A).slice(4)).length).toBeGreaterThan(1);
  });

  it('asks unverified patients to confirm their email first', async () => {
    mockApi(
      patientRoutes({ 'GET /api/auth/me': { body: meFor('patient', { emailVerified: false }) } }),
    );
    renderApp('/book');
    expect(await screen.findByText('Confirm your email address first')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('lets reception book for the patient named in the URL', async () => {
    const api = mockApi({
      ...patientRoutes({
        'GET /api/auth/me': { body: meFor('receptionist') },
        [slotsPath(DOC_A)]: { body: { slots: [slot(SOON, '11:00')] } },
        'POST /api/appointments': { status: 201, body: appointment() },
      }),
      [`GET /api/patients/${PATIENT}`]: {
        body: patientRecord({ id: PATIENT, lastName: 'Example' }),
      },
      [`GET /api/appointments?patientId=${PATIENT}`]: listOf(appointment()),
    });
    const { router } = renderApp(`/book?patient=${PATIENT}`);
    expect(await screen.findByText('Pat Example')).toBeInTheDocument();
    fireEvent.click(await screen.findByLabelText(/Standard consultation/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByLabelText(/Dr Able/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: /^11:00/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Book appointment' }));

    await waitFor(() => expect(currentPath(router)).toBe(`/patients/${PATIENT}`));
    expect(api.callsTo('POST', '/api/appointments')[0]!.body).toMatchObject({
      patientId: PATIENT,
      doctorId: DOC_A,
    });
    expect(await screen.findByText('Appointment booked.')).toBeInTheDocument();
    expect(await screen.findByText('Standard consultation with Dr Able')).toBeInTheDocument();
  });

  it('offers booking from the patient record to reception but not doctors', async () => {
    const routes = {
      [`GET /api/patients/${PATIENT}`]: { body: patientRecord({ id: PATIENT }) },
      [`GET /api/appointments?patientId=${PATIENT}`]: listOf(appointment()),
    };
    mockApi({ 'GET /api/auth/me': { body: meFor('receptionist') }, ...routes });
    const reception = renderApp(`/patients/${PATIENT}`);
    expect(await screen.findByRole('link', { name: 'Book appointment' })).toHaveAttribute(
      'href',
      `/book?patient=${PATIENT}`,
    );
    reception.unmount();

    mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      ...routes,
      [`GET /api/appointments?patientId=${PATIENT}`]: listOf(appointment({ canChange: false })),
    });
    renderApp(`/patients/${PATIENT}`);
    expect(
      await screen.findByRole('heading', { name: 'Appointments with you' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Book appointment' })).not.toBeInTheDocument();
    expect(await screen.findByText('Standard consultation with Dr Able')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Reschedule/ })).not.toBeInTheDocument();
  });
});

describe('patient appointments', () => {
  it('lists upcoming appointments and cancels one', async () => {
    const locked = appointment({
      id: '66666666-6666-4666-8666-666666666666',
      canChange: false,
      startsAtLocal: `${TODAY}T23:00`,
      endsAtLocal: `${TODAY}T23:15`,
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      endsAt: new Date(Date.now() + 4500_000).toISOString(),
    });
    const api = mockApi(
      patientRoutes({
        'GET /api/appointments': listOf(locked, appointment()),
        [`PATCH /api/appointments/${APPT}/cancel`]: {
          body: appointment({ status: 'cancelled_by_patient', canChange: false }),
        },
      }),
    );
    renderApp('/appointments');
    expect(await screen.findByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByText(/need a phone call to 01632 960000/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Reschedule/ })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^Cancel\b/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel appointment' });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Away' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));

    await waitFor(() =>
      expect(api.callsTo('PATCH', `/api/appointments/${APPT}/cancel`)[0]!.body).toEqual({
        reason: 'Away',
      }),
    );
    expect(await screen.findByText('Your appointment has been cancelled.')).toBeInTheDocument();
  });

  it('shows the next appointment on the dashboard', async () => {
    mockApi(patientRoutes({ 'GET /api/appointments': listOf(appointment()) }));
    renderApp('/dashboard');
    expect(await screen.findByText('Standard consultation with Dr Able')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book appointment' })).toHaveAttribute('href', '/book');
  });
});

describe('reschedule', () => {
  it('moves the appointment to the chosen slot', async () => {
    const detail: AppointmentDetail = { ...appointment(), reasonForVisit: null, events: [] };
    const api = mockApi(
      patientRoutes({
        [`GET /api/appointments/${APPT}`]: { body: detail },
        [slotsPath(DOC_A)]: { body: { slots: [slot(SOON, '14:00')] } },
        [`PATCH /api/appointments/${APPT}/reschedule`]: { body: appointment() },
        'GET /api/appointments': listOf(appointment()),
      }),
    );
    const { router } = renderApp(`/appointments/${APPT}/reschedule`);
    fireEvent.click(await screen.findByRole('button', { name: '14:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move appointment' }));
    await waitFor(() => expect(currentPath(router)).toBe('/appointments'));
    expect(api.callsTo('PATCH', `/api/appointments/${APPT}/reschedule`)[0]!.body).toEqual({
      doctorId: DOC_A,
      startsAt: `${SOON}T14:00:00.000Z`,
    });
  });
});

describe('front desk', () => {
  it("shows each doctor's day and checks a patient in", async () => {
    const todays = appointment({
      startsAtLocal: `${TODAY}T09:00`,
      endsAtLocal: `${TODAY}T09:15`,
    });
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('receptionist') },
      'GET /api/doctors': { body: { doctors: DOCTORS } },
      [`GET /api/appointments?from=${TODAY}&to=${TODAY}`]: listOf(todays),
      [`PATCH /api/appointments/${APPT}/status`]: { body: { ...todays, status: 'checked_in' } },
    });
    renderApp('/front-desk');
    const able = await screen.findByRole('region', { name: /Dr Able/ });
    expect(within(able).getByText('Pat Example')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Dr Baker/ })).getByText('No appointments.'));

    fireEvent.click(within(able).getByRole('button', { name: /^Check in/ }));
    await waitFor(() =>
      expect(api.callsTo('PATCH', `/api/appointments/${APPT}/status`)[0]!.body).toEqual({
        status: 'checked_in',
      }),
    );
  });
});

describe('doctor schedule', () => {
  it('opens an appointment with the medical summary and adds a clinical note', async () => {
    const todays = appointment({ startsAtLocal: `${TODAY}T09:00`, endsAtLocal: `${TODAY}T09:15` });
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      'GET /api/doctors/me': { body: DOCTORS[0] },
      [`GET /api/appointments?from=${TODAY}&to=${TODAY}&doctorId=${DOC_A}`]: listOf(todays),
      [`GET /api/appointments/${APPT}`]: {
        body: { ...todays, reasonForVisit: 'Sore knee', events: [] },
      },
      [`GET /api/patients/${PATIENT}`]: {
        body: patientRecord({ id: PATIENT, lastName: 'Example' }),
      },
      [`GET /api/appointments/${APPT}/notes`]: { body: { notes: [] } },
      [`POST /api/appointments/${APPT}/notes`]: (body) => ({
        status: 201,
        body: {
          id: 'n1',
          appointmentId: APPT,
          body: (body as { body: string }).body,
          authorName: 'Dr Able',
          amendsNoteId: null,
          createdAt: new Date().toISOString(),
        },
      }),
    });
    renderApp('/schedule');
    fireEvent.click(await screen.findByRole('button', { name: /09:00–09:15 Pat Example/ }));
    expect(await screen.findByText('Sore knee')).toBeInTheDocument();
    expect(await screen.findByText(/Penicillin/)).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText('New note'), {
      target: { value: 'Examined knee.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Examined knee.')).toBeInTheDocument();
    expect(api.callsTo('POST', `/api/appointments/${APPT}/notes`)[0]!.body).toEqual({
      body: 'Examined knee.',
    });
    expect(screen.getByRole('button', { name: 'Amend this note' })).toBeInTheDocument();
  });
});
