// Owner: sub/ui. The `/unsubscribe/` page's calls to the `unsubscribe` Edge Function (B8, C2). The emailed
// token (`public_id.version.purpose.exp.sig`) is the only credential; there is no sign-in. GETs never change
// anything; every change is a POST.
// Contract (sub/fn `unsubscribe`, JSON body `{ t, action }`):
//   action 'stop' -> 200 { status: 'stopped' }                         (any valid token)
//   action 'get'  -> 200 { status, houses, events, cadence }           (prefs tokens only, else 403 forbidden)
//   action 'set'  -> 200 { status: 'saved' }; also takes houses, events, cadence (prefs tokens only)
//   errors        -> 4xx/5xx { error: 'token_invalid' | 'token_expired' | 'forbidden' | 'invalid_input' | 'unavailable' }
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError, type SubscriptionCadence, type SubscriptionPrefs, type SubscriptionStatus } from './types';

export type LinkPurpose = 'unsub' | 'prefs';
export interface LinkPrefs extends SubscriptionPrefs {
  status: SubscriptionStatus;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The purpose of a well-formed token, read from its shape only (the function checks the signature). */
export function tokenPurpose(t: string | null | undefined): LinkPurpose | null {
  if (!t || t.length > 300) return null;
  const p = t.split('.');
  if (p.length !== 5 || !UUID.test(p[0]) || !/^[1-9]\d{0,8}$/.test(p[1]) || !/^[A-Za-z0-9_-]+$/.test(p[4])) return null;
  if (p[2] === 'unsub' && p[3] === '0') return 'unsub';
  if (p[2] === 'prefs' && /^[1-9]\d{0,11}$/.test(p[3])) return 'prefs';
  return null;
}

/** A prefs token whose `exp` (seconds) has passed; the server decides too. */
export function tokenExpired(t: string, nowMs: number): boolean {
  const p = t.split('.');
  return p[2] === 'prefs' && Number(p[3]) * 1000 <= nowMs;
}

const LINK_ERRORS = ['token_invalid', 'token_expired', 'forbidden', 'invalid_input', 'rate_limited'] as const;

export function toLinkPrefs(d: unknown): LinkPrefs {
  const r = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const cadence: SubscriptionCadence = r.cadence === 'weekly' ? 'weekly' : 'daily';
  return { status: r.status === 'stopped' ? 'stopped' : 'active', houses: r.houses === true, events: r.events === true, cadence };
}

async function post(body: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await getSupabase().functions.invoke('unsubscribe', { method: 'POST', body });
    if (!error) return data;
    const ctx = (error as { context?: unknown }).context;
    let code = '';
    if (ctx && typeof (ctx as Response).json === 'function') {
      try {
        const b = (await (ctx as Response).clone().json()) as { error?: unknown };
        code = typeof b.error === 'string' ? b.error : '';
      } catch {
        /* not JSON */
      }
    }
    throw new DataError((LINK_ERRORS as readonly string[]).includes(code) ? (code as (typeof LINK_ERRORS)[number]) : 'unknown');
  } catch (e) {
    throw e instanceof DataError ? e : toDataError(e);
  }
}

/** Current choices; prefs links only. */
export async function readLinkPrefs(t: string): Promise<LinkPrefs> {
  return toLinkPrefs(await post({ t, action: 'get' }));
}

export async function stopByLink(t: string): Promise<void> {
  await post({ t, action: 'stop' });
}

/** Saves new choices; prefs links only. Returns what was saved. */
export async function savePrefsByLink(t: string, prefs: SubscriptionPrefs): Promise<LinkPrefs> {
  await post({ t, action: 'set', houses: prefs.houses, events: prefs.events, cadence: prefs.cadence });
  return { status: 'active', houses: prefs.houses, events: prefs.events, cadence: prefs.cadence };
}
