import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PatientRecord } from '@clinic/shared';
import { ApiError } from '../../api/client';
import { patientKeys, patientsApi } from '../../api/patients';
import { useAuth } from '../../auth/AuthProvider';
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
  const [message, setMessage] = useState<string | null>(
    (location.state as { created?: boolean } | null)?.created ? 'Patient created.' : null,
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
        <p className="text-slate-800">
          {notFound
            ? "This patient doesn't exist, or isn't one of your patients."
            : "We couldn't load this patient. Please try again."}
        </p>
        <Link to="/patients" className="text-brand-700 underline">
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
      <Link to="/patients" className="text-sm text-brand-700 underline">
        Back to patients
      </Link>
      <div>
        <PageHeading>{fullName(patient)}</PageHeading>
        <p className="-mt-4 text-slate-800">
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

      <Section title="Appointments">
        <p className="text-slate-800">Appointment history will appear here.</p>
      </Section>
    </div>
  );
}
