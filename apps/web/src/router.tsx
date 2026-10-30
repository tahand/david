import { useEffect } from 'react';
import { createBrowserRouter, Outlet, useNavigate, type RouteObject } from 'react-router';
import { setGlobalHandlers } from './api/client';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { HomeRedirect, PublicOnly, RequireAuth } from './auth/guards';
import { SessionTimeout } from './auth/SessionTimeout';
import { AppShell } from './components/layouts';
import { MfaSetupPage } from './pages/account/MfaSetupPage';
import { SecurityPage } from './pages/account/SecurityPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { DashboardPage } from './pages/patient/DashboardPage';
import { PrivacyPage, TermsPage } from './pages/public/LegalPages';
import { LoginPage } from './pages/public/LoginPage';
import { MfaPage } from './pages/public/MfaPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/public/TokenPages';
import { PlaceholderPage } from './pages/staff/PlaceholderPage';

/** Wires the API client's global 401/403 handling to navigation (SPEC §10). */
function GlobalErrorHandling() {
  const navigate = useNavigate();
  const { clearLocal } = useAuth();
  useEffect(() => {
    setGlobalHandlers({
      onUnauthorized: () => {
        // The guard redirects to /login, keeping the current page as next.
        clearLocal({ reason: 'expired', keepNext: true });
      },
      onForbidden: () => navigate('/forbidden', { replace: true }),
      onMfaEnrolmentRequired: () => navigate('/mfa/setup', { replace: true }),
    });
  }, [navigate, clearLocal]);
  return null;
}

function Root() {
  return (
    <AuthProvider>
      <GlobalErrorHandling />
      <SessionTimeout />
      <Outlet />
    </AuthProvider>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: '/', element: <HomeRedirect /> },
      {
        element: <PublicOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      { path: '/login/mfa', element: <MfaPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/forbidden', element: <ForbiddenPage /> },
      {
        element: <AppShell />,
        children: [
          {
            element: <RequireAuth allowMfaEnrolment />,
            children: [{ path: '/mfa/setup', element: <MfaSetupPage /> }],
          },
          {
            element: <RequireAuth />,
            children: [{ path: '/account/security', element: <SecurityPage /> }],
          },
          {
            element: <RequireAuth roles={['patient']} />,
            children: [{ path: '/dashboard', element: <DashboardPage /> }],
          },
          {
            element: <RequireAuth roles={['doctor']} />,
            children: [
              { path: '/schedule', element: <PlaceholderPage title="Schedule" phase="phase 7" /> },
            ],
          },
          {
            element: <RequireAuth roles={['receptionist', 'admin']} />,
            children: [
              {
                path: '/front-desk',
                element: <PlaceholderPage title="Front desk" phase="phase 7" />,
              },
            ],
          },
          {
            element: <RequireAuth roles={['admin']} />,
            children: [
              { path: '/admin/users', element: <PlaceholderPage title="Users" phase="phase 9" /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
