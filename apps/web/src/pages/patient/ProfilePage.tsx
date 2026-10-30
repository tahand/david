import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EXPORT_URLS, patientKeys, patientsApi } from '../../api/patients';
import { Alert, Button, Spinner } from '../../components/forms';
import { PageHeading, useClinicInfo } from '../../components/layouts';
import { Section } from '../../components/patient/DetailList';
import { MedicalSummaryView } from '../../components/patient/MedicalSummary';
import { PatientDetailsForm, PatientDetailsView } from '../../components/patient/PatientDetails';

/**
 * Patient profile (SPEC §10): personal, contact and emergency contact details
 * are editable; the medical summary is read-only; data download (SPEC §6.2).
 */
export function ProfilePage() {
  const queryClient = useQueryClient();
  const clinic = useClinicInfo();
  const query = useQuery({ queryKey: patientKeys.me, queryFn: patientsApi.me });
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const healthIdLabel = clinic.data?.healthIdLabel ?? 'Health ID';

  if (query.isPending) return <Spinner label="Loading your profile" />;
  if (query.isError) return <Alert>We couldn't load your profile. Please try again later.</Alert>;
  const patient = query.data;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeading>Your profile</PageHeading>
      {saved && <Alert tone="success">Your details have been saved.</Alert>}

      <Section
        title="Your details"
        action={
          !editing && (
            <Button
              variant="secondary"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              Edit details
            </Button>
          )
        }
      >
        {editing ? (
          <PatientDetailsForm
            patient={patient}
            healthIdLabel={healthIdLabel}
            showContactEmail={false}
            submitLabel="Save changes"
            onCancel={() => setEditing(false)}
            onSubmit={async (values) => {
              const updated = await patientsApi.updateMe(values);
              queryClient.setQueryData(patientKeys.me, updated);
              setEditing(false);
              setSaved(true);
            }}
          />
        ) : (
          <PatientDetailsView patient={patient} healthIdLabel={healthIdLabel} />
        )}
      </Section>

      <Section title="Medical summary">
        <MedicalSummaryView patient={patient} />
        <p className="mt-5 text-sm text-slate-800">
          Something wrong or missing? Please tell the clinic
          {clinic.data ? ` on ${clinic.data.clinicPhone}` : ''} or mention it at your next
          appointment, and we'll update it.
        </p>
      </Section>

      <Section title="Download your data">
        <p className="text-slate-800">
          Download a copy of the information we hold about you, including your appointments.
        </p>
        <div className="mt-3 flex flex-wrap gap-4">
          <a href={EXPORT_URLS.pdf} download className="font-medium text-brand-700 underline">
            Download as PDF
          </a>
          <a href={EXPORT_URLS.json} download className="font-medium text-brand-700 underline">
            Download as JSON (machine-readable)
          </a>
        </div>
      </Section>
    </div>
  );
}
