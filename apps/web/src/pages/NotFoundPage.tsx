import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-heading">Page not found</h1>
      <Link className="mt-4 inline-block text-link underline" to="/">
        Go to the home page
      </Link>
    </main>
  );
}
