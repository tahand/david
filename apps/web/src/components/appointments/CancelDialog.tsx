import { useState } from 'react';
import type { AppointmentDto } from '@clinic/shared';
import { appointmentsApi } from '../../api/appointments';
import { ApiError } from '../../api/client';
import { formatLocalDateTime } from '../../lib/format';
import { Alert, Button, TextAreaField } from '../forms';
import { Modal } from '../Modal';

/** Confirms a cancellation, with an optional (non-medical) reason. */
export function CancelDialog({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: AppointmentDto;
  onClose: () => void;
  onCancelled: (updated: AppointmentDto) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Cancel appointment" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-ink">
          {appointment.appointmentType.name} with {appointment.doctor.displayName} on{' '}
          {formatLocalDateTime(appointment.startsAtLocal)}.
        </p>
        {error && <Alert>{error}</Alert>}
        <TextAreaField
          label="Reason (optional, no medical details)"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            Keep appointment
          </Button>
          <Button
            variant="danger"
            className="min-h-11"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onCancelled(await appointmentsApi.cancel(appointment.id, { reason }));
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
                );
                setBusy(false);
              }
            }}
          >
            Cancel appointment
          </Button>
        </div>
      </div>
    </Modal>
  );
}
