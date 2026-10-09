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
  /** The run the `digest_sends` row belongs to: this run, or an earlier one when an unresolved send is resumed. */
  run_id: string;
  user_id: string;
  email: string;
  /** Stored on the row: `digest:<public_id>:<window start ISO>/<window end ISO>`, Resend's Idempotency-Key on every attempt. */
  idempotency_key: string;
  /** End of the row's content window (ISO). Anything time-based in the email derives from it, so a retry is identical. */
  window_to: string;
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
  /**
   * The email stored on the row by `svc_digest_store_payload` when it was first claimed, or null (a new claim, or a
   * crash before the store: Resend never saw the key, so a fresh render is safe). A resumed row with a payload is sent
   * from it verbatim, never re-rendered.
   */
  payload: StoredPayload | null;
}

/** The exact email sent for a `digest_sends` row (jsonb on the row). */
export interface StoredPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** `svc_digest_finish(run_id)`: the run's totals from the ledger. */
export interface RunTotals { sent: number; failed: number; cap_hit: boolean }

/** `svc_unsubscribe_lookup(public_id, version)`: null for an unknown id or a bumped version. */
export interface Prefs { status: 'active' | 'stopped'; houses: boolean; events: boolean; cadence: Cadence; region_name: string }

export interface DigestDb {
  /** `svc_digest_start(kind, run_date)`: the run id; a rerun of the same (kind, Pacific date) resumes the same run. */
  start(kind: Cadence, runDate: string): Promise<string>;
  /**
   * `svc_digest_batch(run_id, limit)`: claims up to `limit` (max 100) recipients, marks them `sending`, and never goes
   * past `app_settings.digest_daily_cap` (it sets the run's cap_hit when it stops there). An unresolved `sending` row
   * from any run that has been idle for 5 minutes is resumed first, with its own run id, key and window; otherwise
   * people with something new and no row in this run get a new row and key.
   */
  batch(runId: string, limit: number): Promise<DigestRecipient[]>;
  /**
   * `svc_digest_mark(row run_id, user_id, ok, error_code)` after a DEFINITE outcome: ok -> sent (advances
   * last_sent_through); else failed. Ambiguous outcomes are not marked (the row stays `sending` and is resumed).
   */
  mark(runId: string, userId: string, ok: boolean, errorCode: string | null): Promise<boolean>;
  /**
   * `svc_digest_store_payload(run_id, user_id, subject, html, text, from, to, headers)` BEFORE the provider call:
   * stores the rendered email on the `sending` row once. Throws on a different payload already stored
   * (payload_conflict) or no `sending` row; the caller then does not send.
   */
  storePayload(runId: string, userId: string, payload: StoredPayload): Promise<void>;
  finish(runId: string): Promise<RunTotals>;
}

export type StopResult = 'stopped' | 'already_stopped' | 'invalid';

export interface UnsubscribeDb {
  lookup(publicId: string, version: number): Promise<Prefs | null>;
  /**
   * 'stopped'; 'already_stopped' for a retry of the same link (stopping does not bump the version); 'invalid' for an
   * unknown id or a version bumped by a resubscribe.
   */
  stop(publicId: string, version: number): Promise<StopResult>;
  setPrefs(publicId: string, version: number, houses: boolean, events: boolean, cadence: Cadence): Promise<'updated' | 'invalid'>;
}

export interface AccountDb {
  /**
   * `svc_delete_account_check`: read-only, before anything changes. 'forbidden' for anyone in public.admins, 'gone'
   * when the auth user no longer exists (a retry after a successful auth delete), else 'ok'.
   */
  checkDelete(userId: string): Promise<'ok' | 'forbidden' | 'gone'>;
  /** `svc_delete_account`: idempotent cleanup AFTER the auth user is deleted (the FKs already did the real work). */
  cleanupDeleted(userId: string): Promise<void>;
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
    async storePayload(runId, userId, p) {
      const r = await rpc<string>(sb, 'svc_digest_store_payload', {
        p_run_id: runId, p_user_id: userId, p_subject: p.subject, p_html: p.html, p_text: p.text,
        p_from: p.from, p_to: p.to, p_headers: p.headers,
      });
      if (r !== 'stored' && r !== 'same') throw new RpcError('svc_digest_store_payload unexpected');
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
      return r === 'stopped' || r === 'already_stopped' ? r : 'invalid';
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
    async checkDelete(userId) {
      const r = await rpc<string>(sb, 'svc_delete_account_check', { p_user_id: userId });
      if (r === 'ok' || r === 'gone') return r;
      return 'forbidden'; // admins, and anything unexpected: fail closed
    },
    async cleanupDeleted(userId) {
      await rpc<number>(sb, 'svc_delete_account', { p_user_id: userId }); // returns how many houses it unowned (0)
    },
  };
}
