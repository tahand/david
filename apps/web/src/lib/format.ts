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

export const fullName = (p: {
  firstName: string;
  lastName: string;
  preferredName?: string | null;
}) =>
  p.preferredName
    ? `${p.firstName} (${p.preferredName}) ${p.lastName}`
    : `${p.firstName} ${p.lastName}`;
