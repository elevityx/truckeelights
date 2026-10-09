// Event-specific copy for server codes (A8). Unknown codes fall back to the shared userMessage.
import { userMessage, type DataError } from '@/lib/data';
import type { Field } from './eventForm';

export const THANKS = 'Thanks! Your event will appear after a quick review.';
export const ALREADY_LISTED = 'Looks like this event is already listed.';
export const QUEUE_FULL = 'We’re catching up on reviews — try again later.';

/** invalid_input detail (a column name) -> the form field to mark. */
const FIELD_OF: Record<string, Field> = {
  title: 'title',
  description: 'description',
  venue: 'venue',
  address: 'address',
  place_id: 'location',
  lat: 'location',
  lng: 'location',
  starts_at: 'startDate',
  ends_at: 'endTime',
  url: 'url',
};

const FIELD_COPY: Record<Field, string> = {
  title: 'Check the title: 3 to 80 characters, no < or >.',
  description: 'Check the description: 10 to 600 characters, no < or >.',
  venue: 'Check the venue name: 80 characters at most.',
  address: 'Check the address: 5 to 120 letters, numbers and , . # \' / -',
  location: 'Pick the place again.',
  startDate: 'Check the date: from now to 120 days ahead.',
  startTime: 'Check the start time.',
  endDate: 'Check the end date.',
  endTime: 'Check the end: after the start, 31 days at most.',
  url: 'Check the website link.',
};

export interface EventErrorCopy {
  message: string;
  field?: Field;
}

export function eventErrorCopy(e: DataError, regionName: string): EventErrorCopy {
  const code: string = e.code;
  switch (code) {
    case 'rate_limited':
      if (e.detail === 'region_breaker') return { message: 'Lots of events are coming in right now. Try again in a few minutes.' };
      if (e.detail === 'uid_daily') return { message: 'That’s the most events one person can add today. Try again tomorrow.' };
      return { message: 'You’ve added a few events already. Try again in an hour.' }; // uid_hourly
    case 'queue_full':
      return { message: QUEUE_FULL };
    case 'submissions_closed':
      return { message: 'Event submissions open soon.' };
    case 'out_of_bounds':
      return { message: `That spot is outside the ${regionName} area.`, field: 'location' };
    case 'exists':
      return { message: ALREADY_LISTED };
    case 'invalid_input': {
      const field = e.detail ? FIELD_OF[e.detail] : undefined;
      return field ? { message: FIELD_COPY[field], field } : { message: 'Something in the form needs a fix. Check each field.' };
    }
    case 'invalid_address':
      return { message: FIELD_COPY.address, field: 'address' };
    default:
      return { message: userMessage(e, regionName) };
  }
}
