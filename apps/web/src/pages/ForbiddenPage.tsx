import { Link } from 'react-router';

/** Shown for 403 responses and role mismatches (SPEC §10). */
export function ForbiddenPage() {
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-heading">You don't have access</h1>
      <p className="mt-3 text-ink">
        Your account doesn't have permission to view this page. If you think this is a mistake,
        contact the clinic.
      </p>
      <Link className="mt-6 inline-block text-link underline" to="/">
        Go to your home page
      </Link>
    </main>
  );
}
