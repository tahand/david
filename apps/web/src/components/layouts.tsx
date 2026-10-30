import type { ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { Role } from '@clinic/shared';
import { authApi } from '../api/auth';
import { useAuth } from '../auth/AuthProvider';
import { Button } from './forms';

export function useClinicInfo() {
  return useQuery({ queryKey: ['clinic'], queryFn: authApi.clinic, staleTime: 10 * 60_000 });
}

function Logo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="h-10 w-10">
      <rect width="32" height="32" rx="6" fill="#0b4a72" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#fff" />
    </svg>
  );
}

/** Centred card for public auth screens (SPEC §5.1). */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const clinic = useClinicInfo();
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-10">
      <main id="main" className="mx-auto w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo />
          <p className="text-lg font-semibold text-slate-900">
            {clinic.data?.clinicName ?? 'Clinic Appointments'}
          </p>
        </div>
        <div className="rounded-lg bg-white p-6 shadow-sm sm:p-8">
          <h1 className="mb-5 text-2xl font-semibold text-slate-900">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

const NAV: Record<Role, { to: string; label: string }[]> = {
  patient: [
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/account/security', label: 'Security' },
  ],
  doctor: [
    { to: '/schedule', label: 'Schedule' },
    { to: '/account/security', label: 'Security' },
  ],
  receptionist: [
    { to: '/front-desk', label: 'Front desk' },
    { to: '/account/security', label: 'Security' },
  ],
  admin: [
    { to: '/admin/users', label: 'Users' },
    { to: '/account/security', label: 'Security' },
  ],
};

/** Signed-in shell with a skip link, role-based navigation and sign-out. */
export function AppShell() {
  const { me, logout } = useAuth();
  const clinic = useClinicInfo();
  const role = me?.user.role;
  const enrolling = me?.user.mfaEnrolmentRequired;

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-semibold text-slate-900">
            {clinic.data?.clinicName ?? 'Clinic Appointments'}
          </Link>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-4">
            {role &&
              !enrolling &&
              NAV[role].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `text-sm ${isActive ? 'font-semibold text-brand-700 underline' : 'text-slate-800 hover:text-brand-700'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            <span className="hidden text-sm text-slate-700 sm:inline">{me?.user.email}</span>
            <Button
              variant="secondary"
              className="!px-3 !py-1.5 text-sm"
              onClick={async () => {
                // RequireAuth redirects to /login once signed out.
                await logout().catch(() => {});
              }}
            >
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeading({ children }: { children: ReactNode }) {
  return <h1 className="mb-6 text-2xl font-semibold text-slate-900">{children}</h1>;
}
