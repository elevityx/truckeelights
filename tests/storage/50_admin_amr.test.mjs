// Subscribe v1, Amendment 2 C1: an admin session needs BOTH password and TOTP in the JWT `amr`.
// LOCAL stack only. This captures REAL `amr` claims from the local auth server, proves the database
// accepts password + TOTP and refuses email code + TOTP and password only (aal1), and then checks
// that every amr fixture in the pgTAP and concurrency suites has exactly the captured shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  adminAal2, anonClient, newClient, secretClient, sql, lit, totp, CAPTCHA_TEST_TOKEN,
} from './_local.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const claimsOf = async (c) => {
  const { data } = await c.auth.getSession();
  assert.ok(data.session, 'no session');
  return JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString());
};
// GoTrue sorts amr newest first, but two factors in the same second come back in either order, so
// method lists are compared as sets (sorted).
const methods = (amr) => amr.map((e) => e.method).sort();
const whoami = async (c) => {
  const r = await c.rpc('admin_whoami', { p_region_id: null });
  assert.equal(r.error, null, `admin_whoami: ${r.error?.message}`);
  return r.data;
};
const adminRead = async (c) => {
  const region = (await sql(`select id from public.regions where slug = 'truckee'`))[0].id;
  return c.rpc('admin_list_houses', { p_region_id: region, p_status: null, p_query: null });
};
// GoTrue entry shape: { method: string, timestamp: integer seconds }.
const shapeOf = (amr) => amr.map((e) => Object.keys(e).sort().map((k) => `${k}:${typeof e[k]}`).join(',')).join('|');
async function verifyTotp(c, factorId, secret) {
  // A code already used in this 30 s window may be refused; then use the next window's code.
  let v = await c.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (v.error) {
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
    v = await c.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  }
  assert.equal(v.error, null, `mfa verify failed: ${v.error?.message}`);
}

const captured = {};
// A second global admin whose TOTP secret this file holds, for the email code + TOTP path.
const EMAIL = 'amr-admin@example.test';
const PW = 'local-amr-admin-pw'; // fake, local stack only

test('password + TOTP (real local admin session): amr shape captured, admin access granted', async () => {
  const c = await adminAal2('global');
  const p = await claimsOf(c);
  assert.equal(p.aal, 'aal2');
  assert.equal(p.is_anonymous, false);
  assert.ok(Array.isArray(p.amr), 'amr is an array');
  for (const e of p.amr) {
    assert.deepEqual(Object.keys(e).sort(), ['method', 'timestamp'], 'amr entries are {method, timestamp}');
    assert.equal(typeof e.method, 'string');
    assert.ok(Number.isInteger(e.timestamp), 'timestamp is integer seconds');
  }
  assert.deepEqual(methods(p.amr), ['password', 'totp'], 'password and TOTP entries');
  captured.pw_totp = p.amr;
  console.log('captured password+TOTP amr:', JSON.stringify(p.amr));
  assert.equal(await whoami(c), true, 'admin_whoami -> true');
  const r = await adminRead(c);
  assert.equal(r.error, null, `admin_list_houses: ${r.error?.message}`);
});

test('password only (aal1, real session): not admin', async () => {
  const c = await adminAal2('global');
  const { data: u } = await c.auth.getUser();
  const pw = newClient();
  const si = await pw.auth.signInWithPassword({ email: u.user.email, password: 'local-storage-admin-pw', options: { captchaToken: CAPTCHA_TEST_TOKEN } });
  assert.equal(si.error, null, `sign-in: ${si.error?.message}`);
  const p = await claimsOf(pw);
  assert.equal(p.aal, 'aal1');
  assert.deepEqual(methods(p.amr), ['password']);
  captured.pw = p.amr;
  assert.equal(await whoami(pw), false, 'admin_whoami -> false');
  const r = await adminRead(pw);
  assert.equal(r.error?.message, 'forbidden', 'admin_list_houses -> forbidden');
});

test('email code + TOTP (real session, aal2): not admin', async () => {
  const admin = secretClient().auth.admin;
  let id = (await sql(`select id from auth.users where email = ${lit(EMAIL)}`))[0]?.id;
  if (!id) {
    const cu = await admin.createUser({ email: EMAIL, password: PW, email_confirm: true });
    assert.equal(cu.error, null, `createUser: ${cu.error?.message}`);
    id = cu.data.user.id;
  }
  await sql(`insert into public.admins (user_id, region_id, note) values (${lit(id)}, null, 'amr test admin') on conflict do nothing`);
  await sql(`delete from auth.mfa_factors where user_id = ${lit(id)}`);

  // Enroll TOTP from a password session (as the admin console does), keeping the secret.
  const c = newClient();
  const si = await c.auth.signInWithPassword({ email: EMAIL, password: PW, options: { captchaToken: CAPTCHA_TEST_TOKEN } });
  assert.equal(si.error, null, `sign-in: ${si.error?.message}`);
  const en = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `amr${Date.now()}` });
  assert.equal(en.error, null, `enroll: ${en.error?.message}`);
  await verifyTotp(c, en.data.id, en.data.totp.secret);
  assert.equal(await whoami(c), true, 'control: this user IS admin with password + TOTP');

  // Fresh session from an email code (the subscriber sign-in path), then step up with the same TOTP.
  const gl = await admin.generateLink({ type: 'magiclink', email: EMAIL });
  assert.equal(gl.error, null, `generateLink: ${gl.error?.message}`);
  const o = newClient();
  const v = await o.auth.verifyOtp({ email: EMAIL, token: gl.data.properties.email_otp, type: 'email' });
  assert.equal(v.error, null, `verifyOtp: ${v.error?.message}`);
  const p1 = await claimsOf(o);
  assert.equal(p1.aal, 'aal1');
  assert.deepEqual(methods(p1.amr), ['otp']);
  captured.otp = p1.amr;
  await verifyTotp(o, en.data.id, en.data.totp.secret);
  const p2 = await claimsOf(o);
  assert.equal(p2.aal, 'aal2', 'email code + TOTP reaches aal2');
  assert.deepEqual(methods(p2.amr), ['otp', 'totp']);
  captured.otp_totp = p2.amr;
  console.log('captured email-code+TOTP amr:', JSON.stringify(p2.amr));
  assert.equal(await whoami(o), false, 'admin_whoami -> false despite aal2');
  const r = await adminRead(o);
  assert.equal(r.error?.message, 'forbidden', 'admin_list_houses -> forbidden');
});

test('anonymous session: amr shape captured', async () => {
  const a = await anonClient();
  const p = await claimsOf(a);
  assert.deepEqual(methods(p.amr), ['anonymous']);
  captured.anon = p.amr;
});

test('every amr fixture in the DB suites uses the captured shape', () => {
  for (const k of ['pw_totp', 'pw', 'otp', 'otp_totp', 'anon']) assert.ok(captured[k], `missing capture ${k} (earlier test failed)`);
  const canonical = shapeOf(captured.pw_totp.slice(0, 1));
  const known = new Map(Object.entries(captured).map(([k, v]) => [methods(v).join(','), k]));
  known.set('magiclink,totp', 'magiclink_totp'); // same entry shape as otp; GoTrue's magic-link method name
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'supabase/tests')).filter((f) => f.endsWith('.sql')).map((f) => `supabase/tests/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'tests/db-concurrency')).filter((f) => f.endsWith('.mjs')).map((f) => `tests/db-concurrency/${f}`),
  ];
  let n = 0;
  const seen = new Set();
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/'(\[\{"method"[^']*\])'/g)) {
        if (/fixture:(reordered|malformed|synthetic)/.test(line)) continue; // deliberate negative/ordering cases, tagged in the file
        const where = `${f}:${i + 1}`;
        const amr = JSON.parse(m[1]);
        assert.ok(Array.isArray(amr) && amr.length > 0, `${where}: amr fixture is a non-empty array`);
        for (const e of amr) assert.equal(shapeOf([e]), canonical, `${where}: entry ${JSON.stringify(e)} is not {method:string, timestamp:number}`);
        for (const e of amr) assert.ok(Number.isInteger(e.timestamp), `${where}: timestamp is integer seconds`);
        const key = methods(amr).join(',');
        assert.ok(known.has(key), `${where}: method list [${key}] does not match a captured session (${[...known.keys()].join(' / ')})`);
        seen.add(known.get(key));
        n += 1;
      }
    });
  }
  console.log(`checked ${n} amr fixtures in ${files.length} files`);
  for (const k of ['pw_totp', 'pw', 'otp', 'otp_totp', 'anon']) assert.ok(seen.has(k), `no fixture uses the captured ${k} shape`);
  // The named fixtures in 14_admin_amr are the captured method lists.
  const t14 = fs.readFileSync(path.join(ROOT, 'supabase/tests/14_admin_amr.test.sql'), 'utf8');
  const pwTotp = JSON.parse(t14.match(/function test_amr\.pw_totp\(\)[\s\S]*?'(\[[^']*\])'/)[1]);
  assert.deepEqual(methods(pwTotp), methods(captured.pw_totp));
  const otpTotp = JSON.parse(t14.match(/function test_amr\.otp_totp\(\)[\s\S]*?'(\[[^']*\])'/)[1]);
  assert.deepEqual(methods(otpTotp), methods(captured.otp_totp));
});
