import { describe, expect, it } from 'vitest';
import { authError, deleteAccountWithRetry, jwtIsAnonymous } from './auth';
import { tokenExpired, tokenPurpose, toLinkPrefs } from './emailLinks';
import { DataError } from './types';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;

describe('jwtIsAnonymous', () => {
  it('reads the is_anonymous claim', () => {
    expect(jwtIsAnonymous(jwt({ sub: 'u', is_anonymous: true }))).toBe(true);
    expect(jwtIsAnonymous(jwt({ sub: 'u', is_anonymous: false }))).toBe(false);
  });
  it('missing or unreadable -> null (treated as anonymous by sessionKind)', () => {
    expect(jwtIsAnonymous(jwt({ sub: 'u' }))).toBeNull();
    expect(jwtIsAnonymous('garbage')).toBeNull();
    expect(jwtIsAnonymous('a.%%%.c')).toBeNull();
  });
});

describe('authError', () => {
  const err = (o: object) => Object.assign(new Error((o as { message?: string }).message ?? ''), { name: 'AuthApiError' }, o);
  it('maps Supabase Auth errors to our codes', () => {
    expect(authError(err({ code: 'otp_expired', message: 'Token has expired or is invalid' })).code).toBe('token_expired');
    expect(authError(err({ message: 'Token has expired or is invalid' })).code).toBe('token_expired');
    expect(authError(err({ message: 'Invalid OTP' })).code).toBe('token_invalid');
    expect(authError(err({ status: 429, message: 'For security purposes, you can only request this after 60 seconds.' })).code).toBe('rate_limited');
    expect(authError(err({ code: 'over_email_send_rate_limit' })).code).toBe('rate_limited');
    expect(authError(err({ message: 'captcha protection: request disallowed' })).code).toBe('captcha_failed');
    expect(authError(err({ code: 'otp_disabled' })).code).toBe('forbidden');
    expect(authError(new TypeError('Failed to fetch')).code).toBe('network');
    expect(authError(new DataError('rate_limited')).code).toBe('rate_limited');
  });
});

describe('email link tokens (shape only)', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  it('reads the purpose', () => {
    expect(tokenPurpose(`${id}.1.unsub.0.abc_-9`)).toBe('unsub');
    expect(tokenPurpose(`${id}.3.prefs.1893456000.abc`)).toBe('prefs');
  });
  it('rejects malformed tokens', () => {
    for (const t of [null, '', 'x', `${id}.1.unsub.5.abc`, `${id}.1.prefs.0.abc`, `${id}.0.unsub.0.abc`, `${id}.1.other.0.abc`, `nope.1.unsub.0.abc`, `${id}.1.unsub.0.a+b`, `${id}.1.unsub.0.abc.x`]) {
      expect(tokenPurpose(t)).toBeNull();
    }
  });
  it('prefs tokens expire; unsub tokens do not', () => {
    expect(tokenExpired(`${id}.1.prefs.1000.abc`, 1_000_001)).toBe(true);
    expect(tokenExpired(`${id}.1.prefs.1000.abc`, 999_000)).toBe(false);
    expect(tokenExpired(`${id}.1.unsub.0.abc`, Date.now())).toBe(false);
  });
  it('maps the function’s prefs reply defensively', () => {
    expect(toLinkPrefs({ status: 'stopped', houses: true, events: 'yes', cadence: 'weekly' })).toEqual({ status: 'stopped', houses: true, events: false, cadence: 'weekly' });
    expect(toLinkPrefs(null)).toEqual({ status: 'active', houses: false, events: false, cadence: 'daily' });
  });
});

describe('deleteAccountWithRetry (delete-account is idempotent)', () => {
  const run = (codes: string[]) => {
    const seen: string[] = [];
    const attempt = () => { const c = codes.shift() ?? ''; seen.push(c); return Promise.resolve(c); };
    return { seen, p: deleteAccountWithRetry(attempt, () => Promise.resolve()) };
  };
  it('ok on the first answer', async () => {
    await expect(run(['']).p).resolves.toBe('ok');
  });
  it('a retry answer or a lost response is retried with the same session; the repeat finds the account gone -> ok', async () => {
    const r = run(['retry', 'network', '']);
    await expect(r.p).resolves.toBe('ok');
    expect(r.seen).toEqual(['retry', 'network', '']);
  });
  it('still unknown after three tries: delete_unconfirmed (never "nothing changed")', async () => {
    const r = run(['retry', 'retry', 'retry', '']);
    await expect(r.p).rejects.toMatchObject({ code: 'unknown', detail: 'delete_unconfirmed' });
    expect(r.seen.length).toBe(3);
  });
  it('reauth, forbidden and not_signed_in are final', async () => {
    await expect(run(['reauth_required']).p).resolves.toBe('reauth');
    await expect(run(['forbidden']).p).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(['not_signed_in']).p).rejects.toMatchObject({ code: 'not_signed_in' });
    await expect(run(['weird']).p).rejects.toMatchObject({ code: 'unknown' });
  });
});
