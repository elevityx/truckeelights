// Event-specific copy for server codes (A8). Unknown codes fall back to the shared userMessage.
import { eventUserMessage } from '@/lib/data/errors';
import type { DataError } from '@/lib/data/types';
import type { Field } from './eventForm';

export const THANKS = 'Thanks! Your event will appear after a quick review.';
export const ALREADY_LISTED = 'Looks like this event is already listed.';
export const QUEUE_FULL = "We're catching up on reviews — try again later.";

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

export interface EventErrorCopy {
  message: string;
  field?: Field;
}

/** Message text comes from `eventUserMessage` (errors.ts); this adds which form field to mark. */
export function eventErrorCopy(e: DataError, regionName: string): EventErrorCopy {
  const message = eventUserMessage(e, regionName);
  const code: string = e.code;
  if (code === 'out_of_bounds') return { message, field: 'location' };
  if (code === 'invalid_address') return { message, field: 'address' };
  if (code === 'invalid_input' && e.detail && FIELD_OF[e.detail]) return { message, field: FIELD_OF[e.detail] };
  return { message };
}
