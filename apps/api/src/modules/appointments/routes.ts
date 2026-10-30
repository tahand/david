import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError } from '../../lib/errors.js';
import { authOf, authorize, authorizeAny } from '../../middleware/auth.js';
import { parseId } from '../doctors/schemas.js';
import {
  appointmentListQuerySchema,
  bookingCreateSchema,
  cancelSchema,
  clinicalNoteCreateSchema,
  rescheduleSchema,
  statusUpdateSchema,
} from './schemas.js';
import type { AppointmentService } from './service.js';

const appointmentId = (req: Request): string => {
  const id = parseId(req.params.id);
  if (!id) throw AppError.notFound('Appointment not found');
  return id;
};

/** Patients book for themselves; reception and admins for anyone. Doctors don't book. */
const canBook = () => authorizeAny('appointments:book:self', 'appointments:book:any');

/** /api/appointments (SPEC §9). Responses carry patient data, so none are cached. */
export function appointmentRoutes({ service }: { service: AppointmentService }): Router {
  const r = Router();
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get(
    '/',
    ...authorize('appointments:read'),
    asyncHandler(async (req, res) => {
      const query = appointmentListQuerySchema.parse(req.query);
      res.json(await service.list(authOf(req).user, query, req.audit));
    }),
  );

  r.post(
    '/',
    ...canBook(),
    asyncHandler(async (req, res) => {
      const input = bookingCreateSchema.parse(req.body);
      res.status(201).json(await service.book(authOf(req).user, input, req.audit));
    }),
  );

  r.get(
    '/:id',
    ...authorize('appointments:read'),
    asyncHandler(async (req, res) => {
      res.json(await service.get(authOf(req).user, appointmentId(req), req.audit));
    }),
  );

  r.patch(
    '/:id/reschedule',
    ...canBook(),
    asyncHandler(async (req, res) => {
      const id = appointmentId(req);
      const input = rescheduleSchema.parse(req.body);
      res.json(await service.reschedule(authOf(req).user, id, input, req.audit));
    }),
  );

  r.patch(
    '/:id/cancel',
    ...canBook(),
    asyncHandler(async (req, res) => {
      const id = appointmentId(req);
      const input = cancelSchema.parse(req.body);
      res.json(await service.cancel(authOf(req).user, id, input, req.audit));
    }),
  );

  r.patch(
    '/:id/status',
    ...authorize('appointments:status'),
    asyncHandler(async (req, res) => {
      const id = appointmentId(req);
      const input = statusUpdateSchema.parse(req.body);
      res.json(await service.updateStatus(authOf(req).user, id, input, req.audit));
    }),
  );

  r.get(
    '/:id/notes',
    ...authorize('clinical-notes:read'),
    asyncHandler(async (req, res) => {
      res.json({ notes: await service.listNotes(authOf(req).user, appointmentId(req), req.audit) });
    }),
  );

  r.post(
    '/:id/notes',
    ...authorize('clinical-notes:write'),
    asyncHandler(async (req, res) => {
      const id = appointmentId(req);
      const input = clinicalNoteCreateSchema.parse(req.body);
      res.status(201).json(await service.addNote(authOf(req).user, id, input, req.audit));
    }),
  );

  return r;
}

/** GET /api/appointment-types — active types for the booking wizard. */
export function appointmentTypeRoutes({ service }: { service: AppointmentService }): Router {
  const r = Router();
  r.get(
    '/',
    ...authorize('doctors:read'),
    asyncHandler(async (req, res) => {
      res.json({ appointmentTypes: await service.listTypes(authOf(req).user) });
    }),
  );
  return r;
}
