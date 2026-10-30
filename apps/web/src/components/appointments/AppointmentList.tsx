import { useState } from 'react';
import { Link } from 'react-router';
import { isActiveStatus, type AppointmentDto } from '@clinic/shared';
import { formatDate, formatLocalRange, fullName } from '../../lib/format';
import { CancelDialog } from './CancelDialog';
import { StatusBadge } from './StatusBadge';

/** Not finished and not yet ended: shown under "Upcoming". */
export const isUpcoming = (a: AppointmentDto, now: number = Date.now()) =>
  isActiveStatus(a.status) && Date.parse(a.endsAt) > now;

/**
 * Appointments as stacked cards, with reschedule and cancel actions where the
 * API says the caller may still change them (`canChange`).
 */
export function AppointmentList({
  appointments,
  showPatient = false,
  empty,
  onChanged,
  changeClosedHint,
}: {
  appointments: AppointmentDto[];
  showPatient?: boolean;
  empty: string;
  onChanged: (updated: AppointmentDto) => void;
  /** Shown on active future appointments the caller can no longer change. */
  changeClosedHint?: string;
}) {
  const [cancelling, setCancelling] = useState<AppointmentDto | null>(null);
  if (appointments.length === 0) return <p className="text-ink">{empty}</p>;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {appointments.map((a) => (
          <li key={a.id} className="rounded-md border border-line p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {formatLocalRange(a.startsAtLocal, a.endsAtLocal)}
                </p>
                <p className="text-ink">
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block h-3 w-3 rounded-full align-middle"
                    style={{ backgroundColor: a.appointmentType.colour }}
                  />
                  {a.appointmentType.name} with {a.doctor.displayName}
                </p>
                {showPatient && (
                  <p className="text-sm text-ink-muted">
                    {fullName(a.patient)} · born {formatDate(a.patient.dateOfBirth)}
                  </p>
                )}
                {a.cancelledReason && (
                  <p className="text-sm break-words text-ink-muted">Reason: {a.cancelledReason}</p>
                )}
              </div>
              <StatusBadge status={a.status} />
            </div>
            {a.canChange ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={`/appointments/${a.id}/reschedule`}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-card px-3 text-sm font-medium text-ink hover:bg-page"
                >
                  Reschedule
                  <span className="sr-only">
                    : {formatLocalRange(a.startsAtLocal, a.endsAtLocal)}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setCancelling(a)}
                  className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-card px-3 text-sm font-medium text-ink hover:bg-page"
                >
                  Cancel
                  <span className="sr-only">
                    : {formatLocalRange(a.startsAtLocal, a.endsAtLocal)}
                  </span>
                </button>
              </div>
            ) : (
              changeClosedHint &&
              isUpcoming(a) && <p className="mt-2 text-sm text-ink-muted">{changeClosedHint}</p>
            )}
          </li>
        ))}
      </ul>
      {cancelling && (
        <CancelDialog
          appointment={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(updated) => {
            setCancelling(null);
            onChanged(updated);
          }}
        />
      )}
    </>
  );
}
