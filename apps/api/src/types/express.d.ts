import type { RequestAudit } from '../middleware/audit.js';
import type { AuthContext } from '../modules/auth/sessions.js';

declare global {
  namespace Express {
    interface Request {
      /** Fully authenticated session (MFA complete where enabled). */
      auth?: AuthContext;
      /** Password accepted, waiting for the MFA code (SPEC §4.4). */
      pendingAuth?: AuthContext;
      /** Request-scoped audit writer, set by `auditContext()` on every /api request. */
      audit: RequestAudit;
    }
  }
}

export {};
