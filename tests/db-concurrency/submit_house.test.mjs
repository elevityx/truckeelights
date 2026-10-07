// Concurrency + CAPTCHA tests against the LOCAL Supabase stack (spec §3 A5; AC6, AC7, AC24).
// Needs `supabase start` with the seed (Truckee open for submissions). Only adds data.
// Safe to re-run several times per 10 minutes; after that the region breaker trips by design.
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

async function truckeeCenter(c) {
  const { data, error } = await c.rpc('get_region_context', { p_slug: 'truckee' });
  assert.equal(error, null, error?.message);
  assert.ok(data, 'truckee region context missing (did the seed run?)');
  assert.equal(data.submissions_open, true, 'Truckee submissions must be open (local seed)');
  return { lat: data.region.center_lat, lng: data.region.center_lng };
}

const submit = (c, address, placeId, at) =>
  c.rpc('submit_house', { p_region_slug: 'truckee', p_place_id: placeId, p_address: address, p_lat: at.lat, p_lng: at.lng });

function tally(responses) {
  const t = { created: 0, exists_visible: 0, blocked: 0, rate_limited: 0, other: [] };
  for (const { data, error } of responses) {
    if (error) {
      if (error.message === 'rate_limited') t.rate_limited += 1;
      else t.other.push(error.message);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.result in t) t[row.result] += 1;
      else t.other.push(JSON.stringify(data));
    }
  }
  return t;
}

test('1: anonymous sign-in without a CAPTCHA token is rejected', async () => {
  const c = newClient();
  const { data, error } = await c.auth.signInAnonymously();
  assert.ok(error, 'expected an error without captchaToken');
  assert.match(error.message, /captcha/i);
  assert.equal(data.session, null);
});

test('2: 20 parallel distinct submits from one session -> exactly 5 created, 15 rate_limited', async () => {
  const c = await signedInClient();
  const at = await truckeeCenter(c);
  const id = runId();
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      submit(c, `${i + 1} Run${id} Rd, Truckee, CA`, `ChIJtest${id}${String(i).padStart(4, '0')}`, at)),
  );
  const t = tally(responses);
  assert.deepEqual(t.other, [], 'unexpected errors/results');
  assert.equal(t.created, 5, `created=${t.created}`);
  assert.equal(t.rate_limited, 15, `rate_limited=${t.rate_limited}`);
});

test('3: 20 parallel identical submits -> 1 created, 19 exists_visible, 0 rate_limited; one quota unit used', async () => {
  const c = await signedInClient();
  const at = await truckeeCenter(c);
  const id = runId();
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => submit(c, `1 Dup${id} Rd, Truckee, CA`, `ChIJdup${id}00001`, at)),
  );
  const t = tally(responses);
  assert.deepEqual(t.other, [], 'unexpected errors/results');
  assert.equal(t.created, 1, `created=${t.created}`);
  assert.equal(t.exists_visible, 19, `exists_visible=${t.exists_visible}`);
  assert.equal(t.rate_limited, 0, `rate_limited=${t.rate_limited}`);
  const ids = new Set(responses.map(({ data }) => data[0].house_id));
  assert.equal(ids.size, 1, 'every response points at the same house id');

  for (let i = 2; i <= 5; i += 1) {
    const r = tally([await submit(c, `${i} Dup${id} Rd, Truckee, CA`, `ChIJdup${id}0000${i}`, at)]);
    assert.equal(r.created, 1, `distinct submit #${i} should be created: ${JSON.stringify(r)}`);
  }
  const sixth = tally([await submit(c, `6 Dup${id} Rd, Truckee, CA`, `ChIJdup${id}00006`, at)]);
  assert.equal(sixth.rate_limited, 1, `6th distinct submit should be rate_limited: ${JSON.stringify(sixth)}`);
});
