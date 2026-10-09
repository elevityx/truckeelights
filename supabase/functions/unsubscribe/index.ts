// unsubscribe: one-click stop and no-sign-in preferences, driven by HMAC link tokens (B8).
// GET never changes anything: it 303s to the static /unsubscribe/ page. POST (one-click or from that page) acts.
// Env: UNSUBSCRIBE_HMAC_SECRET, SITE_URL. Calls only svc_unsubscribe_* routines. Logs nothing about the person.
import { serviceClient, unsubscribeDb, type Cadence, type UnsubscribeDb } from '../_shared/db.ts';
import { corsHeaders, json, siteUrl } from '../_shared/http.ts';
import { verifyToken, type TokenClaims } from '../_shared/token.ts';

export interface UnsubDeps {
  db: UnsubscribeDb;
  secret: string | undefined;
  site: string;
  now: () => Date;
}

const METHODS = 'GET, POST, OPTIONS';

async function readToken(req: Request): Promise<{ token: string | null; body: Record<string, unknown> }> {
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  const ct = req.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) body = (await req.json()) as Record<string, unknown>;
    else if (ct.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(await req.text()));
  } catch { body = {}; }
  const t = url.searchParams.get('t') ?? (typeof body.t === 'string' ? body.t : null);
  return { token: t, body };
}

export async function handle(req: Request, deps: UnsubDeps): Promise<Response> {
  const cors = corsHeaders(deps.site, METHODS);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method === 'GET') {
    // Never mutates. The token is only passed along; the page validates it when the person acts.
    const t = new URL(req.url).searchParams.get('t');
    const target = t && t.length <= 300 ? `${deps.site}/unsubscribe/?t=${encodeURIComponent(t)}` : `${deps.site}/unsubscribe/`;
    return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'no-store' } });
  }
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);
  if (!deps.secret) { console.error('500 not configured'); return json(500, { error: 'unavailable' }, cors); }

  const { token, body } = await readToken(req);
  if (!token) return json(400, { error: 'invalid_input' }, cors);
  const v = await verifyToken(deps.secret, token, Math.floor(deps.now().getTime() / 1000));
  if (!v.ok) return json(v.reason === 'expired' ? 410 : 400, { error: v.reason === 'expired' ? 'token_expired' : 'token_invalid' }, cors);
  const claims: TokenClaims = v;
  const action = typeof body.action === 'string' ? body.action : 'stop'; // the one-click body has no action: stop

  try {
    if (action === 'stop') {
      const r = await deps.db.stop(claims.publicId, claims.version);
      return r === 'stopped' ? json(200, { status: 'stopped' }, cors) : json(410, { error: 'token_invalid' }, cors);
    }
    if (claims.purpose !== 'prefs') return json(403, { error: 'forbidden' }, cors); // preferences need a prefs link
    if (action === 'get') {
      const p = await deps.db.lookup(claims.publicId, claims.version); // null for an unknown id or a bumped version
      if (!p) return json(410, { error: 'token_invalid' }, cors);
      return json(200, { status: p.status, houses: p.houses, events: p.events, cadence: p.cadence }, cors);
    }
    if (action === 'set') {
      const { houses, events, cadence } = body;
      if (typeof houses !== 'boolean' || typeof events !== 'boolean' || !(houses || events) || (cadence !== 'daily' && cadence !== 'weekly')) {
        return json(400, { error: 'invalid_input' }, cors);
      }
      const r = await deps.db.setPrefs(claims.publicId, claims.version, houses, events, cadence as Cadence);
      return r === 'updated' ? json(200, { status: 'saved' }, cors) : json(410, { error: 'token_invalid' }, cors);
    }
    return json(400, { error: 'invalid_input' }, cors);
  } catch {
    console.error('502 rpc');
    return json(502, { error: 'unavailable' }, cors);
  }
}

if (import.meta.main) {
  const sb = serviceClient(Deno.env.get('SUPABASE_URL') ?? '');
  Deno.serve((req) => {
    if (!sb) { console.error('500 not configured'); return Promise.resolve(json(500, { error: 'unavailable' })); }
    return handle(req, { db: unsubscribeDb(sb), secret: Deno.env.get('UNSUBSCRIBE_HMAC_SECRET'), site: siteUrl(), now: () => new Date() });
  });
}
