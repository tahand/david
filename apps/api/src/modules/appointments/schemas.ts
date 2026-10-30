import type { z } from 'zod';
import {
  appointmentListQuerySchema,
  bookingCreateSchema,
  cancelSchema,
  clinicalNoteCreateSchema,
  rescheduleSchema,
  statusUpdateSchema,
} from '@clinic/shared';

export {
  appointmentListQuerySchema,
  bookingCreateSchema,
  cancelSchema,
  clinicalNoteCreateSchema,
  rescheduleSchema,
  statusUpdateSchema,
};

export type AppointmentListFilter = z.output<typeof appointmentListQuerySchema>;
export type BookingCreate = z.output<typeof bookingCreateSchema>;
export type Reschedule = z.output<typeof rescheduleSchema>;
export type Cancel = z.output<typeof cancelSchema>;
export type StatusChange = z.output<typeof statusUpdateSchema>;
export type ClinicalNoteCreate = z.output<typeof clinicalNoteCreateSchema>;
