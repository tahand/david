import type { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Never include secrets, tokens or medical data. */
  metadata?: Prisma.InputJsonObject;
}

export type AuditDb = PrismaClient | Prisma.TransactionClient;

/** Appends to `audit_logs` (SPEC §6.2, §11). */
export async function writeAudit(db: AuditDb, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent?.slice(0, 500) ?? null,
      metadata: entry.metadata ?? undefined,
    },
  });
}

/** Request context for audit rows. */
export const requestContext = (req: Request) => ({
  ip: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});
