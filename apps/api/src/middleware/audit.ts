import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { requestContext, writeAudit, type AuditDb, type AuditEntry } from '../lib/audit.js';

/** Audit writer pre-filled with the request's actor, IP and user agent. */
export type RequestAudit = (
  entry: Omit<AuditEntry, 'actorUserId' | 'ip' | 'userAgent'>,
  db?: AuditDb,
) => Promise<void>;

/**
 * Attaches `req.audit` (SPEC §6.2, §11). Handlers await it before responding,
 * passing a transaction client for writes, so a record is never returned or
 * changed without its audit row.
 */
export function auditContext(prisma: PrismaClient): RequestHandler {
  return (req, _res, next) => {
    req.audit = (entry, db = prisma) =>
      writeAudit(db, {
        ...entry,
        actorUserId: (req.auth ?? req.pendingAuth)?.user.id ?? null,
        ...requestContext(req),
      });
    next();
  };
}
