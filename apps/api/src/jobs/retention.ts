import type { PrismaClient } from '@prisma/client';
import { writeAudit } from '../lib/audit.js';
import { getClinicSettings } from '../lib/settings.js';

const BATCH = 100;

/**
 * Permanently erases patients soft-deleted more than `retentionYears` ago
 * (SPEC §6.2), via the `erase_patient` database function, which re-checks the
 * rule itself and refuses anything that isn't due. Each erasure is audited by
 * ID only. Returns how many patients were erased.
 */
export async function eraseExpiredPatients(deps: {
  prisma: PrismaClient;
  now?: Date;
}): Promise<number> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const { retentionYears } = await getClinicSettings(prisma);
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);

  const candidates = await prisma.patient.findMany({
    // Same rule as erase_patient, so ineligible patients don't fill every batch.
    where: { deletedAt: { lt: cutoff }, appointments: { none: { endsAt: { gte: cutoff } } } },
    select: { id: true },
    orderBy: { deletedAt: 'asc' },
    take: BATCH,
  });
  let erased = 0;
  for (const { id } of candidates) {
    await prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ erased: boolean }[]>`
        SELECT erase_patient(${id}::uuid, ${retentionYears}::integer) AS erased`;
      if (!row?.erased) return;
      await writeAudit(tx, {
        action: 'patient.erase',
        entityType: 'patient',
        entityId: id,
        metadata: { retentionYears },
      });
      erased += 1;
    });
  }
  return erased;
}
