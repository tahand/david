import { STATUS_LABELS, type AppointmentStatus } from '@clinic/shared';

const STYLES: Record<AppointmentStatus, string> = {
  booked: 'bg-accent-soft text-ink',
  confirmed: 'bg-accent-soft text-ink',
  checked_in: 'bg-green-50 text-green-900 border border-green-700',
  completed: 'bg-green-50 text-green-900',
  cancelled_by_patient: 'border border-line-strong text-ink-muted',
  cancelled_by_clinic: 'border border-line-strong text-ink-muted',
  no_show: 'bg-amber-50 text-amber-950',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
