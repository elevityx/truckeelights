import { describe, expect, it } from 'vitest';
import { checkEventUrl, eventUrlHost, eventUrlMessage, type EventUrlProblem } from './eventUrl';

// Parity table with private.valid_event_url (supabase/tests/10_events.test.sql, A6).
describe('checkEventUrl mirrors private.valid_event_url', () => {
  it.each([
    ['https://example.org', 'example.org'],
    ['https://Example.COM/a?b=1#top', 'example.com'],
    ['https://www.tcpud.org/recreation/special-events/harvest-fest?x=1', 'www.tcpud.org'],
    ['https://a-b.example.org/x', 'a-b.example.org'],
    ['https://example.org/path/with.dots/', 'example.org'],
    ['https://bit.lyx.org/x', 'bit.lyx.org'],
    ['https://notbit.ly.org/x', 'notbit.ly.org'],
  ])('accepts %s', (url, host) => {
    expect(checkEventUrl(url)).toEqual({ ok: true, host });
  });

  const bad: [string, EventUrlProblem][] = [
    ['http://example.org', 'scheme'],
    ['HTTPS://example.org', 'scheme'], // scheme is case-sensitive
    ['javascript:alert(1)', 'scheme'],
    ['https://user@example.org', 'chars'],
    ['https://user:pw@example.org', 'chars'],
    ['https://example.org/`x`', 'chars'], // backtick
    ['https://example.org/a b', 'chars'],
    ['https://example.org/a\u0007b', 'chars'],
    ['https://example.org/a\u0085b', 'chars'],
    ['https://example.org\\@evil.com', 'chars'],
    ['https://example.org/"x', 'chars'],
    ["https://example.org/'x", 'chars'],
    ['https://example.org/<x>', 'chars'],
    ['https://example.org:8443/', 'port'],
    ['https://example.org:443', 'port'],
    ['https://[::1]/', 'port'],
    ['https://example.org./event', 'host'], // trailing dot
    ['https://192.168.0.1/', 'host'],
    ['https://3232235521/', 'host'],
    ['https://0x7f000001/', 'host'],
    ['https://0177.0.0.1/', 'host'],
    ['https://localhost/', 'host'],
    ['https://foo.localhost/x', 'host'],
    ['https://intranet/', 'host'],
    ['https://example.c', 'host'],
    ['https://-bad.com', 'host'],
    ['https://bad-.com', 'host'],
    ['https://' + 'a'.repeat(64) + '.com', 'host'], // label over 63
    ['https://a..com', 'host'],
    ['https://', 'host'],
    ['https://bit.ly/abc', 'shortener'],
    ['https://www.bit.ly/abc', 'shortener'], // shortener subdomain
    ['https://T.CO/x', 'shortener'],
    ['https://tinyurl.com', 'shortener'],
    ['https://rebrand.ly/x', 'shortener'],
    ['https://example.org/' + 'a'.repeat(300), 'length'],
  ];
  it.each(bad)('rejects %s as %s', (url, problem) => {
    expect(checkEventUrl(url)).toEqual({ ok: false, problem });
  });

  it('counts code points like Postgres char_length: 141 emoji after the host is 161 characters and passes', () => {
    const url = 'https://example.org/' + '😀'.repeat(141);
    expect([...url].length).toBe(161);
    expect(url.length).toBe(302);
    expect(checkEventUrl(url)).toEqual({ ok: true, host: 'example.org' });
    expect(checkEventUrl('https://example.org/' + '😀'.repeat(281))).toEqual({ ok: false, problem: 'length' }); // 301 characters
    expect(checkEventUrl('https://example.org/' + '😀'.repeat(280))).toEqual({ ok: true, host: 'example.org' }); // 300
  });

  it('boundary: exactly 300 characters passes, 301 fails', () => {
    const base = 'https://example.org/';
    expect(checkEventUrl(base + 'a'.repeat(300 - base.length)).ok).toBe(true);
    expect(checkEventUrl(base + 'a'.repeat(301 - base.length))).toEqual({ ok: false, problem: 'length' });
  });

  it('eventUrlHost trims like the server, and every problem has copy', () => {
    expect(eventUrlHost('  https://Example.org/x  ')).toBe('example.org');
    expect(eventUrlHost('https://bit.ly/x')).toBeNull();
    for (const p of ['length', 'scheme', 'chars', 'port', 'host', 'shortener'] as const) expect(eventUrlMessage(p).length).toBeGreaterThan(10);
  });
});
