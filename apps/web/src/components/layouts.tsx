import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
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
    { to: '/profile', label: 'Profile' },
    { to: '/account/security', label: 'Security' },
  ],
  doctor: [
    { to: '/schedule', label: 'Schedule' },
    { to: '/patients', label: 'Patients' },
    { to: '/account/security', label: 'Security' },
  ],
  receptionist: [
    { to: '/front-desk', label: 'Front desk' },
    { to: '/patients', label: 'Patients' },
    { to: '/account/security', label: 'Security' },
  ],
  admin: [
    { to: '/admin/users', label: 'Users' },
    { to: '/patients', label: 'Patients' },
    { to: '/account/security', label: 'Security' },
  ],
};

/**
 * Signed-in shell with a skip link, role-based navigation and sign-out. Below
 * the `md` breakpoint the navigation collapses behind a Menu button.
 */
export function AppShell() {
  const { me, logout } = useAuth();
  const clinic = useClinicInfo();
  const location = useLocation();
  const navId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = me?.user.role;
  const enrolling = me?.user.mfaEnrolmentRequired;

  // Close the mobile menu after navigating.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 py-2">
          <Link to="/" className="flex min-h-11 items-center font-semibold text-slate-900">
            {clinic.data?.clinicName ?? 'Clinic Appointments'}
          </Link>
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 rounded-md border border-slate-400 px-3 text-sm font-medium text-slate-900 md:hidden"
            aria-expanded={menuOpen}
            aria-controls={navId}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              {menuOpen ? (
                <path d="M5.3 4.3a1 1 0 0 1 1.4 0L10 7.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 9l3.3 3.3a1 1 0 0 1-1.4 1.4L10 10.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 9 5.3 5.7a1 1 0 0 1 0-1.4z" />
              ) : (
                <path d="M3 5h14a1 1 0 1 0 0-2H3a1 1 0 0 0 0 2zm14 4H3a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2zm0 6H3a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2z" />
              )}
            </svg>
            Menu
          </button>
          <nav
            id={navId}
            aria-label="Main"
            className={`${menuOpen ? 'flex' : 'hidden'} w-full flex-col gap-1 border-t border-slate-200 py-2 md:flex md:w-auto md:flex-row md:items-center md:gap-4 md:border-0 md:py-0`}
          >
            {role &&
              !enrolling &&
              NAV[role].map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center rounded px-2 md:px-0 ${isActive ? 'font-semibold text-brand-700 underline' : 'text-slate-800 hover:text-brand-700'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            <span className="truncate px-2 py-2 text-sm text-slate-700 md:max-w-56 md:px-0">
              {me?.user.email}
            </span>
            <Button
              variant="secondary"
              className="min-h-11 md:!px-3 md:!py-1.5 md:text-sm"
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
      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeading({ children }: { children: ReactNode }) {
  return <h1 className="mb-6 text-2xl font-semibold text-slate-900">{children}</h1>;
}
