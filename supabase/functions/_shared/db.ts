// Service-role data access (Amendment 2, C2). The ONLY place the subscribe Edge Functions touch the database:
// the `svc_*` routines in `public` (migration 20261016000200_subscribe_accounts.sql), granted to service_role alone.
// The client is built from function env, server-side only. Row shapes mirror that migration exactly; if a signature
// there changes, this is the one file to edit.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { secretKey } from './http.ts';

export type Cadence = 'daily' | 'weekly';
export interface DigestHouse { id: string; address: string; town?: string | null }
export interface DigestEvent { id: string; title: string; starts_at: string; venue?: string | null }

/** One row of `svc_digest_batch(run_id, limit)`. The row is already claimed (`sending`) when it is returned. */
export interface DigestRecipient {
  user_id: string;
  email: string;
  /** `run_id:user_id`, sent as Resend's Idempotency-Key. */
  idempotency_key: string;
  public_id: string;
  token_version: number;
  region_slug: string;
  region_name: string;
  timezone: string;
  cadence: Cadence;
  houses: DigestHouse[];
  house_total: number;
  events: DigestEvent[];
  event_total: number;
}

/** `svc_digest_finish(run_id)`: the run's totals from the ledger. */
export interface RunTotals { sent: number; failed: number; cap_hit: boolean }

/** `svc_unsubscribe_lookup(public_id, version)`: null for an unknown id or a bumped version. */
export interface Prefs { status: 'active' | 'stopped'; houses: boolean; events: boolean; cadence: Cadence; region_name: string }

export interface DigestDb {
  /** `svc_digest_start(kind, run_date)`: the run id; a rerun of the same (kind, Pacific date) resumes the same run. */
  start(kind: Cadence, runDate: string): Promise<string>;
  /**
   * `svc_digest_batch(run_id, limit)`: claims up to `limit` (max 100) recipients with something new, marks them
   * `sending`, and never goes past `app_settings.digest_daily_cap` (it sets the run's cap_hit when it stops there).
   * Rows already sent or failed in this run, and rows in flight (< 10 min), are not returned; a stale `sending` row
   * is returned again with the same idempotency key.
   */
  batch(runId: string, limit: number): Promise<DigestRecipient[]>;
  /** `svc_digest_mark(run_id, user_id, ok, error_code)`: ok -> sent (advances last_sent_through); else failed. */
  mark(runId: string, userId: string, ok: boolean, errorCode: string | null): Promise<boolean>;
  finish(runId: string): Promise<RunTotals>;
}

export interface UnsubscribeDb {
  lookup(publicId: string, version: number): Promise<Prefs | null>;
  /** 'stopped', or 'invalid' (unknown id, a bumped version, or already stopped: stopping bumps the version). */
  stop(publicId: string, version: number): Promise<'stopped' | 'invalid'>;
  setPrefs(publicId: string, version: number, houses: boolean, events: boolean, cadence: Cadence): Promise<'updated' | 'invalid'>;
}

export interface AccountDb {
  /** Unowns houses, deletes the subscription, claims and digest rows. 'forbidden' for anyone in public.admins. */
  deleteAccount(userId: string): Promise<'ok' | 'forbidden'>;
}

export function serviceClient(url: string): SupabaseClient | null {
  const key = secretKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class RpcError extends Error {
  constructor(message: string, readonly code: string | null = null) { super(message); }
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  // Never include the provider message: it can carry row data. The SQLSTATE alone is safe.
  if (error) throw new RpcError(`rpc ${fn} failed`, typeof error.code === 'string' ? error.code : null);
  return data as T;
}

function first<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export function digestDb(sb: SupabaseClient): DigestDb {
  return {
    async start(kind, runDate) {
      const id = await rpc<string | null>(sb, 'svc_digest_start', { p_kind: kind, p_run_date: runDate });
      if (typeof id !== 'string' || !id) throw new RpcError('svc_digest_start empty');
      return id;
    },
    async batch(runId, limit) {
      return (await rpc<DigestRecipient[] | null>(sb, 'svc_digest_batch', { p_run_id: runId, p_limit: limit })) ?? [];
    },
    async mark(runId, userId, ok, errorCode) {
      return (await rpc<boolean>(sb, 'svc_digest_mark', {
        p_run_id: runId, p_user_id: userId, p_ok: ok, p_error_code: errorCode,
      })) === true;
    },
    async finish(runId) {
      const row = first(await rpc<RunTotals[] | null>(sb, 'svc_digest_finish', { p_run_id: runId }));
      return row ?? { sent: 0, failed: 0, cap_hit: false };
    },
  };
}

export function unsubscribeDb(sb: SupabaseClient): UnsubscribeDb {
  return {
    async lookup(publicId, version) {
      return first(await rpc<Prefs[] | null>(sb, 'svc_unsubscribe_lookup', { p_public_id: publicId, p_version: version }));
    },
    async stop(publicId, version) {
      const r = await rpc<string>(sb, 'svc_unsubscribe_stop', { p_public_id: publicId, p_version: version });
      return r === 'stopped' ? 'stopped' : 'invalid';
    },
    async setPrefs(publicId, version, houses, events, cadence) {
      const r = await rpc<string>(sb, 'svc_unsubscribe_set_prefs', {
        p_public_id: publicId, p_version: version, p_houses: houses, p_events: events, p_cadence: cadence,
      });
      return r === 'updated' ? 'updated' : 'invalid';
    },
  };
}

export function accountDb(sb: SupabaseClient): AccountDb {
  return {
    async deleteAccount(userId) {
      try {
        await rpc<number>(sb, 'svc_delete_account', { p_user_id: userId }); // returns how many houses were unowned
        return 'ok';
      } catch (e) {
        if (e instanceof RpcError && e.code === '42501') return 'forbidden'; // admins are refused in SQL
        throw e;
      }
    },
  };
}
