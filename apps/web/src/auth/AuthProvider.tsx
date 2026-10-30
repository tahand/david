import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthMeResponse } from '@clinic/shared';
import { authApi } from '../api/auth';
import { ApiError, resetClientState } from '../api/client';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export type SignOutReason = 'timeout' | 'expired';

export interface SignedOutState {
  reason?: SignOutReason;
  /** Send the user back to the page they were on after signing in again. */
  keepNext?: boolean;
}

interface AuthState {
  me: AuthMeResponse | null;
  isLoading: boolean;
  /** Set when this tab signed out; guards use it to choose the redirect. */
  signedOut: SignedOutState | null;
  /** Store a fresh /me payload (after login, MFA, etc.). */
  setMe: (me: AuthMeResponse | null) => void;
  refresh: () => Promise<void>;
  /** Destroys the server session, then clears local state (SPEC §10). */
  logout: (state?: SignedOutState) => Promise<void>;
  /** Clears local state without calling the server (e.g. after a 401). */
  clearLocal: (state?: SignedOutState) => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Owns the signed-in user. Sign-out is React state (not just query-cache
 * state) so it lands in the same render as the guard redirect; nothing else
 * navigates on sign-out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState<SignedOutState | null>(null);
  const signedOutRef = useRef<SignedOutState | null>(null);

  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await authApi.me();
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
    // Refetching on focus would silently extend the server idle timer.
    refetchOnWindowFocus: false,
  });

  const setMe = useCallback(
    (me: AuthMeResponse | null) => {
      signedOutRef.current = null;
      setSignedOut(null);
      queryClient.setQueryData(ME_QUERY_KEY, me);
    },
    [queryClient],
  );

  const clearLocal = useCallback(
    (state: SignedOutState = {}) => {
      // The first sign-out wins, so a stray 401 from an in-flight request
      // can't replace "timed out" with "expired".
      if (signedOutRef.current) return;
      signedOutRef.current = state;
      setSignedOut(state);
      queryClient.setQueryData(ME_QUERY_KEY, null);
      void queryClient.cancelQueries();
      // Drop every other cached query, patient data included (SPEC §10).
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] || q.queryKey[1] !== ME_QUERY_KEY[1],
      });
      queryClient.getMutationCache().clear();
      resetClientState();
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      me: signedOut ? null : (query.data ?? null),
      isLoading: !signedOut && query.isPending,
      signedOut,
      setMe,
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      },
      logout: async (state) => {
        try {
          await authApi.logout();
        } finally {
          clearLocal(state);
        }
      },
      clearLocal,
    }),
    [signedOut, query.data, query.isPending, setMe, queryClient, clearLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
