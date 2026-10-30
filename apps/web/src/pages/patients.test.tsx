import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { PatientRecord } from '@clinic/shared';
import { apiError, currentPath, meFor, mockApi, renderApp } from '../test/mockApi';

const ID = '11111111-1111-4111-8111-111111111111';

const record = (overrides: Partial<PatientRecord> = {}): PatientRecord => ({
  id: ID,
  hasLogin: true,
  email: 'pat@example.test',
  title: null,
  firstName: 'Pat',
  middleNames: null,
  lastName: 'Fakeson',
  preferredName: null,
  dateOfBirth: '1990-01-31',
  sexAtBirth: null,
  genderIdentity: null,
  pronouns: null,
  healthId: '943 476 5919',
  preferredLanguage: null,
  interpreterRequired: false,
  phoneMobile: '07700 900123',
  phoneAlt: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  region: null,
  postcode: 'EX1 1AA',
  country: null,
  preferredContact: 'email',
  reminderConsent: true,
  emergencyContact: null,
  medicalSummary: {
    allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
    medications: [],
    conditions: [],
  },
  gpDetails: null,
  accessibilityNeeds: null,
  consentVersion: 'v1',
  consentAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('patient profile (SPEC §10)', () => {
  it('shows details, a read-only medical summary and data download links', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('patient') },
      'GET /api/patients/me': { body: record() },
    });
    renderApp('/profile');
    expect(await screen.findByText('943 476 5919')).toBeInTheDocument();
    expect(screen.getByText('NHS number')).toBeInTheDocument();
    expect(screen.getByText('31 Jan 1990')).toBeInTheDocument();
    expect(screen.getByText('Penicillin · Rash · Moderate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /medical summary/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download as PDF' })).toHaveAttribute(
      'href',
      '/api/patients/me/export?format=pdf',
    );
    expect(screen.getByRole('link', { name: /Download as JSON/ })).toHaveAttribute(
      'href',
      '/api/patients/me/export?format=json',
    );
  });

  it('edits details and sends a blank emergency contact as null', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('patient') },
      'GET /api/patients/me': { body: record() },
      'PATCH /api/patients/me': (body) => ({
        body: record({ preferredName: (body as { preferredName: string }).preferredName }),
      }),
    });
    renderApp('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    // Patients change their login email through their account, not here.
    expect(screen.queryByLabelText('Email (optional)')).not.toBeInTheDocument();
    type('Preferred name (optional)', 'Patty');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Your details have been saved.')).toBeInTheDocument();
    expect(screen.getByText('Patty')).toBeInTheDocument();

    const sent = api.callsTo('PATCH', '/api/patients/me')[0]!.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      preferredName: 'Patty',
      healthId: '943 476 5919',
      title: null,
      sexAtBirth: null,
      emergencyContact: null,
    });
    expect(sent).not.toHaveProperty('contactEmail');
  });

  it('validates a partly filled emergency contact before sending', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('patient') },
      'GET /api/patients/me': { body: record() },
    });
    renderApp('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    type('Contact name', 'Fake Contact');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter the relationship')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact phone')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('PATCH', '/api/patients/me')).toHaveLength(0);
  });

  it('shows server validation errors on the matching field', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('patient') },
      'GET /api/patients/me': { body: record() },
      'PATCH /api/patients/me': apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
        { path: 'postcode', message: 'Postcode not recognised' },
      ]),
    });
    renderApp('/profile');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Postcode not recognised')).toBeInTheDocument();
    expect(screen.getByLabelText('Postcode (optional)')).toHaveAttribute('aria-invalid', 'true');
  });

  it('is not available to staff', async () => {
    mockApi({ 'GET /api/auth/me': { body: meFor('receptionist') } });
    renderApp('/profile');
    expect(
      await screen.findByRole('heading', { name: "You don't have access" }),
    ).toBeInTheDocument();
  });
});

describe('patient search (SPEC §10)', () => {
  const results = {
    patients: [
      {
        id: ID,
        firstName: 'Pat',
        lastName: 'Fakeson',
        preferredName: 'Patty',
        dateOfBirth: '1990-01-31',
        postcode: 'EX1 1AA',
        phoneMobile: null,
        hasLogin: true,
      },
    ],
    page: 1,
    pageSize: 20,
    hasMore: false,
  };

  it('searches and links to each patient', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('receptionist') },
      'GET /api/patients?page=1': { body: { ...results, patients: [] } },
      'GET /api/patients?page=1&search=fakeson': { body: results },
    });
    const { router } = renderApp('/patients');
    expect(await screen.findByText('No patients yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add patient' })).toHaveAttribute(
      'href',
      '/patients/new',
    );
    type(/Search patients/, 'fakeson');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const link = await screen.findByRole('link', { name: 'Fakeson, Pat (Patty)' });
    expect(link).toHaveAttribute('href', `/patients/${ID}`);
    expect(currentPath(router)).toBe('/patients?q=fakeson');
    const row = link.closest('li')!;
    expect(row).toHaveTextContent('Date of birth: 31 Jan 1990');
    expect(row).toHaveTextContent('Postcode: EX1 1AA');
    expect(row).toHaveTextContent('Mobile: —');
    expect(screen.getByRole('list', { name: 'Patients matching "fakeson", page 1' })).toBe(
      row.parentElement,
    );
    expect(api.callsTo('GET', '/api/patients?page=1&search=fakeson')).toHaveLength(1);
  });

  it('tells doctors they only see their own patients and hides "Add patient"', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      'GET /api/patients?page=1': { body: results },
    });
    renderApp('/patients');
    expect(await screen.findByText(/who have an appointment with you/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add patient' })).not.toBeInTheDocument();
  });

  it('is not available to patients', async () => {
    mockApi({ 'GET /api/auth/me': { body: meFor('patient') } });
    renderApp('/patients');
    expect(
      await screen.findByRole('heading', { name: "You don't have access" }),
    ).toBeInTheDocument();
  });
});

describe('add patient', () => {
  it('creates a record and opens it', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('receptionist') },
      'POST /api/patients': (body) => ({
        status: 201,
        body: record({ ...(body as Partial<PatientRecord>), hasLogin: false, email: null }),
      }),
      [`GET /api/patients/${ID}`]: { body: record({ hasLogin: false }) },
    });
    const { router } = renderApp('/patients/new');
    type(await screen.findByLabelText('First name').then(() => 'First name'), 'New');
    type('Last name', 'Fakeperson');
    type('Date of birth', '1975-11-30');
    type('Email (optional)', 'new@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    expect(await screen.findByText('Patient created.')).toBeInTheDocument();
    expect(currentPath(router)).toBe(`/patients/${ID}`);
    expect(api.callsTo('POST', '/api/patients')[0]!.body).toMatchObject({
      firstName: 'New',
      lastName: 'Fakeperson',
      dateOfBirth: '1975-11-30',
      contactEmail: 'new@example.test',
    });
  });

  it('requires the mandatory fields', async () => {
    const api = mockApi({ 'GET /api/auth/me': { body: meFor('admin') } });
    renderApp('/patients/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Create patient' }));
    expect(await screen.findByText('Enter a first name')).toBeInTheDocument();
    expect(screen.getByText('Enter a last name')).toBeInTheDocument();
    expect(api.callsTo('POST', '/api/patients')).toHaveLength(0);
  });

  it('is not available to doctors', async () => {
    mockApi({ 'GET /api/auth/me': { body: meFor('doctor') } });
    renderApp('/patients/new');
    expect(
      await screen.findByRole('heading', { name: "You don't have access" }),
    ).toBeInTheDocument();
  });
});

describe('patient record (staff)', () => {
  it('lets a doctor edit the medical summary but not the details', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      [`GET /api/patients/${ID}`]: { body: record() },
      [`PUT /api/patients/${ID}/medical-summary`]: (body) => ({
        body: record({ medicalSummary: body as PatientRecord['medicalSummary'] }),
      }),
    });
    renderApp(`/patients/${ID}`);
    expect(await screen.findByRole('heading', { name: 'Pat Fakeson' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit medical summary' }));
    expect(screen.getByLabelText('Allergy 1: substance')).toHaveValue('Penicillin');
    fireEvent.click(screen.getByRole('button', { name: 'Add medication' }));
    type('Medication 1: name', 'Fakeprofen');
    type('Dose (optional)', '200 mg');
    fireEvent.click(screen.getByRole('button', { name: 'Save medical summary' }));
    expect(await screen.findByText('Medical summary saved.')).toBeInTheDocument();
    expect(screen.getByText('Fakeprofen · 200 mg')).toBeInTheDocument();

    expect(api.callsTo('PUT', `/api/patients/${ID}/medical-summary`)[0]!.body).toEqual({
      allergies: [{ substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' }],
      medications: [{ name: 'Fakeprofen', dose: '200 mg', frequency: null }],
      conditions: [],
      gpDetails: { name: null, practice: null, phone: null },
      accessibilityNeeds: null,
    });
  });

  it('lets reception edit details, including a contact email for patients without a login', async () => {
    const api = mockApi({
      'GET /api/auth/me': { body: meFor('receptionist') },
      [`GET /api/patients/${ID}`]: { body: record({ hasLogin: false, email: null }) },
      [`PATCH /api/patients/${ID}`]: { body: record({ hasLogin: false, city: 'Exampletown' }) },
    });
    renderApp(`/patients/${ID}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
    type('Email (optional)', 'kin@example.test');
    type('Town or city (optional)', 'Exampletown');
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Details saved.')).toBeInTheDocument();
    expect(api.callsTo('PATCH', `/api/patients/${ID}`)[0]!.body).toMatchObject({
      city: 'Exampletown',
      contactEmail: 'kin@example.test',
    });
  });

  it('shows "Patient not found" for a 404', async () => {
    mockApi({
      'GET /api/auth/me': { body: meFor('doctor') },
      [`GET /api/patients/${ID}`]: apiError(404, 'NOT_FOUND', 'Patient not found'),
    });
    renderApp(`/patients/${ID}`);
    expect(await screen.findByRole('heading', { name: 'Patient not found' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/isn't one of your patients/)).toBeInTheDocument());
  });
});
