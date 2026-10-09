// Pure helpers for the admin Events tab (Spec_Events §3.6, Amendment 1 A2/A3/A4/A6/A10). No mini-map.
// The database re-validates everything; these checks are for fast feedback only.
import type { AdminEvent, DataError, EventInput, EventStatus, Region } from '@/lib/data/types';

export const FILTERS: EventStatus[] = ['pending', 'approved', 'hidden', 'rejected'];
export const FILTER_LABEL: Record<EventStatus, string> = { pending: 'Pending', approved: 'Approved', hidden: 'Hidden', rejected: 'Rejected' };

/** Which actions a card offers for a status (mirrors the allowed transitions). */
export type EventAction = 'approve' | 'reject' | 'edit' | 'hide' | 'restore';
export function actionsFor(status: EventStatus): EventAction[] {
  switch (status) {
    case 'pending': return ['approve', 'reject', 'edit'];
    case 'approved': return ['edit', 'hide'];
    case 'hidden': return ['restore', 'edit'];
    default: return ['restore', 'edit']; // rejected -> approved
  }
}

export function badgeText(pending: number | null): string {
  return pending === null || pending <= 0 ? 'Events' : `Events (${pending})`;
}

export const REASON_MAX = 200;
/** Reject needs a non-empty reason of at most 200 characters. */
export function checkReason(raw: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = raw.trim().replace(/\s+/g, ' ');
  if (reason === '') return { ok: false, error: 'Add a reason for rejecting.' };
  if (reason.length > REASON_MAX) return { ok: false, error: `Keep the reason under ${REASON_MAX} characters.` };
  return { ok: true, reason };
}

// ---- URL (A6 mirror) -------------------------------------------------------------------------------
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly']);
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** The lowercase hostname if `raw` passes the event URL rules, else null. */
export function parseEventUrl(raw: string): string | null {
  if (raw.length > 300 || !/^https:\/\/[^\s@\\<>"']+$/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  const rest = raw.slice('https://'.length);
  const authority = rest.split(/[/?#]/, 1)[0];
  if (authority === '' || authority.includes(':') || authority.includes('[')) return null; // port or IPv6
  const host = authority.toLowerCase();
  if (!HOST_RE.test(host) || SHORTENERS.has(host) || /^[0-9.]+$/.test(host) || host.endsWith('.localhost')) return null;
  return host;
}

/** Hostname to show on a card: the parsed host when valid, else a marked fallback so a bad link never looks fine. */
export function displayHost(raw: string | null): string | null {
  if (raw === null) return null;
  return parseEventUrl(raw) ?? 'unrecognized link';
}

// ---- Bounds (A3 mirror: bbox +0.05 on every side, east edge +0.10) -------------------------------
export function eventBounds(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>) {
  return { minLat: r.minLat - 0.05, maxLat: r.maxLat + 0.05, minLng: r.minLng - 0.05, maxLng: r.maxLng + 0.1 };
}
export function inEventBounds(r: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng'>, lat: number, lng: number): boolean {
  const b = eventBounds(r);
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng; // NaN fails
}

// ---- Time (A2): explicit zone, no device zone, DST gap rejected, fold takes the earlier offset -----
function offsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** `YYYY-MM-DD` + `HH:MM` in `tz` to an ISO UTC string, or 'dst_gap' / 'invalid'. */
export function localToUtc(date: string, time: string, tz: string): string | 'dst_gap' | 'invalid' {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return 'invalid';
  const [y, mo, da, h, mi] = [+d[1], +d[2], +d[3], +t[1], +t[2]];
  const asUtc = Date.UTC(y, mo - 1, da, h, mi);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== da || h > 23 || mi > 59) return 'invalid';
  const offs = new Set([offsetMinutes(asUtc - 86_400_000, tz), offsetMinutes(asUtc + 86_400_000, tz)]);
  const valid: number[] = [];
  for (const o of offs) {
    const utc = asUtc - o * 60_000;
    if (offsetMinutes(utc, tz) === o) valid.push(utc);
  }
  if (valid.length === 0) return 'dst_gap';
  return new Date(Math.min(...valid)).toISOString();
}

/** ISO UTC to `{date, time}` in `tz`, for prefilling the edit form. */
export function utcToLocal(iso: string, tz: string): { date: string; time: string } {
  const ms = Date.parse(iso);
  const off = offsetMinutes(ms, tz);
  const s = new Date(ms + off * 60_000).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

// ---- Form ----------------------------------------------------------------------------------------
export interface EventFormValues {
  title: string; description: string; venue: string; address: string;
  lat: string; lng: string; startDate: string; startTime: string; endDate: string; endTime: string;
  url: string; adultsOnly: boolean; sourceUrl: string;
}
export const emptyForm = (): EventFormValues => ({
  title: '', description: '', venue: '', address: '', lat: '', lng: '', startDate: '', startTime: '', endDate: '', endTime: '',
  url: '', adultsOnly: false, sourceUrl: '',
});

export function formFromEvent(e: AdminEvent, tz: string): EventFormValues {
  const s = utcToLocal(e.startsAt, tz);
  const en = e.endsAt ? utcToLocal(e.endsAt, tz) : { date: '', time: '' };
  return {
    title: e.title, description: e.description, venue: e.venue ?? '', address: e.address, lat: String(e.lat), lng: String(e.lng),
    startDate: s.date, startTime: s.time, endDate: en.date, endTime: en.time, url: e.url ?? '', adultsOnly: e.adultsOnly, sourceUrl: e.sourceUrl ?? '',
  };
}

const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');
const MAX_SPAN_MS = 31 * 86_400_000;

export type FormErrors = Partial<Record<keyof EventFormValues, string>>;
export type FormResult = { ok: true; input: EventInput; sourceUrl: string | null } | { ok: false; errors: FormErrors };

/** Validate and convert. Admin writes skip the "starts in the past" lower bound (typo fixes). */
export function buildEventInput(v: EventFormValues, region: Pick<Region, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'timezone'>): FormResult {
  const errors: FormErrors = {};
  const title = collapse(v.title);
  if (title.length < 3 || title.length > 80) errors.title = 'Title needs 3 to 80 characters.';
  else if (/[<>]/.test(title)) errors.title = 'Remove < and > from the title.';
  const description = v.description.trim();
  if (description.length < 10 || description.length > 600) errors.description = 'Description needs 10 to 600 characters.';
  else if (/[<>]/.test(description)) errors.description = 'Remove < and > from the description.';
  else if ((description.match(/\n/g) ?? []).length > 6) errors.description = 'Use at most 6 line breaks.';
  const venue = collapse(v.venue);
  if (venue.length > 80) errors.venue = 'Venue can be up to 80 characters.';
  else if (/[<>]/.test(venue)) errors.venue = 'Remove < and > from the venue.';
  const address = collapse(v.address);
  if (address.length < 5 || address.length > 120) errors.address = 'Address needs 5 to 120 characters.';
  const lat = v.lat.trim() === '' ? NaN : Number(v.lat);
  const lng = v.lng.trim() === '' ? NaN : Number(v.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) errors.lat = 'Enter latitude and longitude.';
  else if (!inEventBounds(region, lat, lng)) errors.lat = 'That spot is outside the map area.';

  let startsAt = '';
  const s = localToUtc(v.startDate, v.startTime, region.timezone);
  if (s === 'dst_gap') errors.startTime = 'That time does not exist on that date (clocks skip ahead). Pick another.';
  else if (s === 'invalid') errors.startDate = 'Enter a start date and time.';
  else startsAt = s;

  let endsAt: string | null = null;
  if (v.endDate !== '' || v.endTime !== '') {
    if (v.endTime === '') errors.endTime = 'Enter an end time, or clear the end date.';
    else {
      const endDate = v.endDate === '' ? v.startDate : v.endDate;
      const e = localToUtc(endDate, v.endTime, region.timezone);
      if (e === 'dst_gap') errors.endTime = 'That time does not exist on that date (clocks skip ahead). Pick another.';
      else if (e === 'invalid') errors.endTime = 'Enter a valid end date and time.';
      else if (startsAt !== '') {
        const span = Date.parse(e) - Date.parse(startsAt);
        if (span <= 0) errors.endDate = v.endDate === '' && v.endTime < v.startTime ? 'Ends the next day? Set the end date.' : 'The end must be after the start.';
        else if (span > MAX_SPAN_MS) errors.endDate = 'An event can run at most 31 days.';
        else endsAt = e;
      }
    }
  }

  const url = v.url.trim();
  if (url !== '' && parseEventUrl(url) === null) errors.url = 'Use a full https:// link to a real website (no short links).';
  const sourceUrl = v.sourceUrl.trim();
  if (sourceUrl !== '' && parseEventUrl(sourceUrl) === null) errors.sourceUrl = 'Use a full https:// link to a real website (no short links).';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    sourceUrl: sourceUrl === '' ? null : sourceUrl,
    input: { title, description, venue: venue === '' ? null : venue, address, placeId: null, lat, lng, startsAt, endsAt, url: url === '' ? null : url, adultsOnly: v.adultsOnly },
  };
}

// ---- Errors ---------------------------------------------------------------------------------------
/** Event-specific copy for admin actions; falls back to the caller's generic message. */
export function eventErrorText(e: DataError, fallback: string): string {
  if (e.code === 'invalid_input') {
    if (e.detail === 'transition') return 'That change is no longer allowed. Refresh the list.';
    return e.detail ? `Check the ${e.detail.replace(/_/g, ' ')} field.` : 'Check the form and try again.';
  }
  if (e.code === 'not_found') return 'That event is gone. Refresh the list.';
  if (e.code === 'out_of_bounds') return 'That spot is outside the map area.';
  return fallback;
}
