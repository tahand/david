import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/client';

/**
 * Maps a server VALIDATION_ERROR onto form fields. Returns a message for the
 * form-level error area when something couldn't be attached to a field.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.code === 'VALIDATION_ERROR' && err.details.length > 0) {
    let unmatched: string | null = null;
    for (const d of err.details) {
      const field = fields.find((f) => f === d.path);
      if (field) setError(field, { type: 'server', message: d.message });
      else unmatched ??= d.message;
    }
    return unmatched;
  }
  return err.message;
}
