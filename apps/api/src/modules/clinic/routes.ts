import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { PublicClinicInfo } from '@clinic/shared';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { getClinicSettings } from '../../lib/settings.js';

/**
 * GET /api/clinic — public branding for the login and registration screens.
 * Exposes only non-sensitive display settings.
 */
export function clinicRoutes(prisma: PrismaClient, timezone: string): Router {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (_req, res) => {
      const s = await getClinicSettings(prisma);
      const body: PublicClinicInfo = {
        clinicName: s.clinicName,
        clinicPhone: s.clinicPhone,
        clinicAddress: s.clinicAddress,
        consentVersion: s.consentVersion,
        healthIdLabel: s.healthIdLabel,
        timezone,
        theme: s.theme,
      };
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(body);
    }),
  );
  return router;
}
