// Subscribe + Accounts concurrency (Spec_Subscribe_Accounts §9): two claims on one house, redeeming one house link
// in parallel, and owner hide racing admin hide/release. LOCAL stack only. Real parallel Postgres sessions through
// `docker exec <db container> psql`, one transaction each (same harness as vote_house). Accounts are inserted into
// auth.users directly (fake, local-only), so no email is ever sent. Everything created is deleted afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lit } from '../storage/_local.mjs'; // refuses non-local URLs

const PROJECT = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const CONTAINER = process.env.TL_DB_CONTAINER ?? `supabase_db_${PROJECT}`;
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) throw new Error(`unexpected local db container name: ${CONTAINER}`);
const GLOBAL_ADMIN = '00000000-0000-4000-a000-00000000ad01'; // seeded local admin (global)
const ADMIN_AMR = [{ method: 'password', timestamp: 1 }, { method: 'totp', timestamp: 2 }];

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
async function q(sqlText) {
  const r = await psql(sqlText);
  if (r.code !== 0) throw new Error(`psql failed: ${r.err.slice(0, 500)} :: ${sqlText.slice(0, 200)}`);
  return r.out.trim();
}
const qn = async (sqlText) => Number(await q(sqlText));
function classify(r) {
  if (/deadlock detected|40P01/.test(r.err)) return 'deadlock';
  if (r.code === 0) return 'ok';
  const m = r.err.match(/ERROR:\s+(\S+)/);
  return m ? m[1] : `unknown:${r.code}:${r.err.slice(0, 200)}`;
}
const tally = (results) => results.map(classify).reduce((t, c) => ({ ...t, [c]: (t[c] ?? 0) + 1 }), {});
const claims = (uid, extra = {}) =>
  JSON.stringify({ sub: uid, role: 'authenticated', is_anonymous: false, aal: 'aal1', amr: [{ method: 'otp', timestamp: 1 }], ...extra });
const adminClaims = () => claims(GLOBAL_ADMIN, { aal: 'aal2', amr: ADMIN_AMR });
const tx = (claimsJson, body) => `begin;
set local role authenticated;
select set_config('request.jwt.claims', ${lit(claimsJson)}, true) is not null;
${body}
commit;`;
const tag = () => crypto.randomBytes(4).toString('hex');

const created = { regions: [], users: [] };
let region;
async function makeUser(confirmed = true, anonymous = false) {
  const id = crypto.randomUUID();
  const email = anonymous ? null : `sub-${tag()}@example.test`;
  await q(`insert into auth.users (id, aud, role, email, email_confirmed_at, is_anonymous)
    values (${lit(id)}, 'authenticated', 'authenticated', ${email ? lit(email) : 'null'}, ${confirmed && !anonymous ? 'now()' : 'null'}, ${anonymous})`);
  created.users.push(id);
  return { id, email };
}
async function makeHouses(n, createdBy = null) {
  const t = tag();
  const out = await q(`insert into public.houses (region_id, season, year, address, normalized_address, lat, lng, coord_source, status, created_by)
    select s.region_id, s.active_season, s.active_year, g || ' Sub${t} Rd', g || ' sub${t} rd', r.center_lat, r.center_lng, 'admin', 'visible',
           ${createdBy ? lit(createdBy) : 'null'}
      from public.site_settings s join public.regions r on r.id = s.region_id
     cross join generate_series(1, ${n}) g where s.region_id = ${lit(region)}
    returning id`);
  return out.split('\n').filter(Boolean);
}

before(async () => {
  assert.match(await q('select 1'), /^1$/, `local db container ${CONTAINER} must be reachable`);
  const slug = `sub-${tag()}`;
  region = await q(`insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
    values (${lit(slug)}, 'Sub Test', 22, 23, 22, 23, 22.5, 22.5, 12, 'America/Los_Angeles', true) returning id`);
  await q(`insert into public.site_settings (region_id, active_season, active_year, submissions_open) values (${lit(region)}, 'halloween', 2026, false)`);
  created.regions.push(region);
});
after(async () => {
  for (const id of created.regions) {
    await q(`update private.storage_jobs set done_at = now(), last_error = 'subscribe test cleanup' where done_at is null and region_id = ${lit(id)}`);
    await q(`delete from public.houses where region_id = ${lit(id)}`);
    await q(`delete from public.site_settings where region_id = ${lit(id)}`);
    await q(`delete from public.regions where id = ${lit(id)}`);
  }
  if (created.users.length) {
    const ids = created.users.map(lit).join(',');
    await q(`delete from private.quota_events where uid in (${ids})`);
    await q(`delete from auth.users where id in (${ids})`);
  }
});

test('two claims on one house: 20 users in parallel -> exactly 1 pending claim, 19 claim_pending, no deadlock', async () => {
  const [house] = await makeHouses(1);
  const users = await Promise.all(Array.from({ length: 20 }, () => makeUser()));
  const t = tally(await Promise.all(users.map((u) =>
    psql(tx(claims(u.id), `select public.request_house_claim(${lit(house)}, 'parallel claim');`)))));
  assert.deepEqual(t, { ok: 1, claim_pending: 19 });
  assert.equal(await qn(`select count(*) from public.house_claims where house_id = ${lit(house)} and status = 'pending'`), 1);
  // Only the winner used a claim quota unit (the losers' quota rolled back with their insert).
  assert.equal(await qn(`select count(*) from private.quota_events where kind = 'claim' and uid in (${users.map((u) => lit(u.id)).join(',')})`), 1);
});

test('one user claims 10 houses in parallel -> exactly 1 pending claim, 9 claim_pending', async () => {
  const houses = await makeHouses(10);
  const u = await makeUser();
  const t = tally(await Promise.all(houses.map((h) =>
    psql(tx(claims(u.id), `select public.request_house_claim(${lit(h)}, null);`)))));
  assert.deepEqual(t, { ok: 1, claim_pending: 9 });
  assert.equal(await qn(`select count(*) from public.house_claims where user_id = ${lit(u.id)} and status = 'pending'`), 1);
});

test('house-link redeem race: 10 parallel complete_house_link -> the 5 houses link exactly once', async () => {
  const device = await makeUser(false, true);
  const houses = await makeHouses(5, device.id);
  const u = await makeUser();
  const begin = await psql(tx(claims(device.id, { is_anonymous: true, amr: [{ method: 'anonymous', timestamp: 1 }] }),
    `select public.begin_house_link(${lit(u.email.toUpperCase())});`));
  assert.equal(classify(begin), 'ok', begin.err);
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    psql(tx(claims(u.id), `select 'N|' || public.complete_house_link();`))));
  assert.deepEqual(tally(results), { ok: 10 });
  const counts = results.map((r) => Number(r.out.match(/N\|(\d+)/)?.[1]));
  assert.equal(counts.reduce((a, b) => a + b, 0), 5, `linked counts ${counts}`);
  assert.equal(counts.filter((n) => n > 0).length, 1, 'one redeemer wins');
  assert.equal(await qn(`select count(*) from public.houses where id in (${houses.map(lit).join(',')}) and owner_id = ${lit(u.id)}`), 5);
  assert.equal(await qn(`select count(*) from private.house_links where anon_uid = ${lit(device.id)} and used_at is null`), 0);
});

test('owner hide/unhide racing admin hide, unhide and release: no deadlock, consistent end state', async () => {
  for (let it = 0; it < 6; it += 1) {
    const owner = await makeUser();
    const [house] = await makeHouses(1, owner.id);
    await q(`update public.houses set owner_id = ${lit(owner.id)}, owner_since = now() where id = ${lit(house)}`);
    const jobs = [
      () => psql(tx(claims(owner.id), `select public.owner_set_house_visibility(${lit(house)}, false);`)),
      () => psql(tx(adminClaims(), `select public.admin_set_house_status(${lit(house)}, 'hidden', 'race');`)),
      () => psql(tx(claims(owner.id), `select public.owner_set_house_visibility(${lit(house)}, true);`)),
      () => psql(tx(adminClaims(), `select public.admin_release_house(${lit(house)});`)),
      () => psql(tx(claims(owner.id), `select public.request_house_removal(${lit(house)}, null);`)),
      () => psql(tx(adminClaims(), `select public.admin_clear_owner(${lit(house)});`)),
    ];
    const t = tally(await Promise.all(jobs.map((j) => j())));
    assert.equal(t.deadlock ?? 0, 0, `iteration ${it}: ${JSON.stringify(t)}`);
    for (const k of Object.keys(t)) assert.ok(['ok', 'forbidden', 'must_be_hidden', 'not_found', 'house_released', 'claim_pending', 'rate_limited'].includes(k), `unexpected ${k}`);
    const row = await q(`select status || '|' || coalesce(hidden_reason, '-') || '|' || (owner_id is null) from public.houses where id = ${lit(house)}`);
    const [status, reason, unowned] = row.split('|');
    if (status === 'released') assert.equal(unowned, 'true', 'a released house has no owner');
    if (status === 'visible') assert.equal(reason, '-', 'a visible house has no hidden reason');
  }
});
