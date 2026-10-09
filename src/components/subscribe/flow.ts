// Pure Subscribe logic: the sheet's state machine, choice storage, the confirm page's `next` and type rules,
// and the two async steps (before sending the code, after verifying it) with the API injected, so all of it
// is unit-tested without a browser.
import type { DataErrorCode, SubscriptionCadence, SubscriptionPrefs } from '@/lib/data/types';
import type { LinkOtpType, SessionKind } from '@/lib/data/auth';

export interface Choices extends SubscriptionPrefs {
  /** "Also create an account to manage my house": checked keeps the session, unchecked signs out after Save. */
  account: boolean;
}

export type SheetStep = 'form' | 'bot' | 'sending' | 'code' | 'verifying' | 'saving' | 'done';

export interface SheetState {
  step: SheetStep;
  choices: Choices;
  email: string;
  code: string;
  /** Inline field errors on the form. */
  topicsError: boolean;
  emailError: string;
  /** Error under the code field, or the general error on any step. */
  codeError: string;
  error: string;
  /** Wall-clock ms when the latest code was sent; resend unlocks 60 s later. */
  sentAt: number | null;
  /** Bumped to remount Turnstile for a fresh token. */
  captchaKey: number;
  /** Houses linked to the account after verify (from this device's anonymous session). */
  linked: number;
}

export const RESEND_SECONDS = 60;
export const CHOICES_KEY = 'tl:sub-choices';
export const ADDED_KEY = 'tl:added-house';
/** sessionStorage: where a sign-in link should land when the emailed link has no `next` (the templates carry none). */
export const NEXT_KEY = 'tl:auth-next';

export function initialSheet(account: boolean, email = ''): SheetState {
  return {
    step: 'form',
    choices: { houses: true, events: true, cadence: 'daily', account },
    email,
    code: '',
    topicsError: false,
    emailError: '',
    codeError: '',
    error: '',
    sentAt: null,
    captchaKey: 0,
    linked: 0,
  };
}

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]{2,}$/;
export function emailProblem(raw: string): string {
  const e = raw.trim();
  if (!e) return 'Enter your email.';
  if (e.length > 254 || !EMAIL_RE.test(e)) return 'That doesn’t look like an email. Check for a typo.';
  return '';
}

export type SheetAction =
  | { type: 'toggle'; topic: 'houses' | 'events' }
  | { type: 'cadence'; cadence: SubscriptionCadence }
  | { type: 'account'; account: boolean }
  | { type: 'email'; email: string }
  /** Subscribe tapped. `signedIn`: a non-anonymous session already exists, so no email, code or bot check. */
  | { type: 'submit'; signedIn: boolean }
  | { type: 'token' }
  | { type: 'sent'; at: number }
  | { type: 'sendFailed'; code: DataErrorCode; message: string }
  | { type: 'code'; code: string }
  | { type: 'verify' }
  | { type: 'verifyFailed'; code: DataErrorCode; message: string }
  | { type: 'saving' }
  | { type: 'saveFailed'; message: string }
  | { type: 'done'; linked: number }
  | { type: 'resend' }
  | { type: 'changeEmail' };

export function reducer(s: SheetState, a: SheetAction): SheetState {
  switch (a.type) {
    case 'toggle':
      return { ...s, choices: { ...s.choices, [a.topic]: !s.choices[a.topic] }, topicsError: false };
    case 'cadence':
      return { ...s, choices: { ...s.choices, cadence: a.cadence } };
    case 'account':
      return { ...s, choices: { ...s.choices, account: a.account } };
    case 'email':
      return { ...s, email: a.email, emailError: '' };
    case 'submit': {
      if (s.step !== 'form') return s;
      const topicsError = !s.choices.houses && !s.choices.events;
      const emailError = a.signedIn ? '' : emailProblem(s.email);
      if (topicsError || emailError) return { ...s, topicsError, emailError, error: '' };
      if (a.signedIn) return { ...s, topicsError, emailError, error: '', step: 'saving' };
      return { ...s, email: s.email.trim(), topicsError, emailError, error: '', step: 'bot' };
    }
    case 'token':
      return s.step === 'bot' ? { ...s, step: 'sending', error: '' } : s;
    case 'sent':
      return { ...s, step: 'code', sentAt: a.at, code: '', codeError: '', error: '' };
    case 'sendFailed':
      // Back to the step the person came from: the form on a first send, the code step on a resend.
      return {
        ...s,
        step: s.sentAt === null ? 'form' : 'code',
        error: a.message,
        captchaKey: s.captchaKey + 1,
      };
    case 'code':
      return { ...s, code: a.code.replace(/\D/g, '').slice(0, 6), codeError: '' };
    case 'verify':
      if (s.step !== 'code') return s;
      if (!/^\d{6}$/.test(s.code)) return { ...s, codeError: 'Enter the 6-digit code from the email.' };
      return { ...s, step: 'verifying', codeError: '', error: '' };
    case 'verifyFailed':
      return { ...s, step: 'code', codeError: a.message };
    case 'saving':
      return { ...s, step: 'saving', error: '' };
    case 'saveFailed':
      return { ...s, step: s.sentAt === null ? 'form' : 'code', error: a.message };
    case 'done':
      return { ...s, step: 'done', linked: a.linked, error: '' };
    case 'resend':
      return s.step === 'code' ? { ...s, step: 'bot', code: '', codeError: '', error: '', captchaKey: s.captchaKey + 1 } : s;
    case 'changeEmail':
      return { ...s, step: 'form', code: '', codeError: '', error: '', sentAt: null, captchaKey: s.captchaKey + 1 };
  }
}

/** Seconds until Resend unlocks (0 = enabled). */
export function resendLeft(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));
}

export function codeMessage(code: DataErrorCode): string {
  switch (code) {
    case 'token_expired':
      return 'That code has expired or was already used. Tap Resend for a new one.';
    case 'token_invalid':
    case 'auth_failed':
      return 'That code didn’t work. Check the newest email from Truckee Lights, or resend.';
    case 'rate_limited':
      return 'Too many tries. Wait a minute, then try again.';
    case 'network':
      return 'Can’t reach the server. Check your connection.';
    default:
      return 'That code didn’t work. Try again, or resend.';
  }
}

export function sendMessage(code: DataErrorCode): string {
  switch (code) {
    case 'rate_limited':
      return 'We just sent you an email. Wait a minute before asking for another.';
    case 'captcha_failed':
      return 'The bot check didn’t go through. Try again.';
    case 'network':
      return 'Can’t reach the server. Check your connection.';
    case 'forbidden':
      return 'This address can’t sign in by email. Admins use the admin page.';
    default:
      return 'We couldn’t send the email. Try again in a minute.';
  }
}

export function saveMessage(code: DataErrorCode): string {
  switch (code) {
    case 'rate_limited':
      return 'That’s a lot of changes for one day. Try again tomorrow.';
    case 'forbidden':
      return 'This account can’t subscribe here. Admin accounts use the admin page.';
    case 'not_signed_in':
      return 'Your sign-in ended. Ask for a new code and try again.';
    case 'network':
      return 'Can’t reach the server. Check your connection.';
    default:
      return 'We couldn’t save your choices. Try again.';
  }
}

export function summary(c: SubscriptionPrefs): string {
  const what = c.houses && c.events ? 'new houses and events' : c.houses ? 'new houses' : 'new events';
  return `${what}, ${c.cadence === 'daily' ? 'daily' : 'on Thursdays'}`;
}

// ---------- storage (sessionStorage for choices, localStorage for "this device added a house") ----------

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveChoices(store: () => Store, c: Choices): void {
  try {
    store().setItem(CHOICES_KEY, JSON.stringify({ h: c.houses, e: c.events, c: c.cadence, a: c.account }));
  } catch {
    /* storage may be unavailable: the confirm page then asks again */
  }
}

/** Saved choices, or null when missing, unreadable, or not a valid set (at least one topic). */
export function readChoices(store: () => Store): Choices | null {
  try {
    const raw = store().getItem(CHOICES_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { h?: unknown; e?: unknown; c?: unknown; a?: unknown };
    if (typeof o.h !== 'boolean' || typeof o.e !== 'boolean' || typeof o.a !== 'boolean') return null;
    if (!o.h && !o.e) return null;
    if (o.c !== 'daily' && o.c !== 'weekly') return null;
    return { houses: o.h, events: o.e, cadence: o.c, account: o.a };
  } catch {
    return null;
  }
}

export function clearChoices(store: () => Store): void {
  try {
    store().removeItem(CHOICES_KEY);
  } catch {
    /* ignore */
  }
}

export function markHouseAdded(store: () => Store): void {
  try {
    store().setItem(ADDED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function deviceAddedHouse(store: () => Store): boolean {
  try {
    return store().getItem(ADDED_KEY) === '1';
  } catch {
    return false;
  }
}

// ---------- /auth/confirm/ ----------

export const NEXT_PATHS = ['/account/', '/subscribed/'] as const;
export type NextPath = (typeof NEXT_PATHS)[number] | '/';

/** B9: `next` must be exactly one of the allowed paths; anything else (absent, absolute, encoded tricks) is '/'. */
export function safeNext(raw: string | null | undefined): NextPath {
  return (NEXT_PATHS as readonly string[]).includes(raw ?? '') ? (raw as NextPath) : '/';
}

/** Where a sign-in link lands after Save when the link itself carries no `next`. */
export function nextFor(choices: Choices | null, raw: string | null | undefined): NextPath {
  const n = safeNext(raw);
  if (n !== '/') return n;
  if (!choices) return '/';
  return choices.account ? '/account/' : '/subscribed/';
}

/**
 * The Auth templates link to `/auth/confirm/?token_hash=…&type=…` with no `next` (C3: `{{ .SiteURL }}` only), so the
 * page that sent the email records where its link should land, in this browser's sessionStorage. Only allowed paths.
 */
export function saveNext(store: () => Store, next: NextPath): void {
  try {
    if (next === '/') store().removeItem(NEXT_KEY);
    else store().setItem(NEXT_KEY, next);
  } catch {
    /* storage may be unavailable: the confirm page falls back to the choices or '/' */
  }
}

export function readNext(store: () => Store): NextPath | null {
  try {
    const n = safeNext(store().getItem(NEXT_KEY));
    return n === '/' ? null : n;
  } catch {
    return null;
  }
}

export function clearNext(store: () => Store): void {
  try {
    store().removeItem(NEXT_KEY);
  } catch {
    /* ignore */
  }
}

/** The link's own `next` when it is an allowed path, else the one this browser recorded, else null. */
export function confirmNext(raw: string | null | undefined, store: () => Store): NextPath | null {
  const n = safeNext(raw);
  return n !== '/' ? n : readNext(store);
}

export type ConfirmBranch = 'signin' | 'email_change' | 'recovery';
const SIGNIN_TYPES = ['magiclink', 'email', 'signup'];

export type ConfirmParams =
  | { ok: true; tokenHash: string; type: LinkOtpType; branch: ConfirmBranch; next: string | null }
  | { ok: false };

/** C3: explicit branches per type; anything else (or a missing/odd token_hash) is an error page. */
export function parseConfirm(search: string): ConfirmParams {
  const q = new URLSearchParams(search);
  const tokenHash = q.get('token_hash') ?? '';
  const type = q.get('type') ?? '';
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(tokenHash)) return { ok: false };
  let branch: ConfirmBranch;
  if (SIGNIN_TYPES.includes(type)) branch = 'signin';
  else if (type === 'email_change') branch = 'email_change';
  else if (type === 'recovery') branch = 'recovery';
  else return { ok: false };
  return { ok: true, tokenHash, type: type as LinkOtpType, branch, next: q.get('next') };
}

// ---------- the async steps (API injected) ----------

export interface FlowApi {
  sessionKind(): Promise<SessionKind>;
  beginHouseLink(email: string): Promise<void>;
  sendEmailCode(email: string, captchaToken: string, redirectTo: string): Promise<void>;
  setSubscription(regionSlug: string, prefs: SubscriptionPrefs): Promise<unknown>;
  completeHouseLink(): Promise<number>;
  signOutLocal(): Promise<void>;
}

/** The sign-in link's landing page. Uses this origin so local dev links come back to localhost. */
export function confirmRedirect(origin: string, account: boolean): string {
  return `${origin}/auth/confirm/?next=${encodeURIComponent(account ? '/account/' : '/subscribed/')}`;
}

/**
 * Before the code is sent. Only a session whose JWT says anonymous starts a house link (C5); a failure there is
 * not fatal (the person still subscribes, the houses just don't link). Then one OTP email.
 */
export async function sendCode(api: FlowApi, email: string, captchaToken: string, redirectTo: string): Promise<{ linkStarted: boolean }> {
  let linkStarted = false;
  if ((await api.sessionKind()) === 'anonymous') {
    try {
      await api.beginHouseLink(email);
      linkStarted = true;
    } catch {
      /* rate-limited or refused: subscribing still works */
    }
  }
  await api.sendEmailCode(email, captchaToken, redirectTo);
  return { linkStarted };
}

/**
 * After verification (code or link): save the choices (B2), link this device's houses (B3), and sign this
 * browser out when the account box was unchecked (B2). Returns how many houses were linked.
 */
export async function finishSubscription(api: FlowApi, regionSlug: string, c: Choices): Promise<{ linked: number; signedOut: boolean }> {
  await api.setSubscription(regionSlug, { houses: c.houses, events: c.events, cadence: c.cadence });
  let linked = 0;
  try {
    linked = await api.completeHouseLink();
  } catch {
    /* no pending link, or it expired: nothing to link */
  }
  let signedOut = false;
  if (!c.account) {
    try {
      await api.signOutLocal();
      signedOut = true;
    } catch {
      /* the choices are saved; a stuck local session only means this browser stays signed in */
    }
  }
  return { linked, signedOut };
}
