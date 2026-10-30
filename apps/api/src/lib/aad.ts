/**
 * Additional authenticated data for encrypted columns (lib/crypto.ts). Binding
 * each envelope to its table, column and row means a ciphertext copied into
 * another row or column fails to decrypt. Keep these stable: changing one
 * makes existing rows unreadable.
 */
export const aad = {
  patientHealthId: (patientId: string) => `patients.health_id:${patientId}`,
  patientEmergencyContact: (patientId: string) => `patients.emergency_contact:${patientId}`,
  patientMedicalSummary: (patientId: string) => `patients.medical_summary:${patientId}`,
  appointmentReason: (appointmentId: string) => `appointments.reason_for_visit:${appointmentId}`,
  clinicalNoteBody: (noteId: string) => `clinical_notes.body:${noteId}`,
};
