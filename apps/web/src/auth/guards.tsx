import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import type { Role } from '@clinic/shared';
import { Spinner } from '../components/forms';
import { ForbiddenPage } from '../pages/ForbiddenPage';
import { useAuth } from './AuthProvider';
import { destinationFor, loginPathFor } from './navigation';

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-700">
      <Spinner label="Loading your account" />
    </div>
  );
}

/**
 * Route guard (SPEC §10). Cosmetic only: the API enforces every rule.
 * - not signed in → /login?next=…
 * - staff without MFA → /mfa/setup (unless `allowMfaEnrolment`)
 * - wrong role → "You don't have access"
 */
export function RequireAuth({
  roles,
  allowMfaEnrolment = false,
}: {
  roles?: readonly Role[];
  allowMfaEnrolment?: boolean;
}) {
  const { me, isLoading, signedOut } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoading />;
  if (!me) {
    // A deliberate sign-out goes to a plain /login; an expired session keeps `next`.
    const from = !signedOut || signedOut.keepNext ? location : null;
    return <Navigate to={loginPathFor(from, signedOut?.reason)} replace />;
  }
  if (me.user.mfaEnrolmentRequired && !allowMfaEnrolment) {
    return <Navigate to="/mfa/setup" replace />;
  }
  if (roles && !roles.includes(me.user.role)) return <ForbiddenPage />;
  return <Outlet />;
}

/**
 * Sends signed-in users away from the sign-in/registration screens, honouring
 * `?next=` so it agrees with the login page's own post-login navigation.
 */
export function PublicOnly() {
  const { me, isLoading } = useAuth();
  const [params] = useSearchParams();
  if (isLoading) return <FullPageLoading />;
  if (me) return <Navigate to={destinationFor(me, params.get('next'))} replace />;
  return <Outlet />;
}

/** `/` → the signed-in user's home, or the login page. */
export function HomeRedirect() {
  const { me, isLoading } = useAuth();
  if (isLoading) return <FullPageLoading />;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={destinationFor(me, null)} replace />;
}
