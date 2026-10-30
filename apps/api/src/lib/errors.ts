import type { ErrorCode } from '@clinic/shared';

/** An error whose message is safe to show to the client. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = "You don't have access to this resource") {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static conflict(message = 'Conflict') {
    return new AppError(409, 'CONFLICT', message);
  }
}
