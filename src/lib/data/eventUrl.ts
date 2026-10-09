// The one client-side mirror of private.valid_event_url (supabase/migrations/20261013000100_events.sql, A6).
// Used by the visitor form, the admin form and card, and the public Website button. The database stays the
// authority; keep this function and the SQL in step (eventUrl.test.ts holds the parity table).

export const EVENT_URL_SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly'] as const;
export const EVENT_URL_MAX = 300;

export type EventUrlProblem = 'length' | 'scheme' | 'chars' | 'port' | 'host' | 'shortener';
export type EventUrlCheck = { ok: true; host: string } | { ok: false; problem: EventUrlProblem };

// Same character set as the SQL: userinfo, backslash, whitespace, control characters, quotes, angle brackets, backtick.
const BAD_CHARS = /[@\\\s\u0000-\u001f\u007f-\u009f"'<>`]/;
const HOST_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Check an already-trimmed URL exactly as the server does (case-sensitive scheme, no trailing dot, no port). */
export function checkEventUrl(v: string): EventUrlCheck {
  // Count Unicode code points, as Postgres char_length does (string.length counts an emoji as two units).
  if ([...v].length > EVENT_URL_MAX) return { ok: false, problem: 'length' };
  if (!v.startsWith('https://')) return { ok: false, problem: 'scheme' };
  if (BAD_CHARS.test(v)) return { ok: false, problem: 'chars' };
  const host = v.slice(8).toLowerCase().split('/', 1)[0].split('?', 1)[0].split('#', 1)[0];
  if (/[:[\]]/.test(host)) return { ok: false, problem: 'port' };
  // The letters-only TLD also rejects every IPv4 notation, single-label hosts and a trailing dot.
  if (!HOST_RE.test(host) || host === 'localhost' || host.endsWith('.localhost')) return { ok: false, problem: 'host' };
  if (EVENT_URL_SHORTENERS.some((s) => host === s || host.endsWith(`.${s}`))) return { ok: false, problem: 'shortener' };
  return { ok: true, host };
}

/** Copy for a failed check (visitor form and admin form share it). */
export function eventUrlMessage(p: EventUrlProblem): string {
  switch (p) {
    case 'length': return 'Use a shorter link (300 characters at most).';
    case 'scheme': return 'Use a link that starts with https://';
    case 'chars': return 'That link has characters we can’t accept.';
    case 'port': return 'Leave the port number out of the link.';
    case 'shortener': return 'Use the full link, not a shortened one.';
    default: return 'Use a link to a website, like https://example.org';
  }
}

/** The lowercase hostname when the (trimmed) URL passes the server rules, else null. */
export function eventUrlHost(raw: string): string | null {
  const r = checkEventUrl(raw.trim());
  return r.ok ? r.host : null;
}
