// Client checks for the event form. UX only: submit_event re-validates everything in the database.
import type { EventInput, Region } from '@/lib/data/types';
import { inEventBounds } from '@/lib/data/events';
import { checkEventUrl, eventUrlMessage } from '@/lib/data/eventUrl';
import { DAY_MS, HOUR_MS, localDate, toUtc } from '@/lib/time/pacific';

export interface EventDraft {
  title: string;
  startDate: string; // YYYY-MM-DD (from <input type=date>)
  startTime: string; // HH:MM
  endDate: string; // '' = same day as the start
  endTime: string; // '' = no end time
  venue: string;
  address: string;
  place: { placeId: string | null; lat: number; lng: number } | null;
  description: string;
  url: string;
  adultsOnly: boolean;
  /** Hidden field people never see. Filled = a bot: fake success and skip the call. */
  honeypot: string;
}

/** A pick whose place type is refused must not leave the earlier valid location armed: drop the place and its address. */
export function clearRejectedPlace(d: EventDraft): EventDraft {
  return { ...d, place: null, address: '' };
}
export const REJECTED_PLACE_ERROR = 'Pick a venue, park, plaza or street address, or drop a pin on the map.';

export const emptyDraft: EventDraft = {
  title: '',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  venue: '',
  address: '',
  place: null,
  description: '',
  url: '',
  adultsOnly: false,
  honeypot: '',
};

export type Field = 'title' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'location' | 'address' | 'venue' | 'description' | 'url';
export type FieldErrors = Partial<Record<Field, string>>;

/** Order the fields appear in, so focus goes to the first problem. */
export const FIELD_ORDER: readonly Field[] = ['title', 'startDate', 'startTime', 'endTime', 'endDate', 'location', 'address', 'venue', 'description', 'url'];

const ADDRESS_CHARS = /^[A-Za-z0-9 ,.#'/-]+$/; // the house address character class (validate_event_address)
const ANGLE = /[<>]/;
const SUBMIT_AHEAD_MS = 120 * DAY_MS;
const MAX_LENGTH_MS = 31 * DAY_MS;

/** Earliest date the start-date input offers: the region-local date of (now - 1 h), matching the server's grace. */
export function earliestStartDate(now: number, tz: string): string {
  return localDate(now - HOUR_MS, tz);
}

export const collapse = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Mirror of private.valid_event_url (shared function). Returns an error message, or null when the URL looks fine. */
export function urlProblem(raw: string): string | null {
  const r = checkEventUrl(raw.trim());
  return r.ok ? null : eventUrlMessage(r.problem);
}

export interface Checked {
  errors: FieldErrors;
  /** Set when the end time is before the start on the same date: the form shows the end-date field. */
  askEndDate: boolean;
  input: EventInput | null;
}

export function checkDraft(d: EventDraft, region: Region, now: number): Checked {
  const errors: FieldErrors = {};
  let askEndDate = false;

  const title = collapse(d.title);
  if (title.length < 3 || title.length > 80) errors.title = 'Use 3 to 80 characters.';
  else if (ANGLE.test(title)) errors.title = 'Remove the < and > characters.';

  const description = d.description.trim();
  if (description.length < 10 || description.length > 600) errors.description = 'Use 10 to 600 characters.';
  else if (ANGLE.test(description)) errors.description = 'Remove the < and > characters.';
  else if ((description.match(/\n/g) ?? []).length > 6) errors.description = 'Use 6 line breaks at most.';

  const venue = collapse(d.venue);
  if (venue.length > 80) errors.venue = 'Use 80 characters at most.';
  else if (ANGLE.test(venue)) errors.venue = 'Remove the < and > characters.';

  if (!d.place) errors.location = 'Search for the place, or drop a pin on the map.';
  else if (!inEventBounds(region, d.place.lat, d.place.lng)) errors.location = `That spot is outside the ${region.name} area.`;
  const address = collapse(d.address);
  if (d.place) {
    if (address.length < 5 || address.length > 120) errors.address = 'The address must be 5 to 120 characters.';
    else if (!ADDRESS_CHARS.test(address)) errors.address = 'Use only letters, numbers, and , . # \' / - in the address.';
  }

  const url = d.url.trim();
  if (url) {
    const p = urlProblem(url);
    if (p) errors.url = p;
  }

  let startsAt: string | null = null;
  if (!d.startDate) errors.startDate = 'Pick a date.';
  if (!d.startTime) errors.startTime = 'Pick a start time.';
  if (d.startDate && d.startTime) {
    const s = toUtc(d.startDate, d.startTime, region.timezone);
    if (s === 'dst_gap') errors.startTime = 'That time is skipped when the clocks change. Pick another.';
    else {
      const t = Date.parse(s);
      if (t < now - HOUR_MS) errors.startDate = 'Pick a time that hasn’t passed.';
      else if (t > now + SUBMIT_AHEAD_MS) errors.startDate = 'Pick a date within the next 120 days.';
      else startsAt = s;
    }
  }

  let endsAt: string | null = null;
  if (d.endDate && !d.endTime) errors.endTime = 'Add an end time, or clear the end date.';
  if (d.endTime && d.startDate && d.startTime) {
    if (!d.endDate && d.endTime <= d.startTime) {
      errors.endTime = 'Ends the next day? Set the end date.';
      askEndDate = true;
    } else {
      const e = toUtc(d.endDate || d.startDate, d.endTime, region.timezone);
      if (e === 'dst_gap') errors.endTime = 'That time is skipped when the clocks change. Pick another.';
      else if (startsAt) {
        const span = Date.parse(e) - Date.parse(startsAt);
        if (span <= 0) {
          errors.endTime = 'The end must be after the start.';
          askEndDate = true;
        } else if (span > MAX_LENGTH_MS) errors.endDate = 'Events can run 31 days at most.';
        else endsAt = e;
      }
    }
  }

  const ok = Object.keys(errors).length === 0 && startsAt && d.place;
  return {
    errors,
    askEndDate,
    input: ok
      ? {
          title,
          description,
          venue: venue || null,
          address,
          placeId: d.place!.placeId,
          lat: d.place!.lat,
          lng: d.place!.lng,
          startsAt: startsAt!,
          endsAt,
          url: url || null,
          adultsOnly: d.adultsOnly,
        }
      : null,
  };
}

/** A filled honeypot means a bot: the form shows the normal thanks and never calls the server. */
export function isBot(d: Pick<EventDraft, 'honeypot'>): boolean {
  return d.honeypot.trim() !== '';
}
