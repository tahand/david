import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppointmentDto } from '@clinic/shared';
import { appointmentKeys, appointmentsApi } from '../../api/appointments';
import { doctorKeys, doctorsApi } from '../../api/doctors';
import { useAuth } from '../../auth/AuthProvider';
import { CancelDialog } from '../../components/appointments/CancelDialog';
import { StatusActions } from '../../components/appointments/StatusActions';
import { StatusBadge } from '../../components/appointments/StatusBadge';
import { Alert, Button, Spinner, TextField } from '../../components/forms';
import { PageHeading, useClinicInfo } from '../../components/layouts';
import { addCalendarDays, clinicToday, formatDayDate, fullName } from '../../lib/format';

/**
 * Front desk (SPEC §10): every doctor's day side by side, with confirm,
 * check-in, did-not-attend and cancel actions. Columns wrap on narrow screens.
 */
export function FrontDeskPage() {
  const { me } = useAuth();
  const clinic = useClinicInfo();
  const queryClient = useQueryClient();
  const timezone = clinic.data?.timezone ?? 'Europe/London';
  const today = clinicToday(timezone);
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today;
  const [cancelling, setCancelling] = useState<AppointmentDto | null>(null);

  const doctors = useQuery({ queryKey: doctorKeys.list, queryFn: doctorsApi.list });
  const listQuery = { from: date, to: date };
  const list = useQuery({
    queryKey: appointmentKeys.list(listQuery),
    queryFn: () => appointmentsApi.list(listQuery),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all });

  if (!me) return null;
  const role = me.user.role;
  const appointments = list.data?.appointments ?? [];
  // Doctors with appointments that day are shown even if no longer bookable.
  const columns = (doctors.data ?? []).filter(
    (d) => d.isBookable || appointments.some((a) => a.doctor.id === d.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeading>Front desk</PageHeading>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full sm:w-56">
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setParams({ date: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => setParams({ date: addCalendarDays(date, -1) })}
          >
            Previous day
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={() => setParams({})}>
            Today
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => setParams({ date: addCalendarDays(date, 1) })}
          >
            Next day
          </Button>
        </div>
      </div>
      <p className="-mt-3 font-medium text-ink" aria-live="polite">
        {formatDayDate(date)}
        {date === today && ' (today)'}
      </p>

      {doctors.isPending || list.isPending ? (
        <Spinner label="Loading appointments" />
      ) : doctors.isError || list.isError ? (
        <Alert>We couldn't load the day. Please try again.</Alert>
      ) : columns.length === 0 ? (
        <p className="text-ink">There are no doctors yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {columns.map((d) => {
            const own = appointments.filter((a) => a.doctor.id === d.id);
            return (
              <section
                key={d.id}
                aria-labelledby={`doctor-${d.id}`}
                className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
              >
                <h2 id={`doctor-${d.id}`} className="font-semibold text-heading">
                  {d.displayName}{' '}
                  <span className="text-sm font-normal text-ink-muted">
                    ({own.length} {own.length === 1 ? 'appointment' : 'appointments'})
                  </span>
                </h2>
                {own.length === 0 ? (
                  <p className="text-sm text-ink-muted">No appointments.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {own.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-col gap-2 rounded-md border border-line p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">
                              {a.startsAtLocal.slice(11)}–{a.endsAtLocal.slice(11)}
                            </p>
                            <Link
                              to={`/patients/${a.patient.id}`}
                              className="break-words text-link underline"
                            >
                              {fullName(a.patient)}
                            </Link>
                            <p className="text-sm text-ink-muted">{a.appointmentType.name}</p>
                          </div>
                          <StatusBadge status={a.status} />
                        </div>
                        <StatusActions
                          appointment={a}
                          role={role}
                          timezone={timezone}
                          onUpdated={refresh}
                        />
                        {a.canChange && (
                          <div className="flex flex-wrap gap-x-4">
                            <Link
                              to={`/appointments/${a.id}/reschedule`}
                              className="inline-flex min-h-11 items-center text-sm text-link underline"
                            >
                              Reschedule<span className="sr-only">: {fullName(a.patient)}</span>
                            </Link>
                            <Button
                              variant="link"
                              className="min-h-11 text-sm"
                              onClick={() => setCancelling(a)}
                            >
                              Cancel<span className="sr-only">: {fullName(a.patient)}</span>
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {cancelling && (
        <CancelDialog
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
