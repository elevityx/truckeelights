import { checkEventUrl } from '@/lib/data/eventUrl';
import type { PublicEvent, Season } from '@/lib/data/types';
import { mapShareUrl, type ShareData } from '@/lib/share/urls';
import { DEFAULT_LENGTH_MS } from '@/lib/time/pacific';

// Every URL here is built with URL/URLSearchParams, never by string concatenation of data.

/** Calendar entries with no end time get the same 3 hours the map uses. */
const CAL_LENGTH_MS = DEFAULT_LENGTH_MS;

function gcalStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261030T230000Z
}

export function placeLine(e: Pick<PublicEvent, 'venue' | 'address'>): string {
  return e.venue ? `${e.venue}, ${e.address}` : e.address;
}

/** Google Calendar "add event" link. Times are UTC (Z); ctz only sets the zone Google shows. */
export function googleCalendarUrl(e: PublicEvent, tz: string): string {
  const end = e.endsAt ?? new Date(Date.parse(e.startsAt) + CAL_LENGTH_MS).toISOString();
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', e.title);
  u.searchParams.set('dates', `${gcalStamp(e.startsAt)}/${gcalStamp(end)}`);
  u.searchParams.set('ctz', tz);
  u.searchParams.set('details', e.url ? `${e.description}\n\n${e.url}` : e.description);
  u.searchParams.set('location', placeLine(e));
  return u.toString();
}

/** Directions to the pin's coordinates (not the free-text address). */
export function directionsUrl(e: Pick<PublicEvent, 'lat' | 'lng'>): string {
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('destination', `${e.lat},${e.lng}`);
  return u.toString();
}

/** Link that opens one event's sheet on the map (`/?event=<id>`). */
export function eventShareUrl(base: string | undefined, eventId: string): string {
  const u = new URL(mapShareUrl(base));
  u.searchParams.set('event', eventId);
  return u.toString();
}

export function eventShareData(season: Season, base: string | undefined, e: Pick<PublicEvent, 'id' | 'title'>): ShareData {
  return {
    title: season === 'halloween' ? 'Truckee Frights' : 'Truckee Lights',
    text: `${e.title}, on the ${season === 'halloween' ? 'Truckee Frights' : 'Truckee Lights'} map`,
    url: eventShareUrl(base, e.id),
  };
}

/** Only https links render as a Website button (the database already enforces this). */
export function safeWebsite(url: string | null): string | null {
  if (!url) return null;
  try {
    if (!checkEventUrl(url).ok) return null; // the same rules as the database (shorteners, IPs, ports, userinfo)
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/** Town for a list row: the address segment before the state, e.g. "Tahoe City". */
export function townOf(address: string): string {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  // "10046 Church St, Truckee, CA 96161, USA" -> "Truckee"; "Heritage Plaza, Tahoe City, CA" -> "Tahoe City"
  const stateAt = parts.findIndex((p, i) => i > 0 && /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(p));
  if (stateAt > 0) return parts[stateAt - 1];
  return parts[1];
}
