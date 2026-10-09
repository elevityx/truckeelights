// delete-account: the signed-in person deletes their own account (B7, C4).
// The user comes ONLY from the verified JWT (no body user id). Requires a non-anonymous session whose `amr` shows a
// fresh email code or link sign-in (within 10 minutes). Admins are refused. Houses are never removed: owned houses become
// unowned. The service-role key stays in function env. Logs only status codes.
import { accountDb, serviceClient, type AccountDb } from '../_shared/db.ts';
import { corsHeaders, json, siteUrl } from '../_shared/http.ts';

export const FRESH_SECONDS = 600;
const METHODS = 'POST, OPTIONS';

export interface DeleteDeps {
  site: string;
  now: () => Date;
  /** Verifies the token with the auth server and returns the user id, or null. */
  verify(jwt: string): Promise<{ id: string } | null>;
  db: AccountDb;
  deleteAuthUser(userId: string): Promise<boolean>;
}

interface Claims { is_anonymous?: boolean; amr?: { method?: string; timestamp?: number }[] }

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
  if (!isFresh(claims, Math.floor(deps.now().getTime() / 1000))) return json(403, { error: 'reauth_required' }, cors);
  try {
    if ((await deps.db.deleteAccount(user.id)) !== 'ok') return json(403, { error: 'forbidden' }, cors);
    if (!(await deps.deleteAuthUser(user.id))) { console.error('502 delete'); return json(502, { error: 'unavailable' }, cors); }
  } catch {
    console.error('502 rpc');
    return json(502, { error: 'unavailable' }, cors);
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
        return error || !data.user ? null : { id: data.user.id };
      },
      db: accountDb(sb),
      deleteAuthUser: async (id) => !(await sb.auth.admin.deleteUser(id)).error,
    });
  });
}
