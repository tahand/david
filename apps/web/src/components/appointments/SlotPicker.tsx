import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { DoctorProfile, Slot } from '@clinic/shared';
import { doctorKeys, doctorsApi } from '../../api/doctors';
import { addCalendarDays, clinicToday, formatDayDate } from '../../lib/format';
import { Alert, Button, Spinner } from '../forms';

export interface PickedSlot extends Slot {
  doctorId: string;
  doctorName: string;
}

/** How many weeks ahead the picker pages; the API applies the real booking horizon. */
const MAX_WEEKS_AHEAD = 12;

/**
 * Free slots for one or more doctors, a week at a time, grouped by clinic-local
 * day. With several doctors ("any doctor") each time shows who it is with.
 */
export function SlotPicker({
  doctors,
  typeId,
  timezone,
  selected,
  onSelect,
}: {
  doctors: DoctorProfile[];
  typeId: string;
  timezone: string;
  selected: PickedSlot | null;
  onSelect: (slot: PickedSlot) => void;
}) {
  const today = clinicToday(timezone);
  const [week, setWeek] = useState(0);
  const from = addCalendarDays(today, week * 7);
  const to = addCalendarDays(from, 6);

  const results = useQueries({
    queries: doctors.map((d) => ({
      queryKey: doctorKeys.slots(d.id, typeId, from, to),
      queryFn: () => doctorsApi.slots(d.id, typeId, from, to),
    })),
  });
  const pending = results.some((r) => r.isPending);
  const failed = results.some((r) => r.isError);

  const slots: PickedSlot[] = results
    .flatMap((r, i) =>
      (r.data?.slots ?? []).map((s) => ({
        ...s,
        doctorId: doctors[i]!.id,
        doctorName: doctors[i]!.displayName,
      })),
    )
    .sort(
      (a, b) => a.startsAt.localeCompare(b.startsAt) || a.doctorName.localeCompare(b.doctorName),
    );
  const byDate = new Map<string, PickedSlot[]>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const showDoctor = doctors.length > 1;
  const isSelected = (s: PickedSlot) =>
    selected?.startsAt === s.startsAt && selected.doctorId === s.doctorId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={week === 0}
          onClick={() => setWeek((w) => w - 1)}
        >
          Previous week
        </Button>
        <p className="font-medium text-ink" aria-live="polite">
          {formatDayDate(from)} – {formatDayDate(to)}
        </p>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={week >= MAX_WEEKS_AHEAD}
          onClick={() => setWeek((w) => w + 1)}
        >
          Next week
        </Button>
      </div>
      {pending ? (
        <Spinner label="Loading available times" />
      ) : failed ? (
        <Alert>We couldn't load available times. Please try again.</Alert>
      ) : byDate.size === 0 ? (
        <p className="text-ink">No times are available this week. Try the next week.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {[...byDate].map(([date, daySlots]) => (
            <fieldset key={date}>
              <legend className="mb-2 font-semibold text-heading">{formatDayDate(date)}</legend>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((s) => (
                  <button
                    key={`${s.doctorId}-${s.startsAt}`}
                    type="button"
                    aria-pressed={isSelected(s)}
                    onClick={() => onSelect(s)}
                    className={`min-h-11 rounded-md border px-3 text-base ${
                      isSelected(s)
                        ? 'border-brand bg-brand text-on-brand'
                        : 'border-line-strong bg-card text-ink hover:bg-page'
                    }`}
                  >
                    {s.time}
                    {showDoctor && <span className="text-sm"> · {s.doctorName}</span>}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      <p className="text-sm text-ink-muted">Times are shown in clinic time ({timezone}).</p>
    </div>
  );
}
