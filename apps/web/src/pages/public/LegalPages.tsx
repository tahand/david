import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AuthLayout, useClinicInfo } from '../../components/layouts';

/**
 * Placeholder legal texts. The clinic must supply the real privacy notice and
 * terms (see docs/COMPLIANCE.md, phase 11); the version shown is what patients
 * consent to at registration.
 */
function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const clinic = useClinicInfo();
  return (
    <AuthLayout title={title}>
      <div className="flex flex-col gap-3 text-ink">
        {children}
        <p className="text-sm text-ink-muted">Version {clinic.data?.consentVersion ?? '—'}</p>
        <Link to="/register" className="text-link underline">
          Back
        </Link>
      </div>
    </AuthLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice">
      <p>
        This is placeholder text. Before going live, the clinic must replace it with its privacy
        notice describing what personal and health data is collected, why, the lawful basis, how
        long it is kept, who it is shared with, and how to exercise your data-protection rights.
      </p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        This is placeholder text. Before going live, the clinic must replace it with its terms of
        use for the online appointment service.
      </p>
    </LegalPage>
  );
}
