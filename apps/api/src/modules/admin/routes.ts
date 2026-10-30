import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError } from '../../lib/errors.js';
import { authOf, authorize } from '../../middleware/auth.js';
import {
  appointmentTypeCreateSchema,
  appointmentTypeUpdateSchema,
  auditLogQuerySchema,
  parseId,
  settingsUpdateSchema,
  staffCreateSchema,
  userListQuerySchema,
  userUpdateSchema,
} from './schemas.js';
import type { AdminService } from './service.js';

const idParam = (req: Request, what: string): string => {
  const id = parseId(req.params.id);
  if (!id) throw AppError.notFound(`${what} not found`);
  return id;
};

/** /api/admin (SPEC §9 Admin). Every route requires an admin with MFA. */
export function adminRoutes({ service }: { service: AdminService }): Router {
  const r = Router();

  // Admin data (staff emails, audit trail) must never be cached.
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ------------------------------------------------------------------ users

  r.get(
    '/users',
    ...authorize('admin:users'),
    asyncHandler(async (req, res) => {
      res.json(await service.listUsers(userListQuerySchema.parse(req.query)));
    }),
  );

  r.post(
    '/users',
    ...authorize('admin:users'),
    asyncHandler(async (req, res) => {
      const input = staffCreateSchema.parse(req.body);
      res.status(201).json(await service.createStaff(input, req.audit));
    }),
  );

  r.get(
    '/users/:id',
    ...authorize('admin:users'),
    asyncHandler(async (req, res) => {
      res.json(await service.getUser(idParam(req, 'User')));
    }),
  );

  r.patch(
    '/users/:id',
    ...authorize('admin:users'),
    asyncHandler(async (req, res) => {
      const id = idParam(req, 'User');
      const input = userUpdateSchema.parse(req.body);
      res.json(await service.updateUser(authOf(req).user, id, input, req.audit));
    }),
  );

  r.post(
    '/users/:id/password-reset',
    ...authorize('admin:users'),
    asyncHandler(async (req, res) => {
      const id = idParam(req, 'User');
      res.json(await service.forcePasswordReset(authOf(req).user, id, req.audit));
    }),
  );

  r.post(
    '/users/:id/mfa-reset',
    ...authorize('admin:users'),
    asyncHandler(async (req, res) => {
      const id = idParam(req, 'User');
      res.json(await service.resetMfa(authOf(req).user, id, req.audit));
    }),
  );

  // ------------------------------------------------------- appointment types

  r.get(
    '/appointment-types',
    ...authorize('admin:appointment-types'),
    asyncHandler(async (_req, res) => {
      res.json({ appointmentTypes: await service.listAppointmentTypes() });
    }),
  );

  r.post(
    '/appointment-types',
    ...authorize('admin:appointment-types'),
    asyncHandler(async (req, res) => {
      const input = appointmentTypeCreateSchema.parse(req.body);
      res.status(201).json(await service.createAppointmentType(input, req.audit));
    }),
  );

  r.patch(
    '/appointment-types/:id',
    ...authorize('admin:appointment-types'),
    asyncHandler(async (req, res) => {
      const id = idParam(req, 'Appointment type');
      const input = appointmentTypeUpdateSchema.parse(req.body);
      res.json(await service.updateAppointmentType(id, input, req.audit));
    }),
  );

  // ---------------------------------------------------------------- settings

  r.get(
    '/settings',
    ...authorize('admin:settings'),
    asyncHandler(async (_req, res) => {
      res.json(await service.getSettings());
    }),
  );

  r.put(
    '/settings',
    ...authorize('admin:settings'),
    asyncHandler(async (req, res) => {
      const input = settingsUpdateSchema.parse(req.body);
      res.json(await service.updateSettings(input, req.audit));
    }),
  );

  // --------------------------------------------------------------- audit log

  r.get(
    '/audit-logs',
    ...authorize('admin:audit-logs'),
    asyncHandler(async (req, res) => {
      res.json(await service.listAuditLogs(auditLogQuerySchema.parse(req.query), req.audit));
    }),
  );

  return r;
}
