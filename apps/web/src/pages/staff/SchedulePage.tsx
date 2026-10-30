import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isActiveStatus, type AppointmentDto } from '@clinic/shared';
import { appointmentKeys, appointmentsApi } from '../../api/appointments';
import { ApiError } from '../../api/client';
import { doctorKeys, doctorsApi } from '../../api/doctors';
import { patientKeys, patientsApi } from '../../api/patients';
import { NotesPanel } from '../../components/appointments/NotesPanel';
import { StatusActions } from '../../components/appointments/StatusActions';
import { StatusBadge } from '../../components/appointments/StatusBadge';
import { Alert, Button, Spinner } from '../../components/forms';
import { PageHeading, useClinicInfo } from '../../components/layouts';
import { Section } from '../../components/patient/DetailList';
import { MedicalSummaryView } from '../../components/patient/MedicalSummary';
import {
  addCalendarDays,
  clinicToday,
  formatDate,
  formatDayDate,
  fullName,
} from '../../lib/format';

type View = 'day' | 'week';

/** Monday on or before `date`. */
const mondayOf = (date: string) => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
};

/**
 * Doctor's schedule (SPEC §10): a day or week of their own appointments.
 * Choosing one opens the patient summary, status actions and clinical notes.
 * The view, date and selection live in the URL so the page survives a reload.
 */
export function SchedulePage() {
  const clinic = useClinicInfo();
  const timezone = clinic.data?.timezone ?? 'Europe/London';
  const today = clinicToday(timezone);
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'week' ? 'week' : 'day';
  const date = params.get('date') ?? today;
  const selectedId = params.get('appointment');
  const from = view === 'week' ? mondayOf(date) : date;
  const to = view === 'week' ? addCalendarDays(from, 6) : date;

  const self = useQuery({ queryKey: doctorKeys.me, queryFn: doctorsApi.me });
  const listQuery = { from, to, doctorId: self.data?.id };
  const list = useQuery({
    queryKey: appointmentKeys.list(listQuery),
    queryFn: () => appointmentsApi.list(listQuery),
    enabled: !!self.data,
  });

  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) merged.delete(k);
      else merged.set(k, v);
    }
    setParams(merged);
  };
  const step = view === 'week' ? 7 : 1;

  if (self.isError) {
    return (
      <Alert>
        {self.error instanceof ApiError && self.error.status === 404
          ? 'Your account has no doctor profile. Ask an admin to set one up.'
          : "We couldn't load your schedule. Please try again."}
      </Alert>
    );
  }

  const appointments = list.data?.appointments ?? [];
  const selected = appointments.find((a) => a.id === selectedId) ?? null;
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addCalendarDays(from, i));

  return (
    <div className="flex flex-col gap-6">
      <PageHeading>Schedule</PageHeading>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex gap-2" role="group" aria-label="View">
          {(['day', 'week'] as const).map((v) => (
            <Button
              key={v}
              variant={view === v ? 'primary' : 'secondary'}
              aria-pressed={view === v}
              className="min-h-11"
              onClick={() => update({ view: v, appointment: null })}
            >
              {v === 'day' ? 'Day' : 'Week'}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => update({ date: addCalendarDays(date, -step), appointment: null })}
          >
            Previous<span className="sr-only"> {view}</span>
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => update({ date: today, appointment: null })}
          >
            Today
          </Button>
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => update({ date: addCalendarDays(date, step), appointment: null })}
          >
            Next<span className="sr-only"> {view}</span>
          </Button>
        </div>
      </div>
      <p className="-mt-3 font-medium text-ink" aria-live="polite">
        {view === 'week' ? `${formatDayDate(from)} – ${formatDayDate(to)}` : formatDayDate(from)}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex flex-col gap-4">
          {self.isPending || list.isPending ? (
            <Spinner label="Loading schedule" />
          ) : list.isError ? (
            <Alert>We couldn't load your schedule. Please try again.</Alert>
          ) : (
            days.map((day) => {
              const dayAppointments = appointments.filter(
                (a) => a.startsAtLocal.slice(0, 10) === day,
              );
              return (
                <section key={day} aria-label={formatDayDate(day)}>
                  {view === 'week' && (
                    <h2 className="mb-2 font-semibold text-heading">{formatDayDate(day)}</h2>
                  )}
                  {dayAppointments.length === 0 ? (
                    <p className="text-sm text-ink-muted">No appointments.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {dayAppointments.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            aria-current={a.id === selectedId || undefined}
                            onClick={() => update({ appointment: a.id })}
                            className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3 text-left ${
                              a.id === selectedId
                                ? 'border-brand bg-accent-soft'
                                : 'border-line bg-card hover:bg-page'
                            } ${isActiveStatus(a.status) || a.status === 'completed' ? '' : 'opacity-75'}`}
                          >
                            <span className="font-semibold text-ink">
                              {a.startsAtLocal.slice(11)}–{a.endsAtLocal.slice(11)}
                            </span>
                            <span className="text-ink">{fullName(a.patient)}</span>
                            <span className="text-sm text-ink-muted">{a.appointmentType.name}</span>
                            <StatusBadge status={a.status} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
        {selected && (
          <AppointmentPanel key={selected.id} appointment={selected} timezone={timezone} />
        )}
      </div>
    </div>
  );
}

function AppointmentPanel({
  appointment: a,
  timezone,
}: {
  appointment: AppointmentDto;
  timezone: string;
}) {
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detail = useQuery({
    queryKey: appointmentKeys.detail(a.id),
    queryFn: () => appointmentsApi.get(a.id),
  });
  const patient = useQuery({
    queryKey: patientKeys.detail(a.patient.id),
    queryFn: () => patientsApi.get(a.patient.id),
  });

  useEffect(() => headingRef.current?.focus(), []);

  const cancelled = a.status === 'cancelled_by_clinic' || a.status === 'cancelled_by_patient';

  return (
    <aside aria-labelledby={`panel-${a.id}`} className="flex flex-col gap-4">
      <Section title="Appointment">
        <h2 id={`panel-${a.id}`} ref={headingRef} tabIndex={-1} className="sr-only">
          {fullName(a.patient)}, {a.startsAtLocal.slice(11)}
        </h2>
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-semibold text-ink">{fullName(a.patient)}</p>
            <p className="text-sm text-ink-muted">Born {formatDate(a.patient.dateOfBirth)}</p>
            <Link to={`/patients/${a.patient.id}`} className="text-sm text-link underline">
              Full patient record
            </Link>
          </div>
          <p className="text-ink">
            {a.appointmentType.name}, {a.startsAtLocal.slice(11)}–{a.endsAtLocal.slice(11)}{' '}
            <StatusBadge status={a.status} />
          </p>
          <div>
            <p className="text-sm font-medium text-ink-muted">Reason for visit</p>
            {detail.isPending ? (
              <Spinner label="Loading" />
            ) : (
              <p className="whitespace-pre-wrap break-words text-ink">
                {detail.data?.reasonForVisit ?? 'Not given'}
              </p>
            )}
          </div>
          <StatusActions
            appointment={a}
            role="doctor"
            timezone={timezone}
            onUpdated={() => void queryClient.invalidateQueries({ queryKey: appointmentKeys.all })}
          />
        </div>
      </Section>
      <Section title="Medical summary">
        {patient.isPending ? (
          <Spinner label="Loading medical summary" />
        ) : patient.isError ? (
          <p className="text-ink">We couldn't load the medical summary.</p>
        ) : (
          <MedicalSummaryView patient={patient.data} />
        )}
      </Section>
      <Section title="Clinical notes">
        <NotesPanel appointmentId={a.id} canWrite={!cancelled} />
      </Section>
    </aside>
  );
}
