import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError } from '../../lib/errors.js';
import { authOf, authorize } from '../../middleware/auth.js';
import {
  availabilityUpdateSchema,
  exceptionCreateSchema,
  parseId,
  slotsQuerySchema,
} from './schemas.js';
import type { DoctorService } from './service.js';

const doctorId = (req: Request): string => {
  const id = parseId(req.params.id);
  if (!id) throw AppError.notFound('Doctor not found');
  return id;
};

/** /api/doctors (SPEC §9). */
export function doctorRoutes({ service }: { service: DoctorService }): Router {
  const r = Router();

  r.get(
    '/',
    ...authorize('doctors:read'),
    asyncHandler(async (req, res) => {
      res.json({ doctors: await service.list(authOf(req).user) });
    }),
  );

  // The signed-in doctor's own profile, so the UI can find their doctor ID.
  r.get(
    '/me',
    ...authorize('availability:manage'),
    asyncHandler(async (req, res) => {
      res.json(await service.getSelf(authOf(req).user));
    }),
  );

  r.get(
    '/:id/slots',
    ...authorize('doctors:read'),
    asyncHandler(async (req, res) => {
      const id = doctorId(req);
      const query = slotsQuerySchema.parse(req.query);
      res.setHeader('Cache-Control', 'no-store');
      res.json(await service.slots(authOf(req).user, id, query));
    }),
  );

  r.get(
    '/:id/availability',
    ...authorize('availability:manage'),
    asyncHandler(async (req, res) => {
      res.json(await service.getAvailability(authOf(req).user, doctorId(req)));
    }),
  );

  r.put(
    '/:id/availability',
    ...authorize('availability:manage'),
    asyncHandler(async (req, res) => {
      const id = doctorId(req);
      const input = availabilityUpdateSchema.parse(req.body);
      res.json(await service.replaceRules(authOf(req).user, id, input, req.audit));
    }),
  );

  r.post(
    '/:id/exceptions',
    ...authorize('availability:manage'),
    asyncHandler(async (req, res) => {
      const id = doctorId(req);
      const input = exceptionCreateSchema.parse(req.body);
      res.status(201).json(await service.addException(authOf(req).user, id, input, req.audit));
    }),
  );

  r.delete(
    '/:id/exceptions/:exId',
    ...authorize('availability:manage'),
    asyncHandler(async (req, res) => {
      const id = doctorId(req);
      const exId = parseId(req.params.exId);
      if (!exId) throw AppError.notFound('Exception not found');
      await service.deleteException(authOf(req).user, id, exId, req.audit);
      res.status(204).end();
    }),
  );

  return r;
}
