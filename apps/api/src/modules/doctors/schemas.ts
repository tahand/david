import { z } from 'zod';
import { availabilityUpdateSchema, exceptionCreateSchema, slotsQuerySchema } from '@clinic/shared';

export { availabilityUpdateSchema, exceptionCreateSchema, slotsQuerySchema };

export type AvailabilityUpdate = z.output<typeof availabilityUpdateSchema>;
export type ExceptionCreate = z.output<typeof exceptionCreateSchema>;
export type SlotsQuery = z.output<typeof slotsQuerySchema>;

/** A malformed ID can't name a record, so it is a 404 rather than a validation error. */
export function parseId(raw: string | undefined): string | null {
  const parsed = z.uuid().safeParse(raw ?? '');
  return parsed.success ? parsed.data : null;
}
