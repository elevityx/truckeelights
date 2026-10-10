// The digest email (Spec_Subscribe_Accounts Amendment 3): Direction B, the "neighborly letter", from the approved
// mockup. A white page, a small seasonal wordmark badge, one friendly line, then plain lists of houses and events.
// A season opener (the first digest of a season for this subscriber) swaps the badge row for Direction A's header
// band. Plus a plain-text part.
// Rules: everything that comes from data is escaped; links carry only validated UUIDs; the only images are the
// wordmark PNGs per season, served from SITE_URL (public/email/, made by scripts/email/render.mjs); body text uses
// system fonts. Pure functions, no I/O, no clock: every date derives from the row's window end and the row's claimed
// season, so a re-render of the same row is byte-for-byte identical. Up to 10 houses and 10 events, then "and N more".
import type { DigestEvent, DigestHouse, Season } from './db.ts';
import { UUID } from './http.ts';

export const MAX_ITEMS = 10;
export const REGION_TZ = 'America/Los_Angeles';
export const LAND_ACK = 'Truckee sits on the ancestral homeland of the Washoe (Wašiw) people.';

export interface DigestContent {
  houses: DigestHouse[];
  events: DigestEvent[];
  housesTotal: number;
  eventsTotal: number;
}

export interface RenderInput extends DigestContent {
  siteUrl: string;
  unsubUrl: string;
  prefsUrl: string;
  cadence: 'daily' | 'weekly';
  /** The region's IANA zone (from the digest row); falls back to Pacific. */
  timezone?: string;
  /** The season fixed on the row at claim time. */
  season: Season;
  seasonYear: number;
  /** First digest of this season for the subscriber: the header band replaces the badge row. */
  seasonOpener: boolean;
  /** The row's window end (ISO): the email's date. */
  windowTo: string;
  regionName?: string;
}

export interface Rendered { subject: string; html: string; text: string }

interface Theme {
  brand: string; short: string; label: string;
  night: string; ink: string; mute: string; line: string; link: string;
  chipBg: string; chipInk: string; btnBg: string; btnInk: string; tagBg: string; tagInk: string;
}

/** Colors from the approved mockup (Direction B), per season. */
export const THEMES: Record<Season, Theme> = {
  halloween: {
    brand: 'Truckee Frights', short: 'Frights', label: 'Halloween',
    night: '#140A1F', ink: '#1E1329', mute: '#5E5270', line: '#E2D9EC', link: '#5B2A91',
    chipBg: '#FF7A1A', chipInk: '#1E1329', btnBg: '#FF7A1A', btnInk: '#1E1329', tagBg: '#EDE3F7', tagInk: '#4A2178',
  },
  christmas: {
    brand: 'Truckee Lights', short: 'Lights', label: 'Christmas',
    night: '#123B2C', ink: '#1B2620', mute: '#55615A', line: '#E4DDCB', link: '#1E6B4E',
    chipBg: '#C62828', chipInk: '#FFFFFF', btnBg: '#C62828', btnInk: '#FFFFFF', tagBg: '#FBEFCB', tagInk: '#6B4E00',
  },
};

const SYS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

interface House { id: string; address: string; town: string | null; votes: number }
interface Event { id: string; title: string; starts_at: string; venue: string | null; town: string | null; far: boolean }
interface Content { houses: House[]; events: Event[]; housesTotal: number; eventsTotal: number }

/** Drops malformed rows, cleans text fields and caps each list. Returns null when there is nothing to send. */
export function normalizeContent(c: DigestContent): Content | null {
  const houses: House[] = (c.houses ?? [])
    .filter((h) => UUID.test(h.id) && cleanText(h.address) !== null)
    .slice(0, MAX_ITEMS)
    .map((h) => ({
      id: h.id, address: cleanText(h.address)!, town: cleanText(h.town),
      votes: typeof h.votes === 'number' && Number.isInteger(h.votes) && h.votes > 0 ? h.votes : 0,
    }));
  const events: Event[] = (c.events ?? [])
    .filter((e) => UUID.test(e.id) && cleanText(e.title) !== null && !Number.isNaN(Date.parse(e.starts_at)))
    .slice(0, MAX_ITEMS)
    .map((e) => ({
      id: e.id, title: cleanText(e.title)!, starts_at: e.starts_at, venue: cleanText(e.venue), town: cleanText(e.town),
      far: e.far === true,
    }));
  if (houses.length === 0 && events.length === 0) return null;
  return {
    houses,
    events,
    housesTotal: Math.max(c.housesTotal || 0, houses.length),
    eventsTotal: Math.max(c.eventsTotal || 0, events.length),
  };
}

function zone(timeZone?: string): string {
  if (!timeZone) return REGION_TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone; } catch { return REGION_TZ; }
}

function parts(iso: string, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: zone(timeZone), ...opts }).formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** "7 pm", "5:30 pm" in the region's zone. */
export function timeLabel(iso: string, timeZone?: string): string {
  const p = parts(iso, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.hour}${p.minute === '00' ? '' : `:${p.minute}`} ${(p.dayPeriod ?? '').toLowerCase()}`;
}

/** { mon: 'OCT', day: '16', dow: 'Fri' } in the region's zone. */
export function dateChip(iso: string, timeZone?: string): { mon: string; day: string; dow: string } {
  const p = parts(iso, timeZone, { month: 'short', day: 'numeric', weekday: 'short' });
  return { mon: (p.month ?? '').toUpperCase(), day: p.day ?? '', dow: p.weekday ?? '' };
}

/** "Thu, Oct 15" in the region's zone. */
export function dayLabel(iso: string, timeZone?: string): string {
  const p = parts(iso, timeZone, { month: 'short', day: 'numeric', weekday: 'short' });
  return `${p.weekday}, ${p.month} ${p.day}`;
}

/** "Sat, Dec 5, 6 pm" in the region's zone. */
export function formatPacific(iso: string, timeZone: string = REGION_TZ): string {
  return `${dayLabel(iso, timeZone)}, ${timeLabel(iso, timeZone)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function votesLabel(n: number): string {
  return n > 0 ? plural(n, 'vote', 'votes') : 'Be the first to vote';
}

/** "New on the Frights map: 14 houses, 6 events"; a season opener: "Truckee Frights is back: 14 houses, 6 events". */
export function subjectFor(c: Pick<DigestContent, 'housesTotal' | 'eventsTotal'>, season: Season, opener = false): string {
  const t = THEMES[season];
  const bits: string[] = [];
  if (c.housesTotal > 0) bits.push(plural(c.housesTotal, 'house', 'houses'));
  if (c.eventsTotal > 0) bits.push(plural(c.eventsTotal, 'event', 'events'));
  return opener ? `${t.brand} is back: ${bits.join(', ')}` : `New on the ${t.short} map: ${bits.join(', ')}`;
}

/** The one friendly line under "Hi neighbor,". Counts are the full totals, not just the ten shown. */
export function introFor(
  c: Pick<DigestContent, 'housesTotal' | 'eventsTotal'>, cadence: 'daily' | 'weekly', season: Season, year: number, opener: boolean,
): string {
  const t = THEMES[season];
  const when = cadence === 'weekly' ? 'this past week' : 'since yesterday';
  const lead = opener ? `${t.brand} is back for ${t.label} ${year}. ` : '';
  const h = c.housesTotal;
  const e = c.eventsTotal;
  if (h > 0 && e > 0) {
    return `${lead}${plural(h, 'new house', 'new houses')} went up on the map ${when}, and ${plural(e, 'new event was', 'new events were')} added. Here’s what’s new.`;
  }
  if (h > 0) return `${lead}${plural(h, 'new house', 'new houses')} went up on the map ${when}. Here’s what’s new.`;
  return `${lead}${plural(e, 'new event', 'new events')} went up on the map ${when}. Here’s what’s coming up.`;
}

export function renderDigest(input: RenderInput): Rendered | null {
  const c = normalizeContent(input);
  if (!c) return null;
  const season: Season = input.season === 'halloween' ? 'halloween' : 'christmas';
  const t = THEMES[season];
  const tz = input.timezone;
  const year = Number.isInteger(input.seasonYear) ? input.seasonYear : Number.parseInt(String(input.seasonYear), 10) || 0;
  const site = input.siteUrl.replace(/\/+$/, '');
  const mapUrl = `${site}/`;
  const listUrl = `${site}/?view=list`;
  const eventsUrl = `${site}/?view=list&layer=events`;
  const houseUrl = (id: string) => `${site}/?house=${encodeURIComponent(id)}`;
  const eventUrl = (id: string) => `${site}/?event=${encodeURIComponent(id)}`;
  const img = (name: string) => `${site}/email/${season}-${name}.png`;
  const moreHouses = c.housesTotal - c.houses.length;
  const moreEvents = c.eventsTotal - c.events.length;
  const when = input.cadence === 'weekly' ? 'this past week' : 'since yesterday';
  const date = dayLabel(input.windowTo, tz);
  const subject = subjectFor(c, season, input.seasonOpener);
  const intro = introFor(c, input.cadence, season, year, input.seasonOpener);
  const preheader = `Hi neighbor, here’s what went up ${when}, starting with ${c.houses[0]?.address ?? c.events[0]?.title}.`;
  const region = cleanText(input.regionName) ?? 'Truckee';
  const why = `You’re getting this ${input.cadence} email because you subscribed to new houses and events around ${region}.`;
  const free = `${t.brand} is a free, non-commercial community map. No ads, no paid listings.`;
  const voteLine = 'Seen one that made you stop the car? Your vote helps neighbors find the best ones.';
  const f = `font-family:${SYS};`;
  const e = escapeHtml;
  const a = (href: string, text: string, style: string) => `<a href="${e(href)}" style="${style}">${e(text)}</a>`;
  const rule = (pad: string) => `<tr><td style="padding:${pad}"><div style="height:1px;line-height:1px;font-size:1px;background:${t.line}">&nbsp;</div></td></tr>`;
  const top = (i: number) => (i ? `1px solid ${t.line}` : '0');
  const linkStyle = `font-size:16px;font-weight:700;color:${t.link};text-decoration:underline;text-decoration-color:${t.line}`;

  const h: string[] = [];
  h.push('<!doctype html>');
  h.push('<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  h.push('<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">');
  h.push(`<title>${e(subject)}</title></head>`);
  h.push('<body style="margin:0;padding:0;background:#FFFFFF;-webkit-text-size-adjust:100%">');
  h.push(`<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#FFFFFF">${e(preheader)}</div>`);
  h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF"><tr><td align="center" style="padding:0">');
  h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">');

  if (input.seasonOpener) {
    // Direction A's header band: 600x150 shown, a 1200x300 PNG with its dark background baked in.
    h.push(`<tr><td bgcolor="${t.night}" style="padding:0;line-height:0;font-size:0;background:${t.night}"><img src="${e(img('band'))}" width="600" height="150" alt="${e(t.brand)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#FFFFFF;${f}font-size:20px;font-weight:700"></td></tr>`);
    h.push(`<tr><td style="padding:16px 24px 14px;${f}font-size:13px;color:${t.mute}">${e(`${t.label} ${year} · ${date}`)}</td></tr>`);
  } else {
    // Direction B: the small wordmark badge (150x35 shown, 440x104 PNG on its own dark plate) and the date.
    h.push('<tr><td style="padding:22px 24px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>');
    h.push(`<td valign="middle" style="line-height:0;font-size:0"><img src="${e(img('badge'))}" width="150" height="35" alt="${e(t.brand)}" style="display:block;width:150px;height:35px;border:0;color:${t.ink};${f}font-size:15px;font-weight:700"></td>`);
    h.push(`<td align="right" valign="middle" style="${f}font-size:13px;color:${t.mute}">${e(date)}</td>`);
    h.push('</tr></table></td></tr>');
  }
  h.push(rule('0 24px'));
  h.push(`<tr><td style="padding:22px 24px 6px;font-family:${SERIF};color:${t.ink}"><p style="margin:0 0 10px;font-size:21px;line-height:1.3">Hi neighbor,</p>`);
  h.push(`<p style="margin:0;font-size:17px;line-height:1.55">${e(intro)}</p></td></tr>`);

  if (c.houses.length > 0) {
    h.push(`<tr><td style="padding:22px 24px 4px;${f}font-size:15px;font-weight:800;color:${t.ink}">New houses <span style="color:${t.mute};font-weight:600">· ${c.housesTotal}</span></td></tr>`);
    c.houses.forEach((x, i) => {
      const votes = x.votes > 0 ? e(votesLabel(x.votes)) : `<span style="color:${t.ink};font-weight:600">${e(votesLabel(0))}</span>`;
      h.push(`<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:${top(i)}"><tr>`);
      h.push(`<td valign="middle" style="padding:10px 0;${f}">${a(houseUrl(x.id), x.address, linkStyle)}`);
      h.push(`<div style="font-size:14px;color:${t.mute};margin-top:2px">${x.town ? `${e(x.town)} · ` : ''}${votes}</div></td></tr></table></td></tr>`);
    });
    if (moreHouses > 0) {
      h.push(`<tr><td style="padding:8px 24px 0;${f}font-size:15px">${a(listUrl, `And ${plural(moreHouses, 'more house', 'more houses')} on the map`, `color:${t.link};font-weight:700`)}</td></tr>`);
    }
  }

  if (c.events.length > 0) {
    h.push(`<tr><td style="padding:26px 24px 4px;${f}font-size:15px;font-weight:800;color:${t.ink}">Coming up <span style="color:${t.mute};font-weight:600">· ${c.eventsTotal}</span></td></tr>`);
    c.events.forEach((x, i) => {
      const chip = dateChip(x.starts_at, tz);
      const where = x.town ?? x.venue;
      const tag = x.far
        ? ` &nbsp;<span style="display:inline-block;background:${t.tagBg};color:${t.tagInk};font-size:11px;font-weight:700;letter-spacing:.3px;padding:2px 7px;border-radius:999px;white-space:nowrap">Worth the drive</span>`
        : '';
      h.push(`<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:${top(i)}"><tr>`);
      h.push(`<td width="56" valign="top" style="padding:10px 12px 10px 0;width:56px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td align="center" bgcolor="${t.chipBg}" style="width:44px;padding:4px 0 5px;background:${t.chipBg};color:${t.chipInk};border-radius:8px;${f}line-height:1"><span style="display:block;font-size:10px;font-weight:700;letter-spacing:1px">${e(chip.mon)}</span><span style="display:block;font-size:18px;font-weight:800;margin-top:3px">${e(chip.day)}</span></td></tr></table></td>`);
      h.push(`<td valign="middle" style="padding:10px 0;${f}">${a(eventUrl(x.id), x.title, linkStyle)}`);
      h.push(`<div style="font-size:14px;color:${t.mute};margin-top:2px">${e(`${chip.dow} ${timeLabel(x.starts_at, tz)}`)}${where ? ` · ${e(where)}` : ''}${tag}</div></td></tr></table></td></tr>`);
    });
    if (moreEvents > 0) {
      h.push(`<tr><td style="padding:8px 24px 0;${f}font-size:15px">${a(eventsUrl, `And ${plural(moreEvents, 'more event', 'more events')} on the map`, `color:${t.link};font-weight:700`)}</td></tr>`);
    }
  }

  const button = (href: string, label: string) =>
    `<tr><td align="left" style="padding:14px 24px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${t.btnBg}" style="border-radius:8px;background:${t.btnBg}">${a(href, label, `display:inline-block;padding:12px 22px;${f}font-size:16px;font-weight:700;color:${t.btnInk};text-decoration:none;border-radius:8px`)}</td></tr></table></td></tr>`;
  if (c.houses.length > 0) {
    h.push(`<tr><td style="padding:26px 24px 0;font-family:${SERIF};font-size:17px;line-height:1.55;color:${t.ink}">${e(voteLine)}</td></tr>`);
    h.push(button(mapUrl, 'Vote for your favorite'));
  } else {
    h.push(button(eventsUrl, 'See what’s coming up'));
  }
  h.push(`<tr><td style="padding:22px 24px 4px;font-family:${SERIF};font-size:16px;line-height:1.5;color:${t.ink}">See you out there,<br>${e(t.brand)}, your neighborhood map</td></tr>`);
  h.push(rule('16px 24px 0'));
  const fl = `color:${t.mute};font-weight:700;text-decoration:underline`;
  h.push(`<tr><td style="padding:22px 24px 28px;${f}font-size:12.5px;line-height:1.55;color:${t.mute}">`);
  h.push(`<p style="margin:0 0 10px">${e(why)}</p>`);
  h.push(`<p style="margin:0 0 10px">${a(input.prefsUrl, 'Manage preferences', fl)} &nbsp;·&nbsp; ${a(input.unsubUrl, 'Unsubscribe', fl)}</p>`);
  h.push(`<p style="margin:0 0 10px">${e(free)}</p>`);
  h.push(`<p style="margin:0">${e(LAND_ACK)}</p></td></tr>`);
  h.push('</table></td></tr></table></body></html>');

  const txt: string[] = [];
  txt.push(input.seasonOpener ? `${t.brand} · ${t.label} ${year} · ${date}` : `${t.brand} · ${date}`, '');
  txt.push('Hi neighbor,', '', intro, '');
  if (c.houses.length > 0) {
    txt.push(`NEW HOUSES (${c.housesTotal})`);
    for (const x of c.houses) txt.push(`- ${x.address}${x.town ? `, ${x.town}` : ''} (${votesLabel(x.votes)})\n  ${houseUrl(x.id)}`);
    if (moreHouses > 0) txt.push(`And ${plural(moreHouses, 'more house', 'more houses')} on the map: ${listUrl}`);
    txt.push('');
  }
  if (c.events.length > 0) {
    txt.push(`COMING UP (${c.eventsTotal})`);
    for (const x of c.events) {
      const where = x.town ?? x.venue;
      txt.push(`- ${x.title}: ${formatPacific(x.starts_at, zone(tz))}${where ? `, ${where}` : ''}${x.far ? ' (worth the drive)' : ''}\n  ${eventUrl(x.id)}`);
    }
    if (moreEvents > 0) txt.push(`And ${plural(moreEvents, 'more event', 'more events')} on the map: ${eventsUrl}`);
    txt.push('');
  }
  if (c.houses.length > 0) txt.push(voteLine, `Vote for your favorite: ${mapUrl}`, '');
  else txt.push(`See what’s coming up: ${eventsUrl}`, '');
  txt.push('See you out there,', `${t.brand}, your neighborhood map`, '', '--', why,
    `Manage preferences: ${input.prefsUrl}`, `Unsubscribe: ${input.unsubUrl}`, '', free, LAND_ACK);

  return { subject, html: h.join('\n'), text: txt.join('\n') };
}
