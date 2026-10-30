import { useRef, useState } from 'react';
import {
  WEEKDAYS_MONDAY_FIRST,
  WEEKDAY_NAMES,
  availabilityUpdateSchema,
  type AvailabilityBlock,
  type AvailabilityRuleDto,
} from '@clinic/shared';
import { ApiError } from '../../api/client';
import { Alert, Button, TextField } from '../forms';

interface Block extends AvailabilityBlock {
  key: string;
}
type BlockErrors = Record<string, { startTime?: string; endTime?: string; weekday?: string }>;

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Monday-first order, then by start time — the order rows are sent and errors come back in. */
const ordered = (blocks: Block[]) =>
  WEEKDAYS_MONDAY_FIRST.flatMap((wd) =>
    blocks.filter((b) => b.weekday === wd).sort((a, b) => a.startTime.localeCompare(b.startTime)),
  );

/**
 * Weekly working hours (SPEC §7.1): any number of blocks per weekday. Saving
 * replaces the whole schedule from today; booked appointments are unaffected.
 */
export function WeeklyHoursEditor({
  rules,
  onSave,
}: {
  rules: AvailabilityRuleDto[];
  onSave: (blocks: AvailabilityBlock[]) => Promise<void>;
}) {
  const nextKey = useRef(0);
  const newKey = () => `new-${nextKey.current++}`;
  const [blocks, setBlocks] = useState<Block[]>(() =>
    rules.map((r) => ({
      key: r.id,
      weekday: r.weekday,
      startTime: r.startTime,
      endTime: r.endTime,
    })),
  );
  const [errors, setErrors] = useState<BlockErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const change = (next: Block[]) => {
    setBlocks(next);
    setSaved(false);
  };
  const update = (key: string, patch: Partial<Block>) =>
    change(blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const addBlock = (weekday: number) => {
    const day = ordered(blocks).filter((b) => b.weekday === weekday);
    const last = day[day.length - 1];
    const start = last ? Math.min(toMinutes(last.endTime) + 60, 22 * 60) : 9 * 60;
    const end = last ? Math.min(start + 3 * 60, 23 * 60 + 59) : 17 * 60;
    change([...blocks, { key: newKey(), weekday, startTime: toTime(start), endTime: toTime(end) }]);
  };

  const copyMondayToWeekdays = () => {
    const monday = blocks.filter((b) => b.weekday === 1);
    const others = blocks.filter((b) => b.weekday === 0 || b.weekday === 6 || b.weekday === 1);
    const copies = [2, 3, 4, 5].flatMap((weekday) =>
      monday.map((b) => ({ ...b, key: newKey(), weekday })),
    );
    change([...others, ...copies]);
  };

  /** Maps "rules.<i>.<field>" issues back onto the block shown at that position. */
  const applyIssues = (rows: Block[], issues: { path?: string; message: string }[]) => {
    const next: BlockErrors = {};
    let unmatched: string | null = null;
    for (const issue of issues) {
      const [, index, field] = issue.path?.split('.') ?? [];
      const row = rows[Number(index)];
      if (row && (field === 'startTime' || field === 'endTime' || field === 'weekday')) {
        next[row.key] = { ...next[row.key], [field]: issue.message };
      } else {
        unmatched ??= issue.message;
      }
    }
    setErrors(next);
    setFormError(unmatched);
  };

  const save = async () => {
    const rows = ordered(blocks);
    const payload = {
      rules: rows.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
    };
    setSaved(false);
    const parsed = availabilityUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      applyIssues(
        rows,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data.rules);
      setErrors({});
      setFormError(null);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR')
        applyIssues(rows, err.details);
      else
        setFormError(
          err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        );
    } finally {
      setSaving(false);
    }
  };

  const hasMonday = blocks.some((b) => b.weekday === 1);

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {saved && <Alert tone="success">Weekly hours saved. They apply from today.</Alert>}
        {formError && <Alert>{formError}</Alert>}
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {WEEKDAYS_MONDAY_FIRST.map((wd) => {
          const day = ordered(blocks).filter((b) => b.weekday === wd);
          const name = WEEKDAY_NAMES[wd];
          return (
            <li key={wd} className="rounded-md border border-line p-3 sm:p-4">
              <fieldset className="flex flex-col gap-3">
                <legend className="font-semibold text-ink">{name}</legend>
                {day.length === 0 && <p className="text-sm text-ink-muted">Not working</p>}
                {day.map((b, i) => {
                  const err = errors[b.key];
                  return (
                    <div key={b.key} className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
                      <TextField
                        label="From"
                        aria-label={`${name} hours ${i + 1} from`}
                        type="time"
                        step={300}
                        value={b.startTime}
                        error={err?.startTime}
                        onChange={(e) => update(b.key, { startTime: e.target.value })}
                      />
                      <TextField
                        label="Until"
                        aria-label={`${name} hours ${i + 1} until`}
                        type="time"
                        step={300}
                        value={b.endTime}
                        error={err?.endTime}
                        onChange={(e) => update(b.key, { endTime: e.target.value })}
                      />
                      <Button
                        variant="link"
                        className="mt-6 min-h-11 text-sm"
                        onClick={() => change(blocks.filter((x) => x.key !== b.key))}
                      >
                        Remove
                        <span className="sr-only">
                          {' '}
                          {name} hours {i + 1}
                        </span>
                      </Button>
                    </div>
                  );
                })}
                <Button variant="secondary" className="self-start" onClick={() => addBlock(wd)}>
                  Add hours<span className="sr-only"> on {name}</span>
                </Button>
              </fieldset>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button loading={saving} onClick={save} className="w-full sm:w-auto">
          Save weekly hours
        </Button>
        {hasMonday && (
          <Button variant="secondary" onClick={copyMondayToWeekdays} className="w-full sm:w-auto">
            Copy Monday to Tuesday–Friday
          </Button>
        )}
      </div>
    </div>
  );
}
