// submit_event serialization against site_settings writers (Spec_Events Amendment 2) and the quota rollback.
// LOCAL stack only. Real parallel Postgres sessions through `docker exec <db container> psql`, like vote_house.
// To make submits WAIT, a postgres session holds the region's event advisory lock (the first lock submit_event
// takes), the admin change commits while they queue, then the lock is released:
//   - events_open switched off while submits wait  -> every waiter is told submissions_closed
//   - season switched while submits wait           -> every waiter is stamped with the NEW pair (never the old)
//   - no deadlock between submit_event and the site_settings writers (admin_set_season locks FOR UPDATE)
//   - a caught 23505 ("exists", an admin create won the race) leaves no quota row behind
// Fixtures: its own auth.users; every event, quota row and settings change is undone afterwards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lit } from '../storage/_local.mjs'; // also refuses non-local URLs

const PROJECT = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const CONTAINER = process.env.TL_DB_CONTAINER ?? `supabase_db_${PROJECT}`;
if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) throw new Error(`unexpected local db container name: ${CONTAINER}`);
const PSQL = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'];

function psql(script) {
  return new Promise((resolve) => {
    const p = spawn('docker', PSQL, { stdio: ['pipe', 'pipe', 'pipe'] });
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
/** A psql session that stays open: holds `head` (e.g. an advisory lock) until finish(tail) runs the tail and commits. */
function holdSession(head) {
  const p = spawn('docker', PSQL, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  let ready;
  const readyP = new Promise((r) => { ready = r; });
  p.stdout.on('data', (d) => { out += d; if (out.includes('HELD')) ready(); });
  p.stderr.on('data', (d) => { err += d; });
  const closed = new Promise((resolve) => p.on('close', (code) => resolve({ code, out, err })));
  p.stdin.write(`${head}\nselect 'HELD';\n`);
  return {
    held: readyP,
    async finish(tail) {
      p.stdin.end(`${tail}\ncommit;\n`);
      const r = await closed;
      assert.equal(r.code, 0, `hold session failed: ${r.err.slice(0, 400)}`);
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waiters = () => q(`select count(*) from pg_stat_activity where datname = 'postgres' and wait_event_type = 'Lock' and wait_event = 'advisory';`).then(Number);
async function waitForWaiters(n) {
  for (let i = 0; i < 100; i += 1) {
    if ((await waiters()) >= n) return;
    await sleep(100);
  }
  throw new Error(`expected ${n} sessions waiting on the region advisory lock`);
}

// amr shape as GoTrue emits it for an anonymous session (captured by tests/storage/50_admin_amr.test.mjs).
const AMR_ANON = JSON.parse('[{"method":"anonymous","timestamp":1791564302}]');
const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated', is_anonymous: true, aal: 'aal1', amr: AMR_ANON });
const runId = () => crypto.randomBytes(3).toString('hex');
let region; let startsAt;
const users = [];
const newUsers = async (n) => {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  await q(`insert into auth.users (id, aud, role, email) values ${ids.map((id) => `(${lit(id)}, 'authenticated', 'authenticated', ${lit(id + '@example.test')})`).join(',')};`);
  users.push(...ids);
  return ids;
};
const submit = (uid, title) => psql(`begin;
set local role authenticated;
select set_config('request.jwt.claims', ${lit(claims(uid))}, true) is not null;
select 'RES|' || s.result || '|' || coalesce(s.event_id::text, '') from public.submit_event('evlocktest', ${lit(title)},
  'A made-up concurrency test event.', null, 'Fakepine Park, Truckee, CA', null, ${region.lat}, ${region.lng},
  ${lit(startsAt)}, null, null, false) s;
commit;`);
const outcome = (r) => {
  if (/deadlock detected|40P01/.test(r.err)) return 'deadlock';
  if (r.code === 0) return r.out.match(/RES\|(\w+)\|(\S*)/).slice(1, 3).join('|');
  return r.err.match(/ERROR:\s+(\S+)/)?.[1] ?? `unknown:${r.err.slice(0, 200)}`;
};
const lockKey = () => `hashtextextended('event:region:' || ${lit(region.id)}, 0)`;
const setSettings = (sets) => q(`update public.site_settings set ${sets} where region_id = ${lit(region.id)};`);

before(async () => {
  // Own throwaway region: these tests flip events_open and the season, which would break submit_event.test.mjs
  // (node --test runs files in parallel) if they touched Truckee.
  await q(`insert into public.regions (slug, name, min_lat, max_lat, min_lng, max_lng, center_lat, center_lng, default_zoom, timezone, is_active)
    values ('evlocktest', 'Evlocktest', 39.2, 39.4, -120.3, -120.0, 39.33, -120.18, 12, 'America/Los_Angeles', true)
    on conflict (slug) do update set is_active = true;
    insert into public.site_settings (region_id, active_season, active_year, submissions_open, events_open)
    select id, 'halloween', 2026, true, true from public.regions where slug = 'evlocktest'
    on conflict (region_id) do nothing;`);
  const [id, lat, lng] = (await q(`select id, center_lat, center_lng from public.regions where slug = 'evlocktest';`)).split('|');
  region = { id, lat: Number(lat), lng: Number(lng) };
  startsAt = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3 * 86_400_000).toISOString();
  await setSettings('events_open = true');
});

after(async () => {
  if (users.length > 0) {
    const list = users.map(lit).join(',');
    await q(`delete from public.events where created_by in (${list});
             delete from private.quota_events where uid in (${list});
             delete from auth.users where id in (${list});`);
  }
  await q(`delete from public.events where region_id = ${lit(region.id)};
           delete from private.quota_events where region_id = ${lit(region.id)};
           delete from public.site_settings where region_id = ${lit(region.id)};
           delete from public.regions where id = ${lit(region.id)};`);
});

test('locks 1: closing submissions while submits wait -> every waiter gets submissions_closed', async () => {
  await setSettings('events_open = true');
  const uids = await newUsers(5);
  const id = runId();
  const hold = holdSession(`begin; select pg_advisory_xact_lock(${lockKey()});`);
  await hold.held;
  const pending = uids.map((u, i) => submit(u, `Fake Close ${id} ${i}`));
  await waitForWaiters(uids.length);
  await hold.finish('update public.site_settings set events_open = false, updated_at = now() where region_id = ' + lit(region.id) + ';');
  const res = (await Promise.all(pending)).map(outcome);
  assert.deepEqual(res, uids.map(() => 'submissions_closed'), `waiters must see the closed switch: ${res.join(',')}`);
  assert.equal(Number(await q(`select count(*) from public.events where created_by in (${uids.map(lit).join(',')});`)), 0, 'no late event was inserted');
  assert.equal(Number(await q(`select count(*) from private.quota_events where uid in (${uids.map(lit).join(',')});`)), 0, 'no late quota row');
  await setSettings('events_open = true');
});

test('locks 2: switching the season while submits wait -> late submits are stamped with the NEW pair', async () => {
  await setSettings(`events_open = true, active_season = 'halloween', active_year = 2026`);
  const uids = await newUsers(5);
  const id = runId();
  const hold = holdSession(`begin; select pg_advisory_xact_lock(${lockKey()});`);
  await hold.held;
  const pending = uids.map((u, i) => submit(u, `Fake Switch ${id} ${i}`));
  await waitForWaiters(uids.length);
  await hold.finish(`update public.site_settings set active_season = 'christmas', active_year = 2027, updated_at = now() where region_id = ${lit(region.id)};`);
  const res = (await Promise.all(pending)).map(outcome);
  for (const r of res) assert.ok(r.startsWith('created|') || r === 'submissions_closed', `unexpected outcome ${r}`);
  const rows = (await q(`select season || ' ' || year from public.events where created_by in (${uids.map(lit).join(',')});`)).split('\n').filter(Boolean);
  assert.equal(rows.length, res.filter((r) => r.startsWith('created|')).length);
  assert.ok(rows.length > 0, 'at least one waiter should have been created under the new pair');
  assert.ok(rows.every((r) => r === 'christmas 2027'), `no row may carry the old pair: ${rows.join(', ')}`);
});

test('locks 3: submits racing site_settings writers (FOR UPDATE, like admin_set_season) never deadlock', async () => {
  await setSettings(`events_open = true, active_season = 'halloween', active_year = 2026`);
  const uids = await newUsers(12);
  const id = runId();
  const admin = async (i) => psql(`begin;
select 1 from public.site_settings where region_id = ${lit(region.id)} for update;
select pg_sleep(0.05);
update public.site_settings set active_season = ${lit(i % 2 ? 'halloween' : 'christmas')}, active_year = 2026, events_open = true, updated_at = now() where region_id = ${lit(region.id)};
commit;`);
  const jobs = [];
  for (let i = 0; i < uids.length; i += 1) {
    jobs.push(submit(uids[i], `Fake Race ${id} ${i}`));
    if (i % 3 === 0) jobs.push(admin(i));
  }
  const rs = await Promise.all(jobs);
  const bad = rs.filter((r) => /deadlock detected|40P01/.test(r.err));
  assert.equal(bad.length, 0, 'no deadlock');
  const unexpected = rs.filter((r) => r.code !== 0).map((r) => r.err.slice(0, 160));
  assert.deepEqual(unexpected, [], 'every statement succeeded');
});

test('locks 4: a caught 23505 (admin create wins the race) returns exists and keeps no quota row', async () => {
  await setSettings(`events_open = true, active_season = 'halloween', active_year = 2026`);
  const [uid] = await newUsers(1);
  const title = `Fake Quota ${runId()}`;
  // An admin-style insert, uncommitted: submit_event's dedupe read cannot see it, then its insert blocks on the
  // unique index and, once this commits, raises 23505 inside the subtransaction.
  const hold = holdSession(`begin; insert into public.events (region_id, season, year, title, description, address, lat, lng, starts_at, status, source)
    values (${lit(region.id)}, 'halloween', 2026, ${lit(title)}, 'Seeded by the race.', 'Fakepine Park, Truckee, CA', ${region.lat}, ${region.lng}, ${lit(startsAt)}, 'approved', 'seed');`);
  await hold.held;
  const pending = submit(uid, title);
  for (let i = 0; i < 100; i += 1) {
    const n = Number(await q(`select count(*) from pg_stat_activity where datname = 'postgres' and wait_event_type = 'Lock' and wait_event = 'transactionid';`));
    if (n >= 1) break;
    await sleep(100);
  }
  await hold.finish('');
  const res = outcome(await pending);
  assert.match(res, /^exists\|[0-9a-f-]{36}$/, `visitor sees exists with the approved id: ${res}`);
  assert.equal(Number(await q(`select count(*) from private.quota_events where uid = ${lit(uid)};`)), 0, 'the exists answer consumed no quota');
  assert.equal(Number(await q(`select count(*) from public.events where title = ${lit(title)};`)), 1, 'only the admin row exists');
  await q(`delete from public.events where title = ${lit(title)};`);
});
