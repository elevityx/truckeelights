// Events v1 concurrency tests against the LOCAL Supabase stack (Spec_Events A2, A5).
// Needs `npm run db:reset` (the seed opens Truckee event submissions). Only adds pending events.
// Each run adds 6 pending events and 6 ledger rows: re-run at most ~4 times per reset (pending cap 40,
// region breaker 30 per 10 min) before the caps trip by design.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const CAPTCHA_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'; // accepted by Cloudflare's always-pass TEST secret

function localStack() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
  }
  const out = execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  const url = status.API_URL;
  const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  if (!url || !key) throw new Error('could not read API_URL / PUBLISHABLE_KEY from `supabase status`');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`refusing to run against a non-local URL: ${url}`);
  return { url, key };
}

const { url, key } = localStack();
const newClient = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const runId = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

async function signedInClient() {
  const c = newClient();
  const { data, error } = await c.auth.signInAnonymously({ options: { captchaToken: CAPTCHA_TEST_TOKEN } });
  assert.equal(error, null, `anonymous sign-in with the test captcha token failed: ${error?.message}`);
  assert.ok(data.session, 'expected a session');
  return c;
}

async function truckee(c) {
  const { data, error } = await c.rpc('get_region_context', { p_slug: 'truckee' });
  assert.equal(error, null, error?.message);
  assert.equal(data?.events?.open, true, 'Truckee event submissions must be open (local seed)');
  return { lat: data.region.center_lat, lng: data.region.center_lng };
}

const startsAt = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 3 * 86_400_000).toISOString();

const submit = (c, title, at) =>
  c.rpc('submit_event', {
    p_region_slug: 'truckee', p_title: title, p_description: 'A made-up concurrency test event.', p_venue: null,
    p_address: 'Fakepine Park, Truckee, CA', p_place_id: null, p_lat: at.lat, p_lng: at.lng,
    p_starts_at: startsAt, p_ends_at: null, p_url: null, p_adults_only: false,
  });

function tally(responses) {
  const t = { created: 0, exists: 0, rate_limited: 0, ids: [], other: [] };
  for (const { data, error } of responses) {
    if (error) {
      if (error.message === 'rate_limited') t.rate_limited += 1;
      else t.other.push(`${error.message}:${error.details}`);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.result in t) {
        t[row.result] += 1;
        t.ids.push(row.event_id);
      } else t.other.push(JSON.stringify(data));
    }
  }
  return t;
}

test('events 1: 10 parallel distinct submits from one session -> exactly 3 created, 7 rate_limited', async () => {
  const c = await signedInClient();
  const at = await truckee(c);
  const id = runId();
  const t = tally(await Promise.all(Array.from({ length: 10 }, (_, i) => submit(c, `Fake Run ${id} Event ${i + 1}`, at))));
  assert.deepEqual(t.other, [], 'unexpected errors/results');
  assert.equal(t.created, 3, `created=${t.created}`);
  assert.equal(t.rate_limited, 7, `rate_limited=${t.rate_limited}`);
});

test('events 2: 10 parallel identical submits -> 1 created, 9 exists (no id while pending); one quota unit used', async () => {
  const c = await signedInClient();
  const at = await truckee(c);
  const id = runId();
  const t = tally(await Promise.all(Array.from({ length: 10 }, () => submit(c, `Fake Dup ${id}`, at))));
  assert.deepEqual(t.other, [], 'unexpected errors/results');
  assert.equal(t.created, 1, `created=${t.created}`);
  assert.equal(t.exists, 9, `exists=${t.exists}`);
  assert.equal(t.rate_limited, 0, `rate_limited=${t.rate_limited}`);
  assert.equal(t.ids.filter((x) => x !== null).length, 1, 'only the created response carries an id');

  for (let i = 2; i <= 3; i += 1) {
    const r = tally([await submit(c, `Fake Dup ${id} Distinct ${i}`, at)]);
    assert.equal(r.created, 1, `distinct submit #${i} should be created: ${JSON.stringify(r)}`);
  }
  const fourth = tally([await submit(c, `Fake Dup ${id} Distinct 4`, at)]);
  assert.equal(fourth.rate_limited, 1, `4th distinct submit should be rate_limited: ${JSON.stringify(fourth)}`);
});
