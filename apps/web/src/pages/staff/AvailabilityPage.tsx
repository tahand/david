import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { doctorKeys, doctorsApi } from '../../api/doctors';
import { useAuth } from '../../auth/AuthProvider';
import { ExceptionsPanel } from '../../components/availability/ExceptionsPanel';
import { WeeklyHoursEditor } from '../../components/availability/WeeklyHoursEditor';
import { Alert, SelectField, Spinner } from '../../components/forms';
import { PageHeading } from '../../components/layouts';
import { Section } from '../../components/patient/DetailList';

/**
 * Availability (SPEC §10): weekly working hours and exceptions. Doctors manage
 * their own; admins choose a doctor (kept in `?doctor=` so links are shareable).
 */
export function AvailabilityPage() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === 'admin';
  const [params, setParams] = useSearchParams();

  const self = useQuery({ queryKey: doctorKeys.me, queryFn: doctorsApi.me, enabled: !isAdmin });
  const doctors = useQuery({
    queryKey: doctorKeys.list,
    queryFn: doctorsApi.list,
    enabled: isAdmin,
  });

  const doctorId = isAdmin ? (params.get('doctor') ?? doctors.data?.[0]?.id) : self.data?.id;
  const lookup = isAdmin ? doctors : self;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeading>Availability</PageHeading>
      {isAdmin && doctors.data && doctors.data.length > 0 && (
        <div className="max-w-sm">
          <SelectField
            label="Doctor"
            value={doctorId}
            options={doctors.data.map((d) => ({ value: d.id, label: d.displayName }))}
            onChange={(e) => setParams({ doctor: e.target.value })}
          />
        </div>
      )}
      {lookup.isPending ? (
        <Spinner label="Loading" />
      ) : lookup.isError ? (
        <Alert>
          {lookup.error instanceof ApiError && lookup.error.status === 404
            ? 'Your account has no doctor profile. Ask an admin to set one up.'
            : "We couldn't load this page. Please try again."}
        </Alert>
      ) : !doctorId ? (
        <p className="text-slate-800">There are no doctors yet.</p>
      ) : (
        <DoctorAvailability key={doctorId} doctorId={doctorId} />
      )}
    </div>
  );
}

function DoctorAvailability({ doctorId }: { doctorId: string }) {
  const queryClient = useQueryClient();
  const key = doctorKeys.availability(doctorId);
  const query = useQuery({ queryKey: key, queryFn: () => doctorsApi.availability(doctorId) });

  if (query.isPending) return <Spinner label="Loading availability" />;
  if (query.isError) return <Alert>We couldn't load availability. Please try again.</Alert>;
  const data = query.data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  return (
    <>
      <p className="-mt-2 text-sm text-slate-700">
        All times are clinic time ({data.timezone}). Patients can book slots inside these hours.
      </p>
      <Section title="Weekly hours">
        <WeeklyHoursEditor
          rules={data.rules}
          onSave={async (rules) => {
            queryClient.setQueryData(
              key,
              await doctorsApi.replaceAvailability(doctorId, { rules }),
            );
          }}
        />
      </Section>
      <Section title="Time off and extra sessions">
        <ExceptionsPanel
          exceptions={data.exceptions}
          onAdd={async (input) => {
            await doctorsApi.addException(doctorId, input);
            await refresh();
          }}
          onDelete={async (id) => {
            await doctorsApi.deleteException(doctorId, id);
            await refresh();
          }}
        />
      </Section>
    </>
  );
}
