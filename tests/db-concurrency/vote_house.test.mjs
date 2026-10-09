// House votes concurrency (spec AC15-AC17, AC34-AC37b). LOCAL stack only, never skipped.
// Votes run as real parallel Postgres sessions, each one transaction:
//   begin; set local role authenticated; set request.jwt.claims + request.headers; vote_house(...); commit;
// so distinct uids need no anonymous sign-ins and the network header is injected directly. The sessions go
// through `docker exec <local db container> psql` because `supabase db query` runs one statement per call
// (no multi-statement transactions). AC34b checks the HTTP path through the local gateway.
// Each run creates its own regions/houses and deletes them afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { URL_, PUBLISHABLE, CAPTCHA_TEST_TOKEN, lit } from '../storage/_local.mjs'; // refuses non-local URLs

const PROJECT = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const CONTAINER = process.env.TL_DB_CONTAINER ?? `supabase_db_${PROJECT}`;
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) throw new Error(`unexpected local db container name: ${CONTAINER}`);
const POOL = 40;
const GLOBAL_ADMIN = '00000000-0000-4000-a000-00000000ad01'; // seeded local admin (global)

/** One psql session in the local db container. Never throws; returns { code, out, err }. */
function psql(script) {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'],
      { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
    p.stdin.end(script);
  });
}
/** Single-value query as postgres; throws on error. */
async function q(sqlText) {
  const r = await psql(sqlText);
  if (r.code !== 0) throw new Error(`psql failed: ${r.err.slice(0, 500)} :: ${sqlText.slice(0, 200)}`);
  return r.out.trim();
}
const qn = async (sqlText) => Number(await q(sqlText));

/** 'ok' | 'deadlock' | '<message>/<detail>' | '<message>' */
function classify(r) {
  if (/deadlock detected|40P01/.test(r.err)) return 'deadlock';
  if (r.code === 0) return 'ok';
  const m = r.err.match(/ERROR:\s+(\S+)/);
  const d = r.err.match(/DETAIL:\s+(\S+)/);
  return m ? `${m[1]}${d ? `/${d[1]}` : ''}` : `unknown:${r.code}:${r.err.slice(0, 200)}`;
}
// amr shapes as GoTrue emits them (captured by tests/storage/50_admin_amr.test.mjs); admins need password + TOTP.
const AMR_ANON = JSON.parse('[{"method":"anonymous","timestamp":1791564302}]');
const AMR_ADMIN = JSON.parse('[{"method":"totp","timestamp":1791564301},{"method":"password","timestamp":1791564300}]');
const claims = (uid, extra = {}) => JSON.stringify({ sub: uid, role: 'authenticated', is_anonymous: true, aal: 'aal1', amr: AMR_ANON, ...extra });
const tx = (claimsJson, headers, body) => `begin;
set local role authenticated;
select set_config('request.jwt.claims', ${lit(claimsJson)}, true) is not null;
select set_config('request.headers', ${lit(JSON.stringify(headers ?? {}))}, true) is not null;
${body}
commit;`;
const vote = (uid, house, ip = null, photo = null) => psql(tx(claims(uid), ip ? { 'cf-connecting-ip': ip } : {},
  `select 'OK|' || total_votes || '|' || left_today from public.vote_house(${lit(house)}, ${photo ? lit(photo) : 'null'});`));
const voidAll = (house) => psql(tx(claims(GLOBAL_ADMIN, { is_anonymous: false, aal: 'aal2', amr: AMR_ADMIN }), {},
  `select 'VOID|' || public.admin_void_votes(${lit(house)}, null, null);`));

/** Run thunks with at most `n` in flight; results in input order. */
async function pool(thunks, n = POOL) {
  const out = new Array(thunks.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, thunks.length) }, async () => {
    while (i < thunks.length) { const k = i; i += 1; out[k] = await thunks[k](); }
  }));
  return out;
}
const tally = (results) => results.map(classify).reduce((t, c) => ({ ...t, [c]: (t[c] ?? 0) + 1 }), {});
const uuid = () => crypto.randomUUID();
const tag = () => crypto.randomBytes(4).toString('hex');
const v4 = (i) => `203.0.113.${i % 256}`;
const v6 = (i) => `2001:db8:${(0x1000 + i).toString(16)}:${(i % 65536).toString(16)}::1`;   // distinct /64 per i

const created = { regions: [], rehearsal: false };
async function makeRegion(kind) {
  const slug = `votes-${kind}-${tag()}`;
  const id = await q(`insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
    values (${lit(slug)}, 'Votes Test', 20, 21, 20, 21, 20.5, 20.5, 12, 'America/Los_Angeles', true) returning id`);
  await q(`insert into public.site_settings (region_id, active_season, active_year, submissions_open) values (${lit(id)}, 'halloween', 2026, false)`);
  created.regions.push(id);
  return id;
}
async function makeHouses(regionId, n, label = 'h') {
  const t = tag();
  const out = await q(`insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source, status)
    select s.region_id, s.active_season, s.active_year, g || ' Vote${label}${t} Rd', g || ' vote${label}${t} rd',
           r.center_lat, r.center_lng, 'admin', 'visible'
      from public.site_settings s join public.regions r on r.id = s.region_id
     cross join generate_series(1, ${n}) g where s.region_id = ${lit(regionId)}
    returning id`);
  return out.split('\n').filter(Boolean);
}
const total = (house) => qn(`select coalesce((select votes from public.house_vote_totals where house_id = ${lit(house)}), 0)`);
const liveEvents = (house) => qn(`select count(*) from private.vote_events where house_id = ${lit(house)} and voided_at is null`);

let region; let breakerRegion;
before(async () => {
  assert.match(await q('select 1'), /^1$/, `local db container ${CONTAINER} must be reachable`);
  await q('update public.app_settings set vote_network_cap = true');   // local seed value; the cap tests need it on
  region = await makeRegion('main');
  breakerRegion = await makeRegion('brk');
});
after(async () => {
  for (const id of created.regions) {
    await q(`delete from public.houses where region_id = ${lit(id)}`);
    await q(`delete from public.site_settings where region_id = ${lit(id)}`);
    await q(`delete from public.regions where id = ${lit(id)}`);
  }
  if (created.rehearsal) {
    await q(`update private.storage_jobs set done_at = now(), last_error = 'votes test cleanup'
              where done_at is null and region_id = (select id from public.regions where slug = 'rehearsal')`);
    await q(`delete from public.houses where region_id = (select id from public.regions where slug = 'rehearsal')`);
    await q(`delete from public.site_settings where region_id = (select id from public.regions where slug = 'rehearsal')`);
    await q(`delete from public.regions where slug = 'rehearsal'`);
  }
});

test('AC15: 20 parallel votes from one uid on one house -> exactly 5 succeed, 15 house_daily', async () => {
  const [house] = await makeHouses(region, 1, 'a');
  const uid = uuid();
  const t = tally(await pool(Array.from({ length: 20 }, () => () => vote(uid, house, v4(15)))));
  assert.deepEqual(t, { ok: 5, 'rate_limited/house_daily': 15 });
  assert.equal(await total(house), 5);
});

test('AC16: 10 uids x 5 parallel votes on one house -> +50, no lost updates', async () => {
  const [house] = await makeHouses(region, 1, 'b');
  const uids = Array.from({ length: 10 }, uuid);
  const t = tally(await pool(uids.flatMap((u, i) => Array.from({ length: 5 }, () => () => vote(u, house, v4(100 + i))))));
  assert.deepEqual(t, { ok: 50 });
  assert.equal(await total(house), 50);
  assert.equal(await liveEvents(house), 50);
});

test('AC17: admin_void_votes racing 10 parallel votes -> counter = non-voided events, no 40P01', async () => {
  const [house] = await makeHouses(region, 1, 'c');
  await pool(Array.from({ length: 5 }, (_, i) => () => vote(uuid(), house, v4(30 + i))));
  const thunks = Array.from({ length: 10 }, (_, i) => () => vote(uuid(), house, v6(1700 + i)));
  thunks.splice(5, 0, () => voidAll(house));
  const t = tally(await pool(thunks));
  assert.equal(t.deadlock, undefined, 'no deadlock');
  assert.deepEqual(t, { ok: 11 });
  assert.equal(await total(house), await liveEvents(house));
});

test('AC34: 30 parallel votes from 10 uids on one network -> exactly 25 commit, 5 network_daily', async () => {
  const [house] = await makeHouses(region, 1, 'd');
  const uids = Array.from({ length: 10 }, uuid);
  const t = tally(await pool(uids.flatMap((u) => [0, 1, 2].map(() => () => vote(u, house, '203.0.113.77')))));
  assert.deepEqual(t, { ok: 25, 'rate_limited/network_daily': 5 });
  assert.equal(await total(house), 25);
  assert.equal(await liveEvents(house), 25);
  assert.equal(await qn(`select count(*) from private.vote_events where house_id = ${lit(house)} and octet_length(net_hash) = 16`), 25);
});

test('AC34b: the local gateway forwards cf-connecting-ip (HTTP path; a mismatch fails, never skips)', async () => {
  const ip = '203.0.113.50';
  const opts = { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { 'cf-connecting-ip': ip } } };
  const probe = createClient(URL_, PUBLISHABLE, opts);
  const nonce = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await probe.rpc('network_probe', { p_nonce: nonce });
  assert.equal(error, null, error?.message);
  const row = Array.isArray(data) ? data[0] : data;
  assert.equal(row.source, 'cf-connecting-ip', 'the gateway must forward cf-connecting-ip to PostgREST');
  assert.equal(row.family, 4);
  assert.equal(row.digest, crypto.createHmac('sha256', nonce).update(`${ip}/32`).digest('hex'), 'digest = HMAC(ip/32, nonce)');

  const [house] = await makeHouses(region, 1, 'e');
  const sessions = await Promise.all([0, 1].map(async () => {
    const c = createClient(URL_, PUBLISHABLE, opts);
    const s = await c.auth.signInAnonymously({ options: { captchaToken: CAPTCHA_TEST_TOKEN } });
    assert.equal(s.error, null, `anonymous sign-in: ${s.error?.message}`);
    return c;
  }));
  const res = await Promise.all(sessions.flatMap((c) => [0, 1, 2].map(() => c.rpc('vote_house', { p_house_id: house, p_photo_id: null }))));
  assert.deepEqual(res.filter((r) => r.error).map((r) => r.error.message), []);
  assert.equal(await qn(`select count(*) from private.vote_events where house_id = ${lit(house)} and octet_length(net_hash) = 16`), 6,
    'all 6 HTTP votes stored a network hash');
});

test('AC35: 260 parallel votes on one house from distinct uids and networks -> exactly 200, overshoot 0', async () => {
  const [house] = await makeHouses(region, 1, 'f');
  const t = tally(await pool(Array.from({ length: 260 }, (_, i) => () => vote(uuid(), house, i < 200 ? v4(i) : v6(i)))));
  assert.deepEqual(t, { ok: 200, 'rate_limited/house_breaker': 60 });
  assert.equal(await total(house), 200);
  assert.equal(await liveEvents(house), 200);
});

test('AC36: region breaker: 1,990 recent events, then 40 parallel votes on 10 houses -> exactly 10 commit', async () => {
  const houses = await makeHouses(breakerRegion, 11, 'g');
  const filler = houses[10];
  await q(`insert into private.vote_events (house_id, region_id, season, year, uid, vote_day)
    select ${lit(filler)}, ${lit(breakerRegion)}, 'halloween', 2026, gen_random_uuid(), (now() at time zone 'America/Los_Angeles')::date
      from generate_series(1, 1990)`);
  const t = tally(await pool(Array.from({ length: 40 }, (_, i) => () => vote(uuid(), houses[i % 10], v6(3000 + i)))));
  assert.deepEqual(t, { ok: 10, 'rate_limited/region_breaker': 30 });
  assert.equal(await qn(`select count(*) from private.vote_events where region_id = ${lit(breakerRegion)}`), 2000);
});

test('AC37: vote_retention || admin_void_votes || 10 votes, 20x -> no 40P01, counter exact, past hashes cleared', async () => {
  for (let it = 0; it < 20; it += 1) {
    const [house] = await makeHouses(region, 1, `r${it}`);
    await q(`insert into private.vote_events (house_id, region_id, season, year, uid, vote_day, net_hash, created_at)
      select ${lit(house)}, ${lit(region)}, 'halloween', 2026, gen_random_uuid(),
             (now() at time zone 'America/Los_Angeles')::date - 1, extensions.gen_random_bytes(16), now() - interval '1 day'
        from generate_series(1, 500)`);
    await pool(Array.from({ length: 3 }, (_, i) => () => vote(uuid(), house, v4(40 + i))));   // totals row exists
    const thunks = Array.from({ length: 10 }, (_, i) => () => vote(uuid(), house, v6(5000 + it * 10 + i)));
    thunks.splice(3, 0, () => psql('select private.vote_retention();'));
    thunks.splice(7, 0, () => voidAll(house));
    const results = await pool(thunks);
    const cls = results.map(classify);
    assert.ok(!cls.includes('deadlock'), `iteration ${it}: deadlock: ${JSON.stringify(cls)}`);
    assert.deepEqual(cls.filter((c) => c !== 'ok'), [], `iteration ${it}: unexpected results ${JSON.stringify(cls)}`);
    assert.equal(await total(house), await liveEvents(house), `iteration ${it}: counter = non-voided events`);
    let left = await qn(`select count(*) from private.vote_events where house_id = ${lit(house)} and vote_day < (now() at time zone 'America/Los_Angeles')::date and net_hash is not null`);
    if (left > 0) {
      await q('select private.vote_retention()');
      left = await qn(`select count(*) from private.vote_events where house_id = ${lit(house)} and vote_day < (now() at time zone 'America/Los_Angeles')::date and net_hash is not null`);
    }
    assert.equal(left, 0, `iteration ${it}: past hashes null after at most one extra run`);
  }
});

// ---------------------------------------------------------------- AC37b: purge / season switch vs photo hearts
async function rehearsalReady() {
  let id = await q(`select id from public.regions where slug = 'rehearsal'`);
  if (!id) {
    id = await q(`insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
      values ('rehearsal', 'Rehearsal', 0.10, 0.20, -150.20, -150.10, 0.15, -150.15, 12, 'America/Los_Angeles', true) returning id`);
    created.rehearsal = true;
  }
  await q(`update public.regions set is_active = true where id = ${lit(id)}`);
  await q(`insert into public.site_settings (region_id, active_season, active_year, submissions_open, photos_open, votes_open)
    values (${lit(id)}, 'halloween', 2026, false, false, true)
    on conflict (region_id) do update set active_season = 'halloween', active_year = 2026, submissions_open = false, photos_open = false, votes_open = true`);
  return id;
}
/** 3 rehearsal houses with 1 approved photo row each (no storage objects, no open jobs). */
async function rehearsalHouses(rid) {
  const houses = await makeHouses(rid, 3, 'reh');
  const photos = [];
  for (const h of houses) {
    const id = uuid();
    await q(`insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, moderated_at)
      values (${lit(id)}, ${lit(h)}, ${lit(`${h}/${id}.jpg`)}, ${lit(`${h}/${uuid()}.jpg`)}, 'approved', now(), now())`);
    photos.push(id);
  }
  return { houses, photos };
}
const otherTotals = (rid) => q(`select coalesce(sum(t.votes), 0) || '/' || count(*) from public.house_vote_totals t where t.region_id <> ${lit(rid)}`);
const isNotFound = (c) => c === 'not_found' || c === 'not_found/photo';

test('AC37b: purge_rehearsal(true) racing 15 photo-heart votes, 20x -> no 40P01; rows gone after the purge', async () => {
  const rid = await rehearsalReady();
  await q(`delete from public.houses where region_id = ${lit(rid)}`);
  for (let it = 0; it < 20; it += 1) {
    const { houses, photos } = await rehearsalHouses(rid);
    const before = await otherTotals(rid);
    const thunks = Array.from({ length: 15 }, (_, i) => () => vote(uuid(), houses[i % 3], v6(9000 + it * 15 + i), photos[i % 3]));
    thunks.splice(1 + (it % 14), 0, () => psql('select private.purge_rehearsal(true);'));
    const res = await pool(thunks);
    const purgeIdx = 1 + (it % 14);
    const purge = res[purgeIdx];
    const votes = res.filter((_, k) => k !== purgeIdx).map(classify);
    assert.ok(!/deadlock|40P01/.test(purge.err), `iteration ${it}: purge deadlocked`);
    assert.ok(!votes.includes('deadlock'), `iteration ${it}: a vote deadlocked`);
    assert.deepEqual(votes.filter((c) => c !== 'ok' && !isNotFound(c)), [], `iteration ${it}: votes ok or not_found only: ${JSON.stringify(votes)}`);
    if (purge.code !== 0) {
      // Only a concurrent change in ANOTHER region (the parallel submit_house suite) may refuse the purge.
      assert.match(purge.err, /other_region_changed/, `iteration ${it}: purge failed: ${purge.err.slice(0, 300)}`);
      await q('select private.purge_rehearsal(true)');
    }
    assert.equal(await qn(`select count(*) from public.houses where region_id = ${lit(rid)}`), 0, `iteration ${it}: houses gone`);
    assert.equal(await qn(`select count(*) from public.photos where id = any(array[${photos.map(lit).join(',')}]::uuid[])`), 0, `iteration ${it}: photos gone`);
    assert.equal(await qn(`select count(*) from public.house_vote_totals where region_id = ${lit(rid)}`), 0, `iteration ${it}: totals gone`);
    assert.equal(await qn(`select count(*) from private.vote_events where region_id = ${lit(rid)}`), 0, `iteration ${it}: events gone`);
    assert.equal(await otherTotals(rid), before, `iteration ${it}: other regions' counts unchanged`);
  }
});

test('AC37b: admin_set_season(rehearsal) racing 15 photo-heart votes -> no 40P01', async () => {
  const rid = await rehearsalReady();
  const { houses, photos } = await rehearsalHouses(rid);
  const thunks = Array.from({ length: 15 }, (_, i) => () => vote(uuid(), houses[i % 3], v6(12000 + i), photos[i % 3]));
  thunks.splice(4, 0, () => psql(tx(claims(GLOBAL_ADMIN, { is_anonymous: false, aal: 'aal2', amr: AMR_ADMIN }), {},
    `select public.admin_set_season(${lit(rid)}, 'christmas', 2026, false);`)));
  const res = await pool(thunks);
  const season = res[4];
  assert.equal(season.code, 0, `admin_set_season failed: ${season.err.slice(0, 300)}`);
  const votes = res.filter((_, k) => k !== 4).map(classify);
  assert.ok(!votes.includes('deadlock'), 'no vote deadlocked');
  assert.deepEqual(votes.filter((c) => c !== 'ok' && !isNotFound(c)), [], `votes ok or not_found only: ${JSON.stringify(votes)}`);
  // tidy: the rotation jobs point at objects that never existed
  await q(`update private.storage_jobs set done_at = now(), last_error = 'votes test cleanup'
            where done_at is null and photo_id = any(array[${photos.map(lit).join(',')}]::uuid[])`);
  await q(`update public.site_settings set active_season = 'halloween', active_year = 2026 where region_id = ${lit(rid)}`);
  await q('select private.purge_rehearsal(true)');
  await q(`update public.regions set is_active = false where id = ${lit(rid)}`);
});

// ---- AC37c: eligibility vs moderation (vote_house takes FOR SHARE on the house and photo rows) ----
// Deterministic, no timing races: one session holds its transaction open in pg_sleep, a second session is
// started only after the first is provably holding, and we poll pg_stat_activity for the second to be
// waiting on a lock. Then both finish and we check the committed outcome.
const ADMIN2 = () => claims(GLOBAL_ADMIN, { is_anonymous: false, aal: 'aal2', amr: AMR_ADMIN });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(sqlText, what, tries = 100) {
  for (let i = 0; i < tries; i += 1) { if ((await qn(sqlText)) > 0) return; await sleep(50); }
  assert.fail(`timed out waiting for ${what}`);
}
const HOLD_S = 3;
/** Session that runs `body` and then keeps its transaction open for HOLD_S seconds. */
const holder = (claimsJson, headers, body, mark) => psql(tx(claimsJson, headers, `${body}\nselect pg_sleep(${HOLD_S}) /* ${mark} */;`));
const sleeping = (mark) => `select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like ${lit(`%${mark}%`)}`;
const lockWaiting = (needle) => `select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like ${lit(`%${needle}%`)}`;
async function approvedPhoto(house) {
  const id = uuid();
  await q(`insert into public.photos (id, house_id, upload_path, public_path, status, reserved_until, moderated_at)
    values (${lit(id)}, ${lit(house)}, ${lit(`${house}/${id}.jpg`)}, ${lit(`${house}/${uuid()}.jpg`)}, 'approved', now(), now())`);
  return id;
}
const settleJobs = (photo) => q(`update private.storage_jobs set done_at = now(), last_error = 'votes test cleanup' where done_at is null and photo_id = ${lit(photo)}`);

test('AC37c(a1): a vote holding the photo share makes admin_revoke_photo wait; the heart commits', async () => {
  const [house] = await makeHouses(region, 1, 'm1');
  const photo = await approvedPhoto(house);
  const uid = uuid();
  const mark = `hold${tag()}`;
  const v = holder(claims(uid), { 'cf-connecting-ip': v4(7) },
    `select 'OK|' || total_votes from public.vote_house(${lit(house)}, ${lit(photo)});`, mark);
  await until(sleeping(mark), 'the vote to hold its locks');
  const r = psql(tx(ADMIN2(), {}, `select public.admin_revoke_photo(${lit(photo)});`));
  await until(lockWaiting(`admin_revoke_photo('${photo}')`), 'the revoke to wait on the vote');
  assert.equal(await qn(`select count(*) from public.photos where id = ${lit(photo)} and status = 'approved'`), 1, 'photo still approved while the vote is open');
  const [vr, rr] = await Promise.all([v, r]);
  assert.equal(classify(vr), 'ok', vr.err);
  assert.equal(rr.code, 0, rr.err.slice(0, 300));
  assert.equal(await qn(`select count(*) from private.vote_events where house_id = ${lit(house)} and photo_id = ${lit(photo)}`), 1);
  assert.equal(await qn(`select count(*) from public.photos where id = ${lit(photo)} and status = 'revoked'`), 1);
  await settleJobs(photo);
});

test('AC37c(a2): a revoke that commits first gives the heart not_found/photo and writes nothing', async () => {
  const [house] = await makeHouses(region, 1, 'm2');
  const photo = await approvedPhoto(house);
  const uid = uuid();
  const mark = `hold${tag()}`;
  const r = holder(ADMIN2(), {}, `select public.admin_revoke_photo(${lit(photo)});`, mark);
  await until(sleeping(mark), 'the revoke to hold its locks');
  const v = vote(uid, house, v4(8), photo);
  await until(lockWaiting(`vote_house('${house}', '${photo}')`), 'the vote to wait on the revoke');
  const [rr, vr] = await Promise.all([r, v]);
  assert.equal(rr.code, 0, rr.err.slice(0, 300));
  assert.equal(classify(vr), 'not_found/photo', vr.err);
  assert.equal(await qn(`select count(*) from private.vote_events where house_id = ${lit(house)}`), 0);
  assert.equal(await total(house), 0);
  await settleJobs(photo);
});

test('AC37c(b1): a vote holding the house share makes admin_set_house_status(hidden) wait; the vote commits', async () => {
  const [house] = await makeHouses(region, 1, 'm3');
  const mark = `hold${tag()}`;
  const v = holder(claims(uuid()), { 'cf-connecting-ip': v4(9) },
    `select 'OK|' || total_votes from public.vote_house(${lit(house)}, null);`, mark);
  await until(sleeping(mark), 'the vote to hold its locks');
  const h = psql(tx(ADMIN2(), {}, `select public.admin_set_house_status(${lit(house)}, 'hidden', null);`));
  await until(lockWaiting(`admin_set_house_status('${house}'`), 'the hide to wait on the vote');
  assert.equal(await qn(`select count(*) from public.houses where id = ${lit(house)} and status = 'visible'`), 1, 'still visible while the vote is open');
  const [vr, hr] = await Promise.all([v, h]);
  assert.equal(classify(vr), 'ok', vr.err);
  assert.equal(hr.code, 0, hr.err.slice(0, 300));
  assert.equal(await total(house), 1);
  assert.equal(await qn(`select count(*) from public.houses where id = ${lit(house)} and status = 'hidden'`), 1);
});

test('AC37c(b2): a hide that commits first gives the vote not_found and writes nothing', async () => {
  const [house] = await makeHouses(region, 1, 'm4');
  const mark = `hold${tag()}`;
  const h = holder(ADMIN2(), {}, `select public.admin_set_house_status(${lit(house)}, 'hidden', null);`, mark);
  await until(sleeping(mark), 'the hide to hold its locks');
  const v = vote(uuid(), house, v4(10));
  await until(lockWaiting(`vote_house('${house}'`), 'the vote to wait on the hide');
  const [hr, vr] = await Promise.all([h, v]);
  assert.equal(hr.code, 0, hr.err.slice(0, 300));
  assert.equal(classify(vr), 'not_found', vr.err);
  assert.equal(await qn(`select count(*) from private.vote_events where house_id = ${lit(house)}`), 0);
  assert.equal(await total(house), 0);
});
