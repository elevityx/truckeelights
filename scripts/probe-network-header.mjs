#!/usr/bin/env node
// Network-header authority probe for the per-network vote cap (maintainer only).
// Run from a normal home connection, never from CI:
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
//     node --dns-result-order=ipv4first scripts/probe-network-header.mjs
// 1. Known value: our own address as Cloudflare sees it, from our zone's /cdn-cgi/trace.
// 2. Authentic path: public.network_probe(nonce) must report cf-connecting-ip and HMAC(normalize(ip), nonce).
// 3. Anti-spoof: with forged cf-connecting-ip / x-forwarded-for headers, the digest must STILL match the known
//    address (the ingress overwrites what the caller sends) and must not match the forged one.
// Both checks run twice, a minute apart. Output is PASS/FAIL only: no address or digest is ever printed.
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

export const TRACE_URL = 'https://truckeelights.com/cdn-cgi/trace';
export const FORGED_IP = '192.0.2.55';
export const FORGED_HEADERS = { 'cf-connecting-ip': FORGED_IP, 'x-forwarded-for': '192.0.2.66' };

function expand6(ip) {
  let s = ip.toLowerCase();
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map((g) => parseInt(g, 16));
}
function compress6(groups) {
  let best = -1; let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i += 1; continue; }
    let j = i; while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}
/** Same text the database hashes: IPv4 -> "a.b.c.d/32"; IPv6 -> its /64 network, e.g. "2001:db8:1:2::/64". */
export function normalizeNet(ip) {
  const fam = isIP(ip);
  if (fam === 4) return `${ip}/32`;
  if (fam === 6) {
    const g = expand6(ip);
    return `${compress6([...g.slice(0, 4), 0, 0, 0, 0])}/64`;
  }
  throw new Error('not an IP address');
}
export const hmacHex = (text, nonce) => crypto.createHmac('sha256', nonce).update(text).digest('hex');
export const newNonce = () => crypto.randomBytes(24).toString('base64url'); // 32 chars of [A-Za-z0-9_-]

async function knownIp(fetchFn) {
  const res = await fetchFn(TRACE_URL);
  const text = await res.text();
  const ip = text.match(/^ip=(.+)$/m)?.[1]?.trim();
  return ip && isIP(ip) ? ip : null;
}
async function callProbe(fetchFn, url, key, nonce, extraHeaders = {}) {
  const res = await fetchFn(`${url.replace(/\/+$/, '')}/rest/v1/rpc/network_probe`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ p_nonce: nonce }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

/** Returns true only when every step passes in every round. `log` receives PASS/FAIL lines only. */
export async function runProbe({
  fetch: fetchFn = globalThis.fetch, env = process.env, log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), rounds = 2, gapMs = 60_000,
} = {}) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL; const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) { log('FAIL setup: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'); return false; }
  let all = true;
  for (let round = 1; round <= rounds; round += 1) {
    if (round > 1) await sleep(gapMs);
    let ip = null;
    try { ip = await knownIp(fetchFn); } catch { ip = null; }
    if (!ip) { log(`round ${round} step 1 (known address from trace): FAIL`); all = false; continue; }
    log(`round ${round} step 1 (known address from trace): PASS (family v${isIP(ip)})`);
    const expected = (n) => hmacHex(normalizeNet(ip), n);

    let ok2 = false;
    try {
      const n = newNonce(); const row = await callProbe(fetchFn, url, key, n);
      ok2 = row?.source === 'cf-connecting-ip' && row?.digest === expected(n);
    } catch { ok2 = false; }
    log(`round ${round} step 2 (authentic path): ${ok2 ? 'PASS' : 'FAIL'}`);

    let ok3 = false;
    try {
      const n = newNonce(); const row = await callProbe(fetchFn, url, key, n, FORGED_HEADERS);
      ok3 = row?.source === 'cf-connecting-ip' && row?.digest === expected(n) && row?.digest !== hmacHex(`${FORGED_IP}/32`, n);
    } catch { ok3 = false; }
    log(`round ${round} step 3 (forged header is overwritten): ${ok3 ? 'PASS' : 'FAIL'}`);
    all = all && ok2 && ok3;
  }
  log(all ? 'PROBE PASS: the network cap may be turned on' : 'PROBE FAIL: keep the network cap off');
  return all;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProbe().then((ok) => { process.exitCode = ok ? 0 : 1; });
}
