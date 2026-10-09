// AC33b: the network-header probe with a mocked fetch. It never prints an address or a digest.
import { describe, expect, it } from 'vitest';
import { FORGED_IP, TRACE_URL, hmacHex, normalizeNet, runProbe } from './probe-network-header.mjs';

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable' };
const MY_IP = '198.51.100.23';

/** Fake Cloudflare + PostgREST. mode: 'authentic' (ingress overwrites), 'forgeable' (trusts the caller), 'none'. */
function mockFetch(mode, digests) {
  return async (url, init = {}) => {
    if (url === TRACE_URL) return new Response(`fl=1\nh=truckeelights.com\nip=${MY_IP}\nts=1\n`);
    const nonce = JSON.parse(init.body).p_nonce;
    if (mode === 'none') return Response.json([{ source: 'none', family: null, digest: null }]);
    const sent = init.headers?.['cf-connecting-ip'];
    const seen = mode === 'forgeable' && sent ? sent : MY_IP;
    const digest = hmacHex(normalizeNet(seen), nonce);
    digests.push(digest);
    return Response.json([{ source: 'cf-connecting-ip', family: 4, digest }]);
  };
}
async function run(mode) {
  const lines = []; const digests = [];
  const ok = await runProbe({ fetch: mockFetch(mode, digests), env: ENV, log: (l) => lines.push(String(l)), sleep: async () => {}, rounds: 2 });
  return { ok, out: lines.join('\n'), digests };
}

describe('probe-network-header', () => {
  it('PASS when both digests match the known address', async () => {
    const { ok, out } = await run('authentic');
    expect(ok).toBe(true);
    expect(out).toMatch(/PROBE PASS/);
  });
  it('FAIL when the forged call digest equals HMAC(192.0.2.55)', async () => {
    const { ok, out } = await run('forgeable');
    expect(ok).toBe(false);
    expect(out).toMatch(/step 3 .*FAIL/);
    expect(out).toMatch(/PROBE FAIL/);
  });
  it('FAIL when source = none', async () => {
    const { ok, out } = await run('none');
    expect(ok).toBe(false);
    expect(out).toMatch(/step 2 .*FAIL/);
  });
  it('FAIL without env', async () => {
    expect(await runProbe({ fetch: mockFetch('authentic', []), env: {}, log: () => {}, rounds: 1 })).toBe(false);
  });
  it('prints no IP address or digest', async () => {
    for (const mode of ['authentic', 'forgeable', 'none']) {
      const { out, digests } = await run(mode);
      expect(out).not.toContain(MY_IP);
      expect(out).not.toContain(FORGED_IP);
      expect(out).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
      expect(out).not.toMatch(/[0-9a-f]{16,}/);
      for (const d of digests) expect(out).not.toContain(d);
    }
  });
  it('normalizes like Postgres (IPv4 /32, IPv6 /64)', () => {
    expect(normalizeNet('203.0.113.7')).toBe('203.0.113.7/32');
    expect(normalizeNet('2001:db8:1:2:ffff::b')).toBe('2001:db8:1:2::/64');
    expect(normalizeNet('2001:0db8:0000:0000:1:2:3:4')).toBe('2001:db8::/64');
    expect(normalizeNet('2001:db8:0:1::5')).toBe('2001:db8:0:1::/64');
    expect(normalizeNet('2001:0:0:1::')).toBe('2001:0:0:1::/64');
    expect(normalizeNet('2001:db8:1:0:5::')).toBe('2001:db8:1::/64');
    expect(normalizeNet('2606:4700:0:0:0:0:0:1')).toBe('2606:4700::/64');
    expect(() => normalizeNet('not-an-ip')).toThrow();
  });
});
