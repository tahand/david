import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { patientKeys, patientsApi } from '../../api/patients';
import { PageHeading, useClinicInfo } from '../../components/layouts';
import { PatientDetailsForm } from '../../components/patient/PatientDetails';

/** Reception creates a patient record without a login (SPEC §3). */
export function NewPatientPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const clinic = useClinicInfo();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link to="/patients" className="text-sm text-link underline">
        Back to patients
      </Link>
      <PageHeading>Add patient</PageHeading>
      <div className="rounded-lg border border-line bg-card p-6">
        <PatientDetailsForm
          healthIdLabel={clinic.data?.healthIdLabel ?? 'Health ID'}
          showContactEmail
          submitLabel="Create patient"
          onCancel={() => navigate('/patients')}
          onSubmit={async (values) => {
            const created = await patientsApi.create(values);
            queryClient.setQueryData(patientKeys.detail(created.id), created);
            await queryClient.invalidateQueries({ queryKey: ['patients', 'search'] });
            navigate(`/patients/${created.id}`, { state: { created: true } });
          }}
        />
      </div>
    </div>
  );
}
