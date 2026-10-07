export type AdminScreen = 'login' | 'mfa' | 'setup' | 'not_admin' | 'console';

export interface AuthState {
  /** A non-anonymous session exists. A visitor's anonymous session counts as false. */
  hasUser: boolean;
  current: 'aal1' | 'aal2' | null;
  next: 'aal1' | 'aal2' | null;
  /** adminWhoami result; only meaningful (and only asked) at aal2. */
  isAdmin: boolean | null;
}

/**
 * Which back-office screen to show. UI convenience only: the database enforces
 * non-anonymous + aal2 + an admins row on every admin RPC.
 * Fail closed: anything unexpected lands on a screen that shows nothing privileged.
 */
export function decideScreen(s: AuthState): AdminScreen {
  if (!s.hasUser || s.current === null) return 'login';
  if (s.current === 'aal2') return s.isAdmin === true ? 'console' : 'not_admin';
  // aal1
  if (s.next === 'aal2') return 'mfa';
  return 'setup';
}
