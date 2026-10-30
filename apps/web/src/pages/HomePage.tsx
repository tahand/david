import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@clinic/shared';

/** Placeholder landing page until the auth screens arrive in phase 4. */
export function HomePage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const res = await fetch('/api/health', { credentials: 'same-origin' });
      return (await res.json()) as HealthResponse;
    },
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Clinic Appointments</h1>
      <p className="text-slate-700" role="status">
        API status:{' '}
        {health.isPending ? 'checking…' : health.data?.status === 'ok' ? 'online' : 'unavailable'}
      </p>
    </main>
  );
}
