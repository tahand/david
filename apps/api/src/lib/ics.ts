/**
 * Minimal iCalendar (RFC 5545) invitations for appointment emails. One event
 * per file; times are UTC so calendar apps convert to the reader's zone.
 * Pure: no clock or I/O beyond the `now` it is given.
 */

export interface CalendarEvent {
  /** Stable across updates so calendar apps replace rather than duplicate the event. */
  uid: string;
  /** Must increase with every update to the same UID. */
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  url?: string;
  now: Date;
}

const CRLF = '\r\n';

/** 2026-11-02T09:00:00.000Z → 20261102T090000Z */
export const icsDateTime = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon, comma and newlines. */
export const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line to at most 75 octets, continuing with CRLF + space (§3.1). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    // Continuation lines start with a space, which counts towards their 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

export function buildIcs(event: CalendarEvent): string {
  const cancelled = event.method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clinic Appointments//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${event.method}`,
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${icsDateTime(event.now)}`,
    `DTSTART:${icsDateTime(event.start)}`,
    `DTEND:${icsDateTime(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    ...(event.url ? [`URL:${event.url}`] : []),
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
