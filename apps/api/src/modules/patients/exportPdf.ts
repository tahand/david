import PDFDocument from 'pdfkit';
import type { PatientExport } from '@clinic/shared';

const SEVERITY: Record<string, string> = {
  mild: 'mild',
  moderate: 'moderate',
  severe: 'severe',
  unknown: 'severity unknown',
};

const dateTime = (iso: string) => iso.replace('T', ' ').slice(0, 16) + ' UTC';
const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ');

/**
 * Human-readable copy of a patient's data export (SPEC §6.2). Uses the
 * built-in Helvetica font, so characters outside Latin-1 may not render; the
 * JSON export is the complete, machine-readable copy.
 */
export function renderExportPdf(data: PatientExport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: `Your data - ${data.clinic}`, Author: data.clinic },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const heading = (text: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).text(text).moveDown(0.3);
      doc.font('Helvetica').fontSize(10);
    };
    const row = (label: string, value: string | boolean | null | undefined) => {
      const shown = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value || '-';
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(shown);
    };
    const bullets = (items: string[], empty: string) => {
      if (items.length === 0) doc.text(empty);
      for (const item of items) doc.text(`- ${item}`, { indent: 10 });
    };

    const p = data.profile;
    doc.font('Helvetica-Bold').fontSize(18).text(`${data.clinic}: your data`);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(`Generated ${dateTime(data.generatedAt)}`);

    heading('Account');
    row('Email', data.account.email);
    row('Email confirmed', data.account.emailVerified);
    row('Two-step verification', data.account.mfaEnabled);
    row('Account created', dateTime(data.account.createdAt));
    row('Last sign-in', data.account.lastLoginAt && dateTime(data.account.lastLoginAt));

    heading('Personal details');
    row('Name', joined(p.title, p.firstName, p.middleNames, p.lastName).replaceAll(',', ''));
    row('Preferred name', p.preferredName);
    row('Date of birth', p.dateOfBirth);
    row('Sex at birth', p.sexAtBirth?.replace('_', ' '));
    row('Gender identity', p.genderIdentity);
    row('Pronouns', p.pronouns);
    row(data.healthIdLabel, p.healthId);
    row('Preferred language', p.preferredLanguage);
    row('Interpreter required', p.interpreterRequired);

    heading('Contact details');
    row('Mobile phone', p.phoneMobile);
    row('Other phone', p.phoneAlt);
    row('Address', joined(p.addressLine1, p.addressLine2, p.city, p.region, p.postcode, p.country));
    row('Preferred contact', p.preferredContact);
    row('Appointment reminders', p.reminderConsent);
    row('Consent recorded', p.consentAt && `${p.consentVersion ?? ''} on ${dateTime(p.consentAt)}`);

    heading('Emergency contact');
    const ec = p.emergencyContact;
    if (ec) {
      row('Name', ec.name);
      row('Relationship', ec.relationship);
      row('Phone', ec.phone);
      row('Email', ec.email);
    } else {
      doc.text('None recorded');
    }

    heading('Medical summary');
    doc.font('Helvetica-Bold').text('Allergies').font('Helvetica');
    bullets(
      p.medicalSummary.allergies.map((a) =>
        joined(a.substance, a.reaction, SEVERITY[a.severity] ?? a.severity),
      ),
      'None recorded',
    );
    doc.moveDown(0.3).font('Helvetica-Bold').text('Medications').font('Helvetica');
    bullets(
      p.medicalSummary.medications.map((m) => joined(m.name, m.dose, m.frequency)),
      'None recorded',
    );
    doc.moveDown(0.3).font('Helvetica-Bold').text('Long-term conditions').font('Helvetica');
    bullets(
      p.medicalSummary.conditions.map((c) =>
        joined(c.condition, c.diagnosedDate && `diagnosed ${c.diagnosedDate}`, c.notes),
      ),
      'None recorded',
    );
    doc.moveDown(0.3);
    row('GP', p.gpDetails && joined(p.gpDetails.name, p.gpDetails.practice, p.gpDetails.phone));
    row('Accessibility needs', p.accessibilityNeeds);

    heading('Appointments');
    bullets(
      data.appointments.map((a) =>
        joined(
          dateTime(a.startsAt),
          a.appointmentType,
          a.doctor,
          a.status.replaceAll('_', ' '),
          a.reasonForVisit && `reason: ${a.reasonForVisit}`,
        ),
      ),
      'No appointments',
    );

    doc.end();
  });
}
