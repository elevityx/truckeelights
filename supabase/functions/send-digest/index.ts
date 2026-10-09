// send-digest: invoked by pg_cron through pg_net with a bearer secret from Vault (B7). Not a user endpoint.
// Authority: the bearer is compared in constant time to DIGEST_CRON_SECRET; the service-role key never leaves function env.
// It calls only svc_digest_* routines. Logs only counts and ids.
// Env: DIGEST_CRON_SECRET, RESEND_API_KEY, UNSUBSCRIBE_HMAC_SECRET, DIGEST_DAILY_CAP (default 60), DIGEST_FROM, SITE_URL.
import { digestDb, serviceClient, type Cadence } from '../_shared/db.ts';
import { runDigest, type RunConfig, type RunDeps, type RunSummary } from '../_shared/digestRun.ts';
import { json, siteUrl, timingSafeEqual } from '../_shared/http.ts';
import { dueKinds } from '../_shared/pacific.ts';

export interface DigestEnv {
  cronSecret: string;
  config: RunConfig;
}

export function readEnv(now: () => Date = () => new Date()): DigestEnv | null {
  const cronSecret = Deno.env.get('DIGEST_CRON_SECRET');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const hmacSecret = Deno.env.get('UNSUBSCRIBE_HMAC_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!cronSecret || !resendKey || !hmacSecret || !base) return null;
  const cap = Number.parseInt(Deno.env.get('DIGEST_DAILY_CAP') ?? '60', 10);
  return {
    cronSecret,
    config: {
      siteUrl: siteUrl(),
      functionsUrl: `${base.replace(/\/+$/, '')}/functions/v1`,
      from: Deno.env.get('DIGEST_FROM') ?? 'Truckee Lights <digest@mail.truckeelights.com>',
      hmacSecret, resendKey,
      dailyCap: Number.isFinite(cap) ? Math.min(Math.max(cap, 0), 100) : 60,
      paceMs: 600, // Resend's default is 2 requests per second
      now,
    },
  };
}

export async function handle(req: Request, env: DigestEnv | null, deps: RunDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!env) { console.error('500 not configured'); return json(500, { error: 'unavailable' }); }
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!bearer || !timingSafeEqual(bearer, env.cronSecret)) return json(401, { error: 'unauthorized' });

  let body: { kind?: unknown } = {};
  try { body = (await req.json()) as { kind?: unknown }; } catch { /* cron may send an empty body */ }
  const now = env.config.now();
  const due = dueKinds(now);
  // An explicit kind (rehearsal) bypasses the 18:xx Pacific gate but is still bearer-authenticated.
  const kinds: Cadence[] = body.kind === 'daily' || body.kind === 'weekly' ? [body.kind] : due.kinds;
  if (kinds.length === 0) return json(200, { skipped: 'not_due', runs: [] });

  const runs: RunSummary[] = [];
  try {
    for (const k of kinds) runs.push(await runDigest(k, due.date, env.config, deps));
  } catch {
    console.error('502 run');
    return json(502, { error: 'unavailable', runs });
  }
  return json(200, { runs });
}

if (import.meta.main) {
  const env = readEnv();
  const sb = serviceClient(Deno.env.get('SUPABASE_URL') ?? '');
  Deno.serve((req) => {
    if (!sb) { console.error('500 not configured'); return Promise.resolve(json(500, { error: 'unavailable' })); }
    return handle(req, env, { db: digestDb(sb), log: (l) => console.log(l) });
  });
}
