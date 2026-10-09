// Owner: sub/ui. Email sign-in for Subscribe + Accounts v1 (Spec_Subscribe_Accounts, Amendments 1-2):
// one path only, `signInWithOtp` (Turnstile-gated) and `verifyOtp` by 6-digit code or by the emailed token_hash.
// Never `updateUser({ email })` (B1). The database and Supabase Auth enforce everything; nothing here is a
// security boundary.
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError } from './types';

export type SessionKind = 'none' | 'anonymous' | 'user';
/** The token_hash link types `/auth/confirm/` accepts (C3). */
export type LinkOtpType = 'magiclink' | 'email' | 'signup' | 'email_change' | 'recovery';

/** Reads `is_anonymous` from a JWT payload. null when the token can't be read. Not a signature check. */
export function jwtIsAnonymous(accessToken: string): boolean | null {
  const part = accessToken.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(atob(b64)) as { is_anonymous?: unknown };
    return typeof payload.is_anonymous === 'boolean' ? payload.is_anonymous : null;
  } catch {
    return null;
  }
}

/**
 * What kind of session this browser holds, from the current JWT's `is_anonymous` flag (C5), not from "has a
 * session". An unreadable flag counts as anonymous, so `begin_house_link` is tried and the server decides.
 */
export async function sessionKind(): Promise<SessionKind> {
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error || !data.session) return 'none';
    return jwtIsAnonymous(data.session.access_token) === false ? 'user' : 'anonymous';
  } catch {
    return 'none';
  }
}

/** The signed-in (non-anonymous) account's email, or null. */
export async function sessionEmail(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    const s = data.session;
    if (!s || jwtIsAnonymous(s.access_token) !== false) return null;
    return s.user.email ?? null;
  } catch {
    return null;
  }
}

/** Auth errors -> our codes. Expired/used codes and links -> token_expired; wrong code -> token_invalid. */
export function authError(e: unknown): DataError {
  if (e instanceof DataError) return e;
  if (e instanceof TypeError) return new DataError('network');
  const o = (e && typeof e === 'object' ? e : {}) as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof o.code === 'string' ? o.code : '';
  const msg = typeof o.message === 'string' ? o.message.toLowerCase() : '';
  if (msg.includes('captcha') || code.startsWith('captcha')) return new DataError('captcha_failed');
  if (o.status === 429 || code.includes('rate_limit')) return new DataError('rate_limited');
  if (code === 'otp_expired' || msg.includes('expired')) return new DataError('token_expired');
  if (code === 'otp_disabled' || code === 'signup_disabled') return new DataError('forbidden');
  if (msg.includes('invalid') || code === 'bad_jwt') return new DataError('token_invalid');
  return toDataError(e);
}

/**
 * Sends one email with a magic link and a 6-digit code. `redirectTo` must be on the Auth redirect allow list.
 * Supabase never says whether the address already has an account, and neither do we (B10).
 */
export async function sendEmailCode(email: string, captchaToken: string, redirectTo: string): Promise<void> {
  try {
    const { error } = await getSupabase().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, captchaToken, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  } catch (e) {
    throw authError(e);
  }
}

/** The code typed in the same tab (B1). */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  try {
    const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  } catch (e) {
    throw authError(e);
  }
}

/** The emailed link, only after the person taps Confirm on `/auth/confirm/` (no verify on load). */
export async function verifyLinkToken(tokenHash: string, type: LinkOtpType): Promise<void> {
  try {
    const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw error;
  } catch (e) {
    throw authError(e);
  }
}

/** Ends this browser's session only (B2: the "create an account" box was unchecked, or Sign out). */
export async function signOutLocal(): Promise<void> {
  try {
    const { error } = await getSupabase().auth.signOut({ scope: 'local' });
    if (error) throw error;
  } catch (e) {
    throw authError(e);
  }
}

/** Reads `{ error }` from a function's JSON error body. */
async function functionErrorCode(e: unknown): Promise<string> {
  const ctx = (e as { context?: unknown })?.context;
  if (ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = (await (ctx as Response).clone().json()) as { error?: unknown };
      if (typeof body.error === 'string') return body.error;
    } catch {
      /* not JSON */
    }
  }
  return '';
}

/** One attempt at `delete-account`: the function's error code ('' on success), or 'network' when it was not reached. */
export type DeleteAttempt = () => Promise<string>;

/**
 * Edge Function `delete-account` (C4): the user comes only from the verified JWT. Returns 'reauth' when the
 * function wants a fresh email code first (no recent `otp` sign-in in the token's `amr`).
 * Contract: 200 `{ deleted: true }`; 403 `{ error: 'reauth_required' }`; 403 `{ error: 'forbidden' }` (admins);
 * 503 `{ error: 'retry' }` when the outcome is not known yet. The function is idempotent (a repeat after the Auth user
 * is gone runs the cleanup and answers 200), so `retry` and a lost response are retried here with the same session,
 * twice; if still unknown, the caller shows `delete_unconfirmed` and the person can tap again safely.
 */
export async function deleteAccountWithRetry(
  attempt: DeleteAttempt,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<'ok' | 'reauth'> {
  for (let i = 0; ; i++) {
    const code = await attempt();
    if (code === '') return 'ok';
    if (code === 'reauth_required' || code === 'fresh_otp_required') return 'reauth';
    if (code === 'forbidden') throw new DataError('forbidden');
    if (code === 'not_signed_in') throw new DataError('not_signed_in');
    if (code !== 'retry' && code !== 'network' && code !== 'unavailable') throw new DataError('unknown');
    if (i >= 2) throw new DataError('unknown', 'delete_unconfirmed');
    await sleep(1000 * (i + 1));
  }
}

export async function deleteMyAccount(): Promise<'ok' | 'reauth'> {
  return deleteAccountWithRetry(async () => {
    try {
      const { error } = await getSupabase().functions.invoke('delete-account', { method: 'POST', body: {} });
      if (!error) return '';
      const code = await functionErrorCode(error);
      // No JSON body: the request or its response was lost (FunctionsFetchError / relay error), so the outcome is unknown.
      return code || 'network';
    } catch {
      return 'network';
    }
  });
}
