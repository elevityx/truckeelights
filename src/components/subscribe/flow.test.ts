import { describe, expect, it, vi } from 'vitest';
import { DataError } from '@/lib/data/types';
import {
  CHOICES_KEY,
  clearNext,
  confirmNext,
  confirmRedirect,
  NEXT_KEY,
  deviceAddedHouse,
  emailProblem,
  finishSubscription,
  initialSheet,
  markHouseAdded,
  nextFor,
  parseConfirm,
  readChoices,
  readNext,
  reducer,
  resendLeft,
  safeNext,
  saveChoices,
  saveNext,
  sendCode,
  summary,
  type Choices,
  type FlowApi,
  type SheetState,
} from './flow';

function memStore() {
  const m = new Map<string, string>();
  const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  return () => s;
}
const throwing = () => {
  throw new Error('SecurityError');
};

function api(kind: 'none' | 'anonymous' | 'user', over: Partial<FlowApi> = {}): FlowApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sessionKind: vi.fn(async () => kind),
    beginHouseLink: vi.fn(async () => void calls.push('begin')),
    sendEmailCode: vi.fn(async () => void calls.push('send')),
    setSubscription: vi.fn(async () => void calls.push('set')),
    completeHouseLink: vi.fn(async () => {
      calls.push('complete');
      return 2;
    }),
    signOutLocal: vi.fn(async () => void calls.push('signout')),
    ...over,
  };
}

const fill = (s: SheetState, email = 'sam@example.com') => reducer(s, { type: 'email', email });

describe('subscribe sheet state machine', () => {
  it('starts on the form with both topics, daily, and the given account default', () => {
    const s = initialSheet(true);
    expect(s.step).toBe('form');
    expect(s.choices).toEqual({ houses: true, events: true, cadence: 'daily', account: true });
    expect(initialSheet(false).choices.account).toBe(false);
  });
  it('needs at least one topic and a valid email before the bot check', () => {
    let s = initialSheet(false);
    s = reducer(s, { type: 'toggle', topic: 'houses' });
    s = reducer(s, { type: 'toggle', topic: 'events' });
    s = reducer(s, { type: 'submit', signedIn: false });
    expect(s.step).toBe('form');
    expect(s.topicsError).toBe(true);
    expect(s.emailError).toBe('Enter your email.');
    s = reducer(reducer(s, { type: 'toggle', topic: 'events' }), { type: 'email', email: 'not-an-email' });
    expect(s.topicsError).toBe(false);
    s = reducer(s, { type: 'submit', signedIn: false });
    expect(s.step).toBe('form');
    expect(s.emailError).toMatch(/typo/);
  });
  it('no session or an anonymous one: form -> bot -> sending -> code (trimmed email)', () => {
    let s = reducer(fill(initialSheet(false), '  sam@example.com '), { type: 'submit', signedIn: false });
    expect(s.step).toBe('bot');
    expect(s.email).toBe('sam@example.com');
    s = reducer(s, { type: 'token' });
    expect(s.step).toBe('sending');
    s = reducer(s, { type: 'sent', at: 1000 });
    expect(s.step).toBe('code');
    expect(s.sentAt).toBe(1000);
  });
  it('already signed in (non-anonymous): skips email, bot check and code, straight to saving', () => {
    const s = reducer(initialSheet(false), { type: 'submit', signedIn: true });
    expect(s.step).toBe('saving');
    expect(s.emailError).toBe('');
  });
  it('a failed first send goes back to the form with a fresh Turnstile', () => {
    const s0 = reducer(reducer(fill(initialSheet(false)), { type: 'submit', signedIn: false }), { type: 'token' });
    const s = reducer(s0, { type: 'sendFailed', code: 'rate_limited', message: 'wait' });
    expect(s.step).toBe('form');
    expect(s.error).toBe('wait');
    expect(s.captchaKey).toBe(s0.captchaKey + 1);
  });
  it('code: digits only, 6 required; a bad code stays on the code step', () => {
    let s = reducer(reducer(reducer(fill(initialSheet(false)), { type: 'submit', signedIn: false }), { type: 'token' }), { type: 'sent', at: 0 });
    s = reducer(s, { type: 'code', code: '12a 34-5678' });
    expect(s.code).toBe('123456');
    s = reducer(reducer(s, { type: 'code', code: '123' }), { type: 'verify' });
    expect(s.step).toBe('code');
    expect(s.codeError).not.toBe('');
    s = reducer(reducer(s, { type: 'code', code: '482913' }), { type: 'verify' });
    expect(s.step).toBe('verifying');
    s = reducer(s, { type: 'verifyFailed', code: 'token_invalid', message: 'nope' });
    expect(s.step).toBe('code');
    expect(s.codeError).toBe('nope');
  });
  it('resend goes back through the bot check; a different email resets to the form', () => {
    const atCode = reducer(reducer(reducer(fill(initialSheet(false)), { type: 'submit', signedIn: false }), { type: 'token' }), { type: 'sent', at: 0 });
    const r = reducer(atCode, { type: 'resend' });
    expect(r.step).toBe('bot');
    expect(r.captchaKey).toBe(atCode.captchaKey + 1);
    expect(reducer(r, { type: 'sendFailed', code: 'network', message: 'x' }).step).toBe('code');
    const c = reducer(atCode, { type: 'changeEmail' });
    expect(c.step).toBe('form');
    expect(c.sentAt).toBeNull();
  });
  it('resend unlocks after 60 s', () => {
    expect(resendLeft(null, 5)).toBe(0);
    expect(resendLeft(0, 0)).toBe(60);
    expect(resendLeft(0, 59_001)).toBe(1);
    expect(resendLeft(0, 60_000)).toBe(0);
  });
});

describe('sendCode (before the email)', () => {
  it('an anonymous session (JWT is_anonymous) starts a house link before the OTP', async () => {
    const a = api('anonymous');
    expect(await sendCode(a, 'sam@example.com', 'tok', 'https://x/auth/confirm/')).toEqual({ linkStarted: true });
    expect(a.calls).toEqual(['begin', 'send']);
    expect(a.beginHouseLink).toHaveBeenCalledWith('sam@example.com');
    expect(a.sendEmailCode).toHaveBeenCalledWith('sam@example.com', 'tok', 'https://x/auth/confirm/');
  });
  it('no session, or a signed-in user: never calls begin_house_link', async () => {
    for (const k of ['none', 'user'] as const) {
      const a = api(k);
      await sendCode(a, 'sam@example.com', 'tok', 'r');
      expect(a.calls).toEqual(['send']);
    }
  });
  it('an existing email or a refused link still sends the code (no account enumeration, link not fatal)', async () => {
    const a = api('anonymous', { beginHouseLink: vi.fn(async () => Promise.reject(new DataError('rate_limited'))) });
    expect(await sendCode(a, 'sam@example.com', 'tok', 'r')).toEqual({ linkStarted: false });
    expect(a.sendEmailCode).toHaveBeenCalled();
  });
  it('a send failure propagates', async () => {
    const a = api('none', { sendEmailCode: vi.fn(async () => Promise.reject(new DataError('captcha_failed'))) });
    await expect(sendCode(a, 'e@x.io', 't', 'r')).rejects.toMatchObject({ code: 'captcha_failed' });
  });
});

describe('finishSubscription (after verify)', () => {
  const c: Choices = { houses: true, events: false, cadence: 'weekly', account: true };
  it('account checked: saves choices, links houses, stays signed in', async () => {
    const a = api('user');
    expect(await finishSubscription(a, 'truckee', c)).toEqual({ linked: 2, signedOut: false });
    expect(a.setSubscription).toHaveBeenCalledWith('truckee', { houses: true, events: false, cadence: 'weekly' });
    expect(a.calls).toEqual(['set', 'complete']);
  });
  it('account unchecked: signs out of this browser only after saving', async () => {
    const a = api('user');
    expect(await finishSubscription(a, 'truckee', { ...c, account: false })).toEqual({ linked: 2, signedOut: true });
    expect(a.calls).toEqual(['set', 'complete', 'signout']);
  });
  it('a save failure stops before linking or signing out', async () => {
    const a = api('user', { setSubscription: vi.fn(async () => Promise.reject(new DataError('forbidden'))) });
    await expect(finishSubscription(a, 'truckee', { ...c, account: false })).rejects.toMatchObject({ code: 'forbidden' });
    expect(a.completeHouseLink).not.toHaveBeenCalled();
    expect(a.signOutLocal).not.toHaveBeenCalled();
  });
  it('no pending link is fine (0 linked)', async () => {
    const a = api('user', { completeHouseLink: vi.fn(async () => Promise.reject(new DataError('not_found'))) });
    expect((await finishSubscription(a, 'truckee', c)).linked).toBe(0);
  });
});

describe('choices storage', () => {
  it('round-trips and rejects junk', () => {
    const st = memStore();
    expect(readChoices(st)).toBeNull();
    const c: Choices = { houses: false, events: true, cadence: 'daily', account: false };
    saveChoices(st, c);
    expect(readChoices(st)).toEqual(c);
    st().setItem(CHOICES_KEY, '{"h":false,"e":false,"c":"daily","a":true}');
    expect(readChoices(st)).toBeNull();
    st().setItem(CHOICES_KEY, '{"h":true,"e":true,"c":"hourly","a":true}');
    expect(readChoices(st)).toBeNull();
    st().setItem(CHOICES_KEY, 'nope');
    expect(readChoices(st)).toBeNull();
  });
  it('survives storage that throws', () => {
    expect(() => saveChoices(throwing, initialSheet(true).choices)).not.toThrow();
    expect(readChoices(throwing)).toBeNull();
    expect(deviceAddedHouse(throwing)).toBe(false);
  });
  it('remembers that this device added a house', () => {
    const st = memStore();
    expect(deviceAddedHouse(st)).toBe(false);
    markHouseAdded(st);
    expect(deviceAddedHouse(st)).toBe(true);
  });
});

describe('confirm page rules', () => {
  it('next allowlist: only /account/ and /subscribed/', () => {
    expect(safeNext('/account/')).toBe('/account/');
    expect(safeNext('/subscribed/')).toBe('/subscribed/');
    for (const bad of [null, '', '/', '/admin/', '//evil.example', 'https://evil.example/account/', '/account', '/account/?x=1', '/%2e%2e/admin/', 'javascript:alert(1)']) {
      expect(safeNext(bad)).toBe('/');
    }
  });
  it('nextFor falls back to the stored account choice', () => {
    const c: Choices = { houses: true, events: true, cadence: 'daily', account: true };
    expect(nextFor(c, null)).toBe('/account/');
    expect(nextFor({ ...c, account: false }, 'https://evil.example')).toBe('/subscribed/');
    expect(nextFor(null, '/subscribed/')).toBe('/subscribed/');
    expect(nextFor(null, null)).toBe('/');
  });
  it('type branches (C3): sign-in types, email_change, recovery; anything else is an error', () => {
    const h = 'pkce_0123456789abcdef';
    for (const t of ['magiclink', 'email', 'signup']) expect(parseConfirm(`?token_hash=${h}&type=${t}`)).toMatchObject({ ok: true, branch: 'signin', type: t });
    expect(parseConfirm(`?token_hash=${h}&type=email_change`)).toMatchObject({ ok: true, branch: 'email_change' });
    expect(parseConfirm(`?token_hash=${h}&type=recovery&next=/account/`)).toMatchObject({ ok: true, branch: 'recovery', next: '/account/' });
    for (const t of ['invite', 'sms', 'phone_change', '', 'EMAIL']) expect(parseConfirm(`?token_hash=${h}&type=${t}`).ok).toBe(false);
    expect(parseConfirm('?type=email').ok).toBe(false);
    expect(parseConfirm('?token_hash=<script>&type=email').ok).toBe(false);
  });
  it('links without next (the Auth templates carry none) land where this browser asked (code or link flow)', () => {
    const st = memStore();
    expect(confirmNext(null, st)).toBeNull();
    saveNext(st, '/account/'); // the account page's email sign-in
    expect(readNext(st)).toBe('/account/');
    expect(confirmNext(null, st)).toBe('/account/');
    expect(confirmNext('/subscribed/', st)).toBe('/subscribed/'); // an explicit, allowed next wins
    expect(confirmNext('https://evil.example/', st)).toBe('/account/'); // a bad one is ignored
    saveNext(st, '/subscribed/');
    expect(confirmNext(null, st)).toBe('/subscribed/');
    st().setItem(NEXT_KEY, '//evil.example'); // a tampered value is never used
    expect(readNext(st)).toBeNull();
    saveNext(st, '/account/');
    clearNext(st);
    expect(confirmNext(null, st)).toBeNull();
    saveNext(st, '/');
    expect(readNext(st)).toBeNull();
    expect(confirmNext(null, throwing)).toBeNull();
    expect(() => saveNext(throwing, '/account/')).not.toThrow();
  });
  it('the sign-in link comes back to this origin with an allowed next', () => {
    expect(confirmRedirect('https://truckeelights.com', true)).toBe('https://truckeelights.com/auth/confirm/?next=%2Faccount%2F');
    expect(confirmRedirect('http://localhost:3000', false)).toBe('http://localhost:3000/auth/confirm/?next=%2Fsubscribed%2F');
  });
});

describe('copy helpers', () => {
  it('email check', () => {
    expect(emailProblem('sam@example.com')).toBe('');
    expect(emailProblem('a@b')).not.toBe('');
    expect(emailProblem('a b@c.com')).not.toBe('');
    expect(emailProblem('<x>@c.com')).not.toBe('');
  });
  it('summary', () => {
    expect(summary({ houses: true, events: true, cadence: 'daily' })).toBe('new houses and events, daily');
    expect(summary({ houses: false, events: true, cadence: 'weekly' })).toBe('new events, on Thursdays');
  });
});
