import { Router, type Request } from 'express';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError } from '../../lib/errors.js';
import { authOf, authorize } from '../../middleware/auth.js';
import { renderExportPdf } from './exportPdf.js';
import {
  exportFormatSchema,
  medicalSummaryUpdateSchema,
  parsePatientId,
  patientCreateSchema,
  patientSearchQuerySchema,
  patientSelfUpdateSchema,
  patientStaffUpdateSchema,
} from './schemas.js';
import type { PatientService } from './service.js';

const idParam = (req: Request): string => {
  const id = parsePatientId(req.params.id ?? '');
  if (!id) throw AppError.notFound('Patient not found');
  return id;
};

/** /api/patients (SPEC §9). */
export function patientRoutes({ service }: { service: PatientService }): Router {
  const r = Router();

  // Patient data must never be cached by the browser or a proxy.
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.get(
    '/me',
    ...authorize('patient:self'),
    asyncHandler(async (req, res) => {
      res.json(await service.getSelf(authOf(req).user, req.audit));
    }),
  );

  r.patch(
    '/me',
    ...authorize('patient:self'),
    asyncHandler(async (req, res) => {
      const input = patientSelfUpdateSchema.parse(req.body);
      res.json(await service.updateSelf(authOf(req).user, input, req.audit));
    }),
  );

  r.get(
    '/me/export',
    ...authorize('patient:self'),
    asyncHandler(async (req, res) => {
      const { format } = exportFormatSchema.parse(req.query);
      const data = await service.exportSelf(authOf(req).user, req.audit, format);
      const filename = `my-data-${data.generatedAt.slice(0, 10)}.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (format === 'pdf') {
        res.type('application/pdf').send(await renderExportPdf(data));
      } else {
        res.type('application/json').send(JSON.stringify(data, null, 2));
      }
    }),
  );

  r.get(
    '/',
    ...authorize('patients:read'),
    asyncHandler(async (req, res) => {
      const query = patientSearchQuerySchema.parse(req.query);
      res.json(await service.search(authOf(req).user, query, req.audit));
    }),
  );

  r.post(
    '/',
    ...authorize('patients:write'),
    asyncHandler(async (req, res) => {
      const input = patientCreateSchema.parse(req.body);
      res.status(201).json(await service.create(input, req.audit));
    }),
  );

  r.get(
    '/:id',
    ...authorize('patients:read'),
    asyncHandler(async (req, res) => {
      res.json(await service.getById(authOf(req).user, idParam(req), req.audit));
    }),
  );

  r.patch(
    '/:id',
    ...authorize('patients:write'),
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = patientStaffUpdateSchema.parse(req.body);
      res.json(await service.update(authOf(req).user, id, input, req.audit));
    }),
  );

  r.put(
    '/:id/medical-summary',
    ...authorize('patients:medical:write'),
    asyncHandler(async (req, res) => {
      const id = idParam(req);
      const input = medicalSummaryUpdateSchema.parse(req.body);
      res.json(await service.replaceMedicalSummary(authOf(req).user, id, input, req.audit));
    }),
  );

  return r;
}
