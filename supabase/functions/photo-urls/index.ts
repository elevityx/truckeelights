// photo-urls: the ONLY issuer of public photo URLs (Amendment 1, D29).
// Input: { house_id } only. The bucket, TTL, and paths are fixed here or come from the database:
// public.photo_sign_paths (service_role only) returns the newest approved photos of a PUBLIC house (max 20).
// Authorization comes from that data, not the caller, so verify_jwt is off (config.toml). Logs nothing but status codes.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const BUCKET = 'photos';
const TTL_SECONDS = 3600;
const HOUSE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function secretKey(): string | undefined {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch { /* fall through */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

// Local stack only: the runtime reaches the API as http://kong:8000, which a browser can't resolve. Rewrite the
// origin to the loopback address the caller used. Hosted SUPABASE_URL is already public and is never rewritten.
function publicOrigin(apiUrl: string, req: Request): string | null {
  if (new URL(apiUrl).hostname !== 'kong') return null;
  const host = req.headers.get('x-forwarded-host') ?? '';
  const port = req.headers.get('x-forwarded-port') ?? '';
  if (!/^(127\.0\.0\.1|localhost)$/.test(host) || !/^\d{1,5}$/.test(port)) return null;
  return `http://${host}:${port}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let houseId: unknown;
  try {
    houseId = ((await req.json()) as { house_id?: unknown })?.house_id;
  } catch {
    return json(400, { error: 'invalid_input' });
  }
  if (typeof houseId !== 'string' || !HOUSE_ID.test(houseId)) return json(400, { error: 'invalid_input' });

  const url = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) { console.error('500 not configured'); return json(500, { error: 'unavailable' }); }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: rows, error } = await sb.rpc('photo_sign_paths', { p_house_id: houseId });
  if (error) { console.error('502 rpc'); return json(502, { error: 'unavailable' }); }
  const list = (rows ?? []) as { id: string; public_path: string }[];
  if (list.length === 0) return json(200, { photos: [] });

  const { data: signed, error: signError } = await sb.storage.from(BUCKET)
    .createSignedUrls(list.map((r) => r.public_path), TTL_SECONDS);
  if (signError || !signed) { console.error('502 sign'); return json(502, { error: 'unavailable' }); }
  const byPath = new Map(signed.filter((s) => !s.error && s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  const origin = publicOrigin(url, req);
  const photos = list.flatMap((r) => {
    const u = byPath.get(r.public_path);
    if (!u) return [];
    return [{ id: r.id, url: origin ? origin + new URL(u).pathname + new URL(u).search : u }];
  });
  return json(200, { photos });
});
