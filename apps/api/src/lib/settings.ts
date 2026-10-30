import type { PrismaClient } from '@prisma/client';
import { DEFAULT_CLINIC_SETTINGS, clinicSettingsSchema, type ClinicSettings } from '@clinic/shared';

/** Clinic settings with defaults for missing or invalid keys. */
export async function getClinicSettings(prisma: PrismaClient): Promise<ClinicSettings> {
  const rows = await prisma.clinicSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_CLINIC_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_CLINIC_SETTINGS) merged[row.key] = row.value;
  }
  const parsed = clinicSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_CLINIC_SETTINGS;
}
