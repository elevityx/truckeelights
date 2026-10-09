// The digest email: a plain HTML part plus a text part. Everything that comes from data is escaped; links carry only
// validated UUIDs. Pure functions, no I/O. Up to 10 houses and 10 events, then "and N more".
import type { DigestEvent, DigestHouse } from './db.ts';
import { UUID } from './http.ts';

export const MAX_ITEMS = 10;
export const REGION_TZ = 'America/Los_Angeles';

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
}

export interface Rendered { subject: string; html: string; text: string }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Drops malformed rows and caps each list. Returns null when there is nothing to send. */
export function normalizeContent(c: DigestContent): DigestContent | null {
  const houses = c.houses.filter((h) => UUID.test(h.id) && typeof h.address === 'string' && h.address.trim() !== '').slice(0, MAX_ITEMS);
  const events = c.events.filter((e) => UUID.test(e.id) && typeof e.title === 'string' && e.title.trim() !== '' && !Number.isNaN(Date.parse(e.starts_at))).slice(0, MAX_ITEMS);
  if (houses.length === 0 && events.length === 0) return null;
  return {
    houses,
    events,
    housesTotal: Math.max(c.housesTotal, houses.length),
    eventsTotal: Math.max(c.eventsTotal, events.length),
  };
}

export function formatPacific(iso: string, timeZone: string = REGION_TZ): string {
  let tz = REGION_TZ;
  try { new Intl.DateTimeFormat('en-US', { timeZone }); tz = timeZone; } catch { /* unknown zone: keep Pacific */ }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function subjectFor(c: DigestContent): string {
  const parts: string[] = [];
  if (c.housesTotal > 0) parts.push(plural(c.housesTotal, 'new house', 'new houses'));
  if (c.eventsTotal > 0) parts.push(plural(c.eventsTotal, 'new event', 'new events'));
  return `Truckee Lights: ${parts.join(' and ')}`;
}

export function renderDigest(input: RenderInput): Rendered | null {
  const c = normalizeContent(input);
  if (!c) return null;
  const site = input.siteUrl.replace(/\/+$/, '');
  const mapUrl = `${site}/`;
  const houseUrl = (id: string) => `${site}/?house=${encodeURIComponent(id)}`;
  const eventUrl = (id: string) => `${site}/?event=${encodeURIComponent(id)}`;
  const moreHouses = c.housesTotal - c.houses.length;
  const moreEvents = c.eventsTotal - c.events.length;
  const why = `You're getting this ${input.cadence} email because you subscribed to new houses and events on Truckee Lights.`;

  const h: string[] = [];
  h.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Truckee Lights</title></head>');
  h.push('<body style="margin:0;padding:0;background:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1d1b17">');
  h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr><td align="center" style="padding:24px 12px">');
  h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;padding:24px">');
  h.push('<tr><td style="font-size:20px;font-weight:700;padding-bottom:4px">Truckee Lights</td></tr>');
  h.push(`<tr><td style="font-size:15px;color:#4a463f;padding-bottom:16px">${escapeHtml(subjectFor(c).replace('Truckee Lights: ', "What's new: "))}</td></tr>`);
  if (c.houses.length > 0) {
    h.push('<tr><td style="font-size:16px;font-weight:700;padding:8px 0 4px">New houses</td></tr>');
    for (const x of c.houses) {
      const label = x.town ? `${x.address}, ${x.town}` : x.address;
      h.push(`<tr><td style="font-size:15px;padding:4px 0"><a href="${escapeHtml(houseUrl(x.id))}" style="color:#0b5cad">${escapeHtml(label)}</a></td></tr>`);
    }
    if (moreHouses > 0) h.push(`<tr><td style="font-size:14px;color:#4a463f;padding:4px 0">and ${moreHouses} more on the map</td></tr>`);
  }
  if (c.events.length > 0) {
    h.push('<tr><td style="font-size:16px;font-weight:700;padding:16px 0 4px">New events</td></tr>');
    for (const e of c.events) {
      h.push(`<tr><td style="font-size:15px;padding:4px 0"><a href="${escapeHtml(eventUrl(e.id))}" style="color:#0b5cad">${escapeHtml(e.title)}</a><br><span style="font-size:13px;color:#4a463f">${escapeHtml(formatPacific(e.starts_at, input.timezone))}</span></td></tr>`);
    }
    if (moreEvents > 0) h.push(`<tr><td style="font-size:14px;color:#4a463f;padding:4px 0">and ${moreEvents} more on the map</td></tr>`);
  }
  h.push(`<tr><td style="padding:20px 0 8px"><a href="${escapeHtml(mapUrl)}" style="display:inline-block;background:#0b5cad;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 18px;border-radius:8px">See all on the map</a></td></tr>`);
  h.push(`<tr><td style="font-size:12px;color:#6a655b;padding-top:16px;border-top:1px solid #e6e1d6">${escapeHtml(why)}<br><a href="${escapeHtml(input.prefsUrl)}" style="color:#6a655b">Manage preferences</a> &middot; <a href="${escapeHtml(input.unsubUrl)}" style="color:#6a655b">Unsubscribe</a></td></tr>`);
  h.push('</table></td></tr></table></body></html>');

  const t: string[] = [subjectFor(c).replace('Truckee Lights: ', "Truckee Lights, what's new: "), ''];
  if (c.houses.length > 0) {
    t.push('NEW HOUSES');
    for (const x of c.houses) t.push(`- ${x.town ? `${x.address}, ${x.town}` : x.address}\n  ${houseUrl(x.id)}`);
    if (moreHouses > 0) t.push(`and ${moreHouses} more on the map`);
    t.push('');
  }
  if (c.events.length > 0) {
    t.push('NEW EVENTS');
    for (const e of c.events) t.push(`- ${e.title} (${formatPacific(e.starts_at, input.timezone)})\n  ${eventUrl(e.id)}`);
    if (moreEvents > 0) t.push(`and ${moreEvents} more on the map`);
    t.push('');
  }
  t.push(`See all on the map: ${mapUrl}`, '', why, `Manage preferences: ${input.prefsUrl}`, `Unsubscribe: ${input.unsubUrl}`);

  return { subject: subjectFor(c), html: h.join('\n'), text: t.join('\n') };
}
