import { useEffect, useState } from 'react';
import { authApi } from '../api/auth';
import { getLastRequestAt, onApiActivity } from '../api/client';
import { Button } from '../components/forms';
import { Modal } from '../components/Modal';
import { useAuth } from './AuthProvider';

export const WARNING_MS = 2 * 60_000;
/**
 * The server only rewrites last_seen_at once a minute, so its idle clock can
 * run up to a minute ahead of ours. Sign out a minute early to stay safe.
 */
export const SAFETY_MS = 60_000;

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * Warns 2 minutes before the server-side idle timeout (SPEC §10) and signs the
 * user out locally when it passes. Server activity is measured by API calls,
 * which is what resets the server's idle timer.
 */
export function SessionTimeout() {
  const { me, clearLocal, logout } = useAuth();
  const [lastActivity, setLastActivity] = useState(getLastRequestAt);
  const [now, setNow] = useState(Date.now);
  const [extending, setExtending] = useState(false);

  useEffect(() => onApiActivity(setLastActivity), []);

  const idleMs = (me?.session.idleTimeoutMinutes ?? 0) * 60_000;
  const deadline = lastActivity + idleMs - SAFETY_MS;
  const warnAt = deadline - WARNING_MS;
  const showWarning = !!me && now >= warnAt;

  useEffect(() => {
    if (!me) return;
    // Tick every second while warning; otherwise wake up exactly at warnAt.
    const delay = now >= warnAt ? 1000 : Math.max(0, warnAt - Date.now());
    const t = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(t);
  }, [me, now, warnAt]);

  useEffect(() => {
    if (me && now >= deadline) {
      // We time out a minute before the server does, so end the server session
      // too rather than leaving it usable. Local state is cleared either way.
      void logout({ reason: 'timeout' }).catch(() => clearLocal({ reason: 'timeout' }));
    }
  }, [me, now, deadline, logout, clearLocal]);

  if (!showWarning) return null;

  return (
    <Modal title="Are you still there?">
      <p className="text-ink">
        For your security you'll be signed out in{' '}
        <strong aria-live="polite">{formatRemaining(deadline - now)}</strong> because of inactivity.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          loading={extending}
          onClick={async () => {
            setExtending(true);
            try {
              await authApi.me();
              setNow(Date.now());
            } catch {
              clearLocal({ reason: 'expired' });
            } finally {
              setExtending(false);
            }
          }}
        >
          Stay signed in
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await logout().catch(() => {});
          }}
        >
          Sign out
        </Button>
      </div>
    </Modal>
  );
}
