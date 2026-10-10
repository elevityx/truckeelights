// delete-account: the signed-in person deletes their own account (B7, C4).
// The user comes ONLY from the verified JWT (no body user id). Requires a non-anonymous session whose `amr` shows a
// fresh email code or link sign-in (within 10 minutes). Admins are refused. Houses are never removed: owned houses become
// unowned. The service-role key stays in function env. Logs only status codes.
// Order: (1) a read-only check (admins refused), (2) auth.admin.deleteUser FIRST, where the database FKs remove the
// subscription, claims, digest rows and links and unown houses in one step, (3) an idempotent cleanup for anything not
// FK-covered.
// Idempotent and honest about ambiguity: if (2) errors or its response is lost, the delete may still have committed,
// so the function re-reads whether the Auth user exists (service authority). Gone -> cleanup and 200. Still there ->
// 503 `retry` (nothing changed). Can't tell -> 503 `retry`. A retry with the same token works even after the Auth
// user is gone: Auth verifies the token's signature and answers user_not_found, the database confirms `gone`, and
// the request runs the cleanup and returns 200 (no fresh-sign-in demand: a deleted user cannot sign in again).
import { accountDb, serviceClient, type AccountDb } from '../_shared/db.ts';
import { corsHeaders, json, siteUrl } from '../_shared/http.ts';

export const FRESH_SECONDS = 600;
const METHODS = 'POST, OPTIONS';

export interface DeleteDeps {
  site: string;
  now: () => Date;
  /**
   * Verifies the token with the auth server: the user id, with `gone: true` when the signature is valid but the user
   * no longer exists (Auth's user_not_found); null when the token is not valid.
   */
  verify(jwt: string): Promise<{ id: string; gone?: boolean } | null>;
  db: AccountDb;
  /** true when Auth confirms the delete; false or a throw is ambiguous (the delete may have committed anyway). */
  deleteAuthUser(userId: string): Promise<boolean>;
}

interface Claims { sub?: string; is_anonymous?: boolean; amr?: { method?: string; timestamp?: number }[] }

export function decodeClaims(jwt: string): Claims | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as Claims;
  } catch { return null; }
}

/** True when the session was established by an email code or link within the last 10 minutes. */
export function isFresh(claims: Claims, nowSeconds: number): boolean {
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  return amr.some((e) =>
    (e?.method === 'otp' || e?.method === 'magiclink') && typeof e.timestamp === 'number' &&
    e.timestamp <= nowSeconds + 60 && nowSeconds - e.timestamp <= FRESH_SECONDS);
}

export async function handle(req: Request, deps: DeleteDeps): Promise<Response> {
  const cors = corsHeaders(deps.site, METHODS);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);
  const auth = req.headers.get('authorization') ?? '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return json(401, { error: 'not_signed_in' }, cors);
  const user = await deps.verify(jwt).catch(() => null);
  const claims = user ? decodeClaims(jwt) : null;
  if (!user || !claims) return json(401, { error: 'not_signed_in' }, cors);
  if (claims.is_anonymous !== false) return json(401, { error: 'not_signed_in' }, cors);
  // A live account needs a fresh email sign-in; a retry after the Auth user is already gone does not (it can't).
  if (!user.gone && !isFresh(claims, Math.floor(deps.now().getTime() / 1000))) return json(403, { error: 'reauth_required' }, cors);
  let check: 'ok' | 'forbidden' | 'gone';
  try {
    check = await deps.db.checkDelete(user.id);
  } catch {
    console.error('503 rpc');
    return json(503, { error: 'retry' }, cors); // nothing changed yet
  }
  if (check === 'forbidden') return json(403, { error: 'forbidden' }, cors);
  if (user.gone && check !== 'gone') return json(401, { error: 'not_signed_in' }, cors); // Auth and database disagree: fail closed
  if (check === 'ok') {
    let deleted = false;
    try { deleted = await deps.deleteAuthUser(user.id); } catch { deleted = false; }
    if (!deleted) {
      // Ambiguous: the delete may have committed before its response was lost. Ask the database whether the user
      // still exists rather than claiming that nothing changed.
      let after: 'ok' | 'forbidden' | 'gone' | 'unknown';
      try { after = await deps.db.checkDelete(user.id); } catch { after = 'unknown'; }
      if (after !== 'gone') {
        console.error(`503 delete ${after === 'ok' ? 'not_deleted' : 'unknown'}`);
        return json(503, { error: 'retry' }, cors); // safe to repeat: the same token still works either way
      }
    }
  }
  try {
    await deps.db.cleanupDeleted(user.id);
  } catch {
    // The account is already gone and the FKs did the real work; the cleanup is belt and braces.
    console.error('cleanup failed');
  }
  return json(200, { deleted: true }, cors);
}

if (import.meta.main) {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const sb = serviceClient(url);
  Deno.serve((req) => {
    if (!sb) { console.error('500 not configured'); return Promise.resolve(json(500, { error: 'unavailable' })); }
    return handle(req, {
      site: siteUrl(),
      now: () => new Date(),
      verify: async (jwt) => {
        const { data, error } = await sb.auth.getUser(jwt);
        if (!error && data.user) return { id: data.user.id };
        // Auth checked the signature and found no such user: a retry after the delete committed. The id is the
        // token's own `sub`; the handler only proceeds when the database agrees the user is gone.
        const sub = decodeClaims(jwt)?.sub;
        if (error && (error as { code?: string }).code === 'user_not_found' && typeof sub === 'string' && sub) {
          return { id: sub, gone: true };
        }
        return null;
      },
      db: accountDb(sb),
      deleteAuthUser: async (id) => !(await sb.auth.admin.deleteUser(id)).error,
    });
  });
}
