// Shared helpers for the storage suites (spec WP-D, Amendment 1). LOCAL stack only.
// Files run serially (--test-concurrency=1) and in name order; each file creates its own houses
// and never resets the database. See 90_restore_check for the runner-restore assertion.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);
export const CAPTCHA_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'; // accepted by Cloudflare's always-pass TEST secret
const WORKDIR = process.env.TL_SUPABASE_WORKDIR;
const wd = WORKDIR ? ['--workdir', WORKDIR] : [];

function readStatus() {
  const out = execFileSync('supabase', ['status', '-o', 'json', ...wd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

const status = readStatus();
export const URL_ = process.env.SUPABASE_URL ?? status.API_URL;
export const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY ?? status.PUBLISHABLE_KEY ?? status.ANON_KEY;
export const SECRET = process.env.SUPABASE_SECRET_KEY ?? status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
if (!URL_ || !PUBLISHABLE || !SECRET) throw new Error('could not read API_URL / publishable / secret key from `supabase status`');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL_)) throw new Error(`refusing to run against a non-local URL: ${URL_}`);

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
export const newClient = (key = PUBLISHABLE) => createClient(URL_, key, noSession);
export const secretClient = () => newClient(SECRET);

// ---- SQL (as postgres, local only) ----
function parseRows(stdout) {
  const i = Math.min(...['{', '['].map((c) => { const k = stdout.indexOf(c); return k < 0 ? Infinity : k; }));
  if (!Number.isFinite(i)) return [];
  const j = JSON.parse(stdout.slice(i, Math.max(stdout.lastIndexOf('}'), stdout.lastIndexOf(']')) + 1));
  return Array.isArray(j) ? j : (j.rows ?? j.result ?? []);
}
const sqlArgs = (q) => ['db', 'query', '--local', '--output-format', 'json', ...wd, q];
export async function sql(q) {
  try {
    const { stdout } = await execFileAsync('supabase', sqlArgs(q), { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return parseRows(stdout);
  } catch (e) {
    throw new Error(`sql failed: ${(e.stderr || e.message || '').toString().slice(0, 600)} :: ${q.slice(0, 200)}`);
  }
}
export const sqlOne = async (q) => { const r = await sql(q); return r[0] ? Object.values(r[0])[0] : null; };
// Like sql(), but never throws; returns { ok, text } (used to see 40P01 in a racing child process).
export async function sqlRaw(q) {
  try { const { stdout, stderr } = await execFileAsync('supabase', sqlArgs(q), { encoding: 'utf8' }); return { ok: true, text: stdout + stderr }; }
  catch (e) { return { ok: false, text: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}` }; }
}
export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---- tiny valid JPEG (1x1) ----
export const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64');
export const jpegBlob = () => new Blob([JPEG], { type: 'image/jpeg' });

// ---- identities ----
export async function anonClient() {
  const c = newClient();
  const { data, error } = await c.auth.signInAnonymously({ options: { captchaToken: CAPTCHA_TEST_TOKEN } });
  assert.equal(error, null, `anonymous sign-in failed: ${error?.message}`);
  assert.ok(data.session);
  return c;
}

function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export function totp(secretB32, now = Date.now()) { // RFC 6238, SHA-1, 30 s, 6 digits
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(ctr).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

const ADMINS = {
  global: { id: '00000000-0000-4000-a000-00000000ad02', email: 'storage-admin@example.test', region: null },
  testville: { id: '00000000-0000-4000-a000-00000000ad52', email: 'storage-admin-b@example.test', region: 'testville' },
};
const ADMIN_PW = 'local-storage-admin-pw'; // fake, local stack only

/** AAL2 admin session. which = 'global' (all regions) or 'testville' (region admin of Testville only). */
export async function adminAal2(which = 'global') {
  const a = ADMINS[which];
  await sql(`
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values (${lit(a.id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', ${lit(a.email)},
      extensions.crypt(${lit(ADMIN_PW)}, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
    on conflict (id) do nothing`);
  await sql(`insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (${lit(a.id)}, 'email', ${lit(a.id)}, ${lit(JSON.stringify({ sub: a.id, email: a.email, email_verified: true }))}, now(), now(), now())
    on conflict do nothing`);
  await sql(`insert into public.admins (user_id, region_id, note)
    select ${lit(a.id)}, ${a.region ? `(select id from public.regions where slug = ${lit(a.region)})` : 'null'}, 'storage test admin'
    on conflict do nothing`);
  await sql(`delete from auth.mfa_factors where user_id = ${lit(a.id)}`);
  const c = newClient();
  const si = await c.auth.signInWithPassword({ email: a.email, password: ADMIN_PW, options: { captchaToken: CAPTCHA_TEST_TOKEN } });
  assert.equal(si.error, null, `admin sign-in failed: ${si.error?.message}`);
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `t${Date.now()}` });
  assert.equal(en.error, null, `mfa enroll failed: ${en.error?.message}`);
  const v = await c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
  assert.equal(v.error, null, `mfa verify failed: ${v.error?.message}`);
  return c;
}

// ---- fixtures ----
export const runId = () => crypto.randomBytes(4).toString('hex');

export async function enablePhotos(slugs = ['truckee', 'testville']) {
  await sql(`update public.site_settings set photos_open = true, submissions_open = true
    where region_id in (select id from public.regions where slug in (${slugs.map(lit).join(',')}))`);
}

/** Own house per call, via SQL (no reset, unique address). Returns { id, regionId, slug }. */
export async function makeHouse(slug = 'truckee', tag = 'h') {
  const addr = `${Math.floor(Math.random() * 900) + 100} Storage${tag}${runId()} Rd, ${slug}`;
  const r = await sql(`insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
    select s.region_id, s.active_season, s.active_year, ${lit(addr)}, private.normalize_address(${lit(addr)}),
           (rg.min_lat + rg.max_lat) / 2, (rg.min_lng + rg.max_lng) / 2, 'admin', 'visible'
      from public.site_settings s join public.regions rg on rg.id = s.region_id where rg.slug = ${lit(slug)}
    returning id, region_id`);
  assert.equal(r.length, 1, 'house insert failed');
  return { id: r[0].id, regionId: r[0].region_id, slug };
}

const first = (d) => (Array.isArray(d) ? d[0] : d);

/** reserve -> upload -> (optionally) confirm as `user`. Returns { photoId, uploadPath, confirm }. */
export async function uploadPhoto(user, houseId, { confirm = true } = {}) {
  const r = await user.rpc('reserve_photo', { p_house_id: houseId });
  assert.equal(r.error, null, `reserve_photo: ${r.error?.message}`);
  const { photo_id: photoId, upload_path: uploadPath } = first(r.data);
  const up = await user.storage.from('photo-uploads').upload(uploadPath, jpegBlob(), { contentType: 'image/jpeg', upsert: false });
  assert.equal(up.error, null, `upload: ${up.error?.message}`);
  let result = null;
  if (confirm) {
    const c = await user.rpc('confirm_photo_upload', { p_photo_id: photoId });
    assert.equal(c.error, null, `confirm_photo_upload: ${c.error?.message}`);
    result = c.data;
  }
  return { photoId, uploadPath, confirm: result };
}

/** Approve exactly as adminApprovePhoto does: fetch pending object, upload as {house}/{uuid}.jpg, call RPC. */
export async function approvePhoto(admin, { regionId, houseId, photoId }) {
  const q = await admin.rpc('admin_photo_queue', { p_region_id: regionId, p_status: 'pending' });
  assert.equal(q.error, null, `admin_photo_queue: ${q.error?.message}`);
  const row = q.data.find((p) => p.id === photoId);
  assert.ok(row?.upload_path, 'photo not in pending queue');
  const s = await admin.storage.from('photo-uploads').createSignedUrl(row.upload_path, 60);
  assert.equal(s.error, null, `admin sign pending: ${s.error?.message}`);
  const bytes = Buffer.from(await (await fetch(s.data.signedUrl)).arrayBuffer());
  const publicPath = `${houseId}/${crypto.randomUUID()}.jpg`;
  const up = await admin.storage.from('photos').upload(publicPath, bytes, { contentType: 'image/jpeg', upsert: false });
  assert.equal(up.error, null, `admin upload approved copy: ${up.error?.message}`);
  const a = await admin.rpc('admin_approve_photo', { p_photo_id: photoId, p_public_path: publicPath });
  assert.equal(a.error, null, `admin_approve_photo: ${a.error?.message}`);
  return publicPath;
}

/** 10-year signed URL minted with the local secret key: stands in for a leaked URL (Amendment 1). */
export async function leakedUrl(bucket, path) {
  const { data, error } = await secretClient().storage.from(bucket).createSignedUrl(path, 315360000);
  assert.equal(error, null, `secret-key sign: ${error?.message}`);
  return data.signedUrl;
}
export const fetchStatus = async (u) => (await fetch(u)).status;

export const objectExists = async (bucket, name) =>
  Number(await sqlOne(`select count(*) from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(name)}`)) > 0;

/** Poll until `pred()` is true or timeout. */
export async function waitFor(pred, ms = 15000, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await pred()) return true; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

const prefixArr = (houseIds) => `array[${houseIds.map(lit).join(',')}]::text[]`;
export const openJobsSql = (houseIds) => `select count(*) from private.storage_jobs where done_at is null
  and (split_part(object_name, '/', 1) = any(${prefixArr(houseIds)}) or split_part(coalesce(new_object_name, ''), '/', 1) = any(${prefixArr(houseIds)}))`;

/** Runs the runner (as the cron would) until no open job remains for these houses, up to 15 s. */
export async function runJobs(houseIds) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    await sql('select private.run_storage_jobs(50, null)');
    if (Number(await sqlOne(openJobsSql(houseIds))) === 0) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return Number(await sqlOne(openJobsSql(houseIds))) === 0;
}

/** The admin browser fallback (WP-C), step by step. Delete kinds remove; rotate copies THEN removes (no move). */
export async function fallbackAction(admin, job) {
  const store = admin.storage.from(job.bucket);
  if (job.kind === 'rotate_public') {
    const c = await store.copy(job.object_name, job.new_object_name);
    if (c.error && !/exist|duplicate/i.test(c.error.message)) throw new Error(`fallback copy: ${c.error.message}`);
  }
  const r = await store.remove([job.object_name]);
  if (r.error && !/not.?found/i.test(r.error.message)) throw new Error(`fallback remove: ${r.error.message}`);
}
export async function openJobsFor(admin, regionId, houseIds) {
  const r = await admin.rpc('admin_storage_jobs', { p_region_id: regionId });
  assert.equal(r.error, null, `admin_storage_jobs: ${r.error?.message}`);
  return r.data.filter((j) => houseIds.includes(String(j.object_name).split('/')[0]));
}
export async function complete(admin, jobId) {
  const r = await admin.rpc('admin_complete_storage_job', { p_job_id: jobId });
  return r;
}
/** Full fallback pass for these houses. Returns [{ job, done }]. */
export async function runFallback(admin, regionId, houseIds) {
  const out = [];
  for (const job of await openJobsFor(admin, regionId, houseIds)) {
    await fallbackAction(admin, job);
    const r = await complete(admin, job.id);
    assert.equal(r.error, null, `admin_complete_storage_job: ${r.error?.message}`);
    out.push({ job, done: r.data });
  }
  return out;
}

// ---- runner control (Amendment 1: idempotent private helpers) ----
export async function snapshotRunner() {
  const rows = await sql(`select name, decrypted_secret from vault.decrypted_secrets where name in ('storage_api_url','storage_api_key')`);
  const m = Object.fromEntries(rows.map((r) => [r.name, r.decrypted_secret]));
  assert.ok(m.storage_api_url && m.storage_api_key, 'runner Vault secrets missing: run `npm run db:reset` (storage-jobs-local.sh)');
  return m;
}
export const runnerDown = async () => {
  await sql(`select private.set_storage_runner(false)`);
  await sql(`select private.set_runner_secret('storage_api_url', 'http://127.0.0.1:9')`);
};
export const runnerRestore = async (snap) => {
  await sql(`select private.set_runner_secret('storage_api_url', ${lit(snap.storage_api_url)})`);
  await sql(`select private.set_runner_secret('storage_api_key', ${lit(snap.storage_api_key)})`);
  await sql(`select private.set_storage_runner(true)`);
};
