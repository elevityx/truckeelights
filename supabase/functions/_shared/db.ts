// Service-role data access (Amendment 2, C2). The ONLY place the subscribe Edge Functions touch the database:
// the `svc_*` routines in `public`, granted to service_role alone. The client is built from function env, server-side only.
// Row shapes mirror the migration; if a signature there changes, this is the one file to edit.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';
import { secretKey } from './http.ts';

export interface DigestHouse { id: string; address: string; town?: string | null }
export interface DigestEvent { id: string; title: string; starts_at: string }
export interface DigestRecipient {
  user_id: string;
  email: string;
  public_id: string;
  token_version: number;
  cadence: 'daily' | 'weekly';
  houses: DigestHouse[];
  events: DigestEvent[];
  houses_total: number;
  events_total: number;
  /** The high-water mark to store as last_sent_through once this email is sent. */
  window_through: string;
}
export interface BeginRun { run_id: string; sent_today: number }
export interface Prefs { status: 'active' | 'stopped'; houses: boolean; events: boolean; cadence: 'daily' | 'weekly'; token_version: number }
export type Cadence = 'daily' | 'weekly';

export interface DigestDb {
  beginRun(kind: Cadence, runDate: string): Promise<BeginRun>;
  pending(runId: string, limit: number): Promise<DigestRecipient[]>;
  /** Inserts or re-arms the `sending` row. False when this (run, user) is already `sent`. */
  claim(runId: string, userId: string): Promise<boolean>;
  mark(runId: string, userId: string, status: 'sent' | 'failed', providerId: string | null, errorCode: string | null, through: string | null): Promise<void>;
  finishRun(runId: string, sent: number, failed: number, capHit: boolean): Promise<void>;
}

export interface UnsubscribeDb {
  lookup(publicId: string): Promise<Prefs | null>;
  /** 'stopped' (also when already stopped at this version) or 'invalid' (unknown id or stale version). */
  stop(publicId: string, version: number): Promise<'stopped' | 'invalid'>;
  setPrefs(publicId: string, version: number, houses: boolean, events: boolean, cadence: Cadence): Promise<'ok' | 'invalid'>;
}

export interface AccountDb {
  /** Releases owned houses to unowned, deletes subscription and claims. 'forbidden' for anyone in public.admins. */
  deleteAccount(userId: string): Promise<'ok' | 'forbidden'>;
}

export function serviceClient(url: string): SupabaseClient | null {
  const key = secretKey();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

class RpcError extends Error {}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new RpcError(`rpc ${fn} failed`); // never include the provider message: it can carry row data
  return data as T;
}

function first<T>(data: T[] | T | null): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export function digestDb(sb: SupabaseClient): DigestDb {
  return {
    async beginRun(kind, runDate) {
      const row = first(await rpc<BeginRun[]>(sb, 'svc_digest_begin_run', { p_kind: kind, p_run_date: runDate }));
      if (!row) throw new RpcError('begin_run empty');
      return row;
    },
    async pending(runId, limit) {
      return (await rpc<DigestRecipient[] | null>(sb, 'svc_digest_pending', { p_run_id: runId, p_limit: limit })) ?? [];
    },
    async claim(runId, userId) {
      return (await rpc<boolean>(sb, 'svc_digest_claim', { p_run_id: runId, p_user_id: userId })) === true;
    },
    async mark(runId, userId, status, providerId, errorCode, through) {
      await rpc<null>(sb, 'svc_digest_mark', {
        p_run_id: runId, p_user_id: userId, p_status: status,
        p_provider_id: providerId, p_error_code: errorCode, p_through: through,
      });
    },
    async finishRun(runId, sent, failed, capHit) {
      await rpc<null>(sb, 'svc_digest_finish_run', { p_run_id: runId, p_sent: sent, p_failed: failed, p_cap_hit: capHit });
    },
  };
}

export function unsubscribeDb(sb: SupabaseClient): UnsubscribeDb {
  return {
    async lookup(publicId) {
      return first(await rpc<Prefs[] | null>(sb, 'svc_unsubscribe_lookup', { p_public_id: publicId }));
    },
    async stop(publicId, version) {
      const r = await rpc<string>(sb, 'svc_unsubscribe_stop', { p_public_id: publicId, p_token_version: version });
      return r === 'stopped' ? 'stopped' : 'invalid';
    },
    async setPrefs(publicId, version, houses, events, cadence) {
      const r = await rpc<string>(sb, 'svc_unsubscribe_set_prefs', {
        p_public_id: publicId, p_token_version: version, p_houses: houses, p_events: events, p_cadence: cadence,
      });
      return r === 'ok' ? 'ok' : 'invalid';
    },
  };
}

export function accountDb(sb: SupabaseClient): AccountDb {
  return {
    async deleteAccount(userId) {
      const r = await rpc<string>(sb, 'svc_delete_account', { p_user_id: userId });
      return r === 'ok' ? 'ok' : 'forbidden';
    },
  };
}
