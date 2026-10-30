import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PatientRecord } from '@clinic/shared';
import { appointmentKeys, appointmentsApi } from '../../api/appointments';
import { ApiError } from '../../api/client';
import { patientKeys, patientsApi } from '../../api/patients';
import { useAuth } from '../../auth/AuthProvider';
import { AppointmentList, isUpcoming } from '../../components/appointments/AppointmentList';
import { Alert, Button, Spinner } from '../../components/forms';
import { PageHeading, useClinicInfo } from '../../components/layouts';
import { Section } from '../../components/patient/DetailList';
import { MedicalSummaryForm, MedicalSummaryView } from '../../components/patient/MedicalSummary';
import { PatientDetailsForm, PatientDetailsView } from '../../components/patient/PatientDetails';
import { formatDate, fullName } from '../../lib/format';

type Editing = 'details' | 'medical' | null;

/**
 * Staff view of one patient (SPEC §10). Reception and admins edit details;
 * doctors and reception edit the medical summary. The API decides who can
 * see the record at all (doctors: own patients only).
 */
export function PatientDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { me } = useAuth();
  const clinic = useClinicInfo();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const state = location.state as {
    created?: boolean;
    booked?: string;
    rescheduled?: string;
  } | null;
  const [message, setMessage] = useState<string | null>(
    state?.created
      ? 'Patient created.'
      : state?.booked
        ? 'Appointment booked.'
        : state?.rescheduled
          ? 'Appointment moved.'
          : null,
  );
  const query = useQuery({ queryKey: patientKeys.detail(id), queryFn: () => patientsApi.get(id) });

  const role = me?.user.role;
  const canEditDetails = role === 'receptionist' || role === 'admin';
  const canEditMedical = canEditDetails || role === 'doctor';
  const healthIdLabel = clinic.data?.healthIdLabel ?? 'Health ID';

  if (query.isPending) return <Spinner label="Loading patient" />;
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        <PageHeading>{notFound ? 'Patient not found' : 'Something went wrong'}</PageHeading>
        <p className="text-ink">
          {notFound
            ? "This patient doesn't exist, or isn't one of your patients."
            : "We couldn't load this patient. Please try again."}
        </p>
        <Link to="/patients" className="text-link underline">
          Back to patients
        </Link>
      </div>
    );
  }
  const patient = query.data;

  const saved = (updated: PatientRecord, text: string) => {
    queryClient.setQueryData(patientKeys.detail(id), updated);
    void queryClient.invalidateQueries({ queryKey: ['patients', 'search'] });
    setEditing(null);
    setMessage(text);
  };
  const startEditing = (what: Editing) => {
    setMessage(null);
    setEditing(what);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link to="/patients" className="text-sm text-link underline">
        Back to patients
      </Link>
      <div>
        <PageHeading>{fullName(patient)}</PageHeading>
        <p className="-mt-4 text-ink">
          Born {formatDate(patient.dateOfBirth)}
          {patient.hasLogin ? ' · Has an online account' : ' · No online account'}
        </p>
      </div>
      {message && <Alert tone="success">{message}</Alert>}

      <Section
        title="Details"
        action={
          canEditDetails &&
          editing !== 'details' && (
            <Button variant="secondary" onClick={() => startEditing('details')}>
              Edit details
            </Button>
          )
        }
      >
        {editing === 'details' ? (
          <PatientDetailsForm
            patient={patient}
            healthIdLabel={healthIdLabel}
            showContactEmail={!patient.hasLogin}
            submitLabel="Save details"
            onCancel={() => setEditing(null)}
            onSubmit={async (values) =>
              saved(await patientsApi.update(id, values), 'Details saved.')
            }
          />
        ) : (
          <PatientDetailsView patient={patient} healthIdLabel={healthIdLabel} />
        )}
      </Section>

      <Section
        title="Medical summary"
        action={
          canEditMedical &&
          editing !== 'medical' && (
            <Button variant="secondary" onClick={() => startEditing('medical')}>
              Edit medical summary
            </Button>
          )
        }
      >
        {editing === 'medical' ? (
          <MedicalSummaryForm
            patient={patient}
            onCancel={() => setEditing(null)}
            onSubmit={async (values) =>
              saved(await patientsApi.replaceMedicalSummary(id, values), 'Medical summary saved.')
            }
          />
        ) : (
          <MedicalSummaryView patient={patient} />
        )}
      </Section>

      <PatientAppointments
        patientId={patient.id}
        canBook={canEditDetails}
        isDoctor={role === 'doctor'}
        onChanged={setMessage}
      />
    </div>
  );
}

/** Upcoming and past appointments; doctors see only their own (the API scopes the list). */
function PatientAppointments({
  patientId,
  canBook,
  isDoctor,
  onChanged,
}: {
  patientId: string;
  canBook: boolean;
  isDoctor: boolean;
  onChanged: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: appointmentKeys.list({ patientId }),
    queryFn: () => appointmentsApi.list({ patientId }),
  });
  const changed = () => {
    onChanged('Appointment cancelled.');
    void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
  };
  const now = Date.now();
  const all = query.data?.appointments ?? [];

  return (
    <Section
      title={isDoctor ? 'Appointments with you' : 'Appointments'}
      action={
        canBook && (
          <Link
            to={`/book?patient=${encodeURIComponent(patientId)}`}
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-4 font-medium text-on-brand hover:bg-brand-hover"
          >
            Book appointment
          </Link>
        )
      }
    >
      {query.isPending ? (
        <Spinner label="Loading appointments" />
      ) : query.isError ? (
        <p className="text-ink">We couldn't load appointments.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <h3 className="font-semibold text-heading">Upcoming</h3>
          <AppointmentList
            appointments={all.filter((a) => isUpcoming(a, now))}
            empty="No upcoming appointments."
            onChanged={changed}
          />
          <h3 className="font-semibold text-heading">History</h3>
          <AppointmentList
            appointments={all.filter((a) => !isUpcoming(a, now)).reverse()}
            empty="No past appointments."
            onChanged={changed}
          />
        </div>
      )}
    </Section>
  );
}
