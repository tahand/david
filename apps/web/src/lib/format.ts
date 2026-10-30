const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "1990-01-31" → "31 Jan 1990". Calendar dates are formatted in UTC so they never shift a day. */
export function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : dateFormat.format(date);
}

const dayDateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "2026-11-02" → "Mon 2 Nov 2026". */
export function formatDayDate(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDate : dayDateFormat.format(date).replace(',', '');
}

/**
 * A clinic-local range ("YYYY-MM-DDTHH:MM" strings from the API) for display:
 * - "Mon 2 Nov 2026, 09:00–13:00" within one day
 * - "Mon 2 Nov 2026 – Wed 4 Nov 2026 (all day)" for whole days
 * - "Mon 2 Nov 2026, 18:00 – Tue 3 Nov 2026, 02:00" otherwise
 */
export function formatLocalRange(startsAt: string, endsAt: string): string {
  const [startDate, startTime] = startsAt.split('T') as [string, string];
  const [endDate, endTime] = endsAt.split('T') as [string, string];
  if (startTime === '00:00' && endTime === '00:00') {
    const lastDay = addCalendarDays(endDate, -1);
    return lastDay === startDate
      ? `${formatDayDate(startDate)} (all day)`
      : `${formatDayDate(startDate)} – ${formatDayDate(lastDay)} (all day)`;
  }
  if (startDate === endDate) return `${formatDayDate(startDate)}, ${startTime}–${endTime}`;
  return `${formatDayDate(startDate)}, ${startTime} – ${formatDayDate(endDate)}, ${endTime}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" strings, in UTC so DST can't shift the day. */
export function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const fullName = (p: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
}) =>
  p.preferredName
    ? `${p.firstName} (${p.preferredName}) ${p.lastName}`
    : `${p.firstName} ${p.lastName}`;
