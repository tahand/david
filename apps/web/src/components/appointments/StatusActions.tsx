import { useState } from 'react';
import {
  STATUS_RULES,
  STATUS_UPDATES,
  canUpdateStatus,
  type AppointmentDto,
  type Role,
  type StatusUpdate,
} from '@clinic/shared';
import { appointmentsApi } from '../../api/appointments';
import { ApiError } from '../../api/client';
import { clinicToday, fullName } from '../../lib/format';
import { Alert, Button } from '../forms';

const ACTION_LABELS: Record<StatusUpdate, string> = {
  confirmed: 'Confirm',
  checked_in: 'Check in',
  completed: 'Mark completed',
  no_show: 'Did not attend',
};

/** Status changes this role may make now (mirrors the API's STATUS_RULES checks). */
export function availableStatusUpdates(
  appointment: AppointmentDto,
  role: Role,
  timezone: string,
  now: Date = new Date(),
): StatusUpdate[] {
  return STATUS_UPDATES.filter((to) => {
    if (!canUpdateStatus(role, appointment.status, to)) return false;
    const when = STATUS_RULES[to].when;
    if (when === 'day_of') return appointment.startsAtLocal.slice(0, 10) <= clinicToday(timezone);
    if (when === 'started') return Date.parse(appointment.startsAt) <= now.getTime();
    return true;
  });
}

export function StatusActions({
  appointment,
  role,
  timezone,
  onUpdated,
}: {
  appointment: AppointmentDto;
  role: Role;
  timezone: string;
  onUpdated: (updated: AppointmentDto) => void;
}) {
  const [busy, setBusy] = useState<StatusUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = availableStatusUpdates(appointment, role, timezone);
  if (actions.length === 0) return null;
  const who = fullName(appointment.patient);

  return (
    <div className="flex flex-col gap-2">
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {actions.map((to) => (
          <Button
            key={to}
            variant={to === 'checked_in' || to === 'completed' ? 'primary' : 'secondary'}
            className="min-h-11 !px-3 text-sm"
            loading={busy === to}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(to);
              setError(null);
              try {
                onUpdated(await appointmentsApi.updateStatus(appointment.id, { status: to }));
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            {ACTION_LABELS[to]}
            <span className="sr-only">
              : {who}, {appointment.startsAtLocal.slice(11)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
