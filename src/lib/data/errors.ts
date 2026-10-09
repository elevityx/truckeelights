import { DataError, type DataErrorCode } from './types';

const CODES: readonly string[] = [
  'not_signed_in', 'region_not_found', 'submissions_closed', 'invalid_place_id', 'invalid_address',
  'invalid_coordinates', 'out_of_bounds', 'rate_limited', 'forbidden', 'not_found', 'house_released',
  'must_be_hidden', 'invalid_input', 'photo_expired', 'upload_missing', 'not_pending', 'not_approved',
  'invalid_image', 'photos_closed', 'votes_closed', 'queue_full', 'exists', 'already_owned', 'claim_pending',
  'token_invalid', 'token_expired', 'captcha_failed', 'auth_failed',
  'network', 'unknown',
] satisfies DataErrorCode[];

function isAuthError(e: object): boolean {
  const name = (e as { name?: unknown }).name;
  return typeof name === 'string' && name.startsWith('Auth');
}

/** Map PostgREST / Auth / fetch errors to a DataError. */
export function toDataError(e: unknown): DataError {
  if (e instanceof DataError) return e;
  if (e instanceof TypeError) return new DataError('network');
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown };
    const message = typeof o.message === 'string' ? o.message : '';
    const detail = typeof o.details === 'string' && o.details !== '' ? o.details : undefined;
    if (CODES.includes(message)) return new DataError(message as DataErrorCode, detail);
    if (isAuthError(e) || 'status' in e) {
      if (message.toLowerCase().includes('captcha')) return new DataError('captcha_failed');
      if (isAuthError(e)) return new DataError('auth_failed');
    }
    if (message.toLowerCase().includes('captcha')) return new DataError('captcha_failed');
  }
  return new DataError('unknown');
}

export function userMessage(e: DataError, regionName = 'this'): string {
  switch (e.code) {
    case 'rate_limited':
      return 'Slow down a little and try again later.';
    case 'out_of_bounds':
      return `That spot is outside the ${regionName} map area.`;
    case 'invalid_address':
      return 'Use a street address that starts with a house number.';
    case 'submissions_closed':
      return 'Adding houses opens soon.';
    case 'photo_expired':
    case 'upload_missing':
      return 'That upload took too long. Try again.';
    case 'invalid_image':
      return "That photo couldn't be read. Try a different one.";
    case 'photos_closed':
      return 'Adding photos opens soon.';
    case 'not_pending':
    case 'not_approved':
      return 'Someone already handled this photo. Refresh the list.';
    case 'votes_closed':
      return 'Voting opens soon.';
    case 'queue_full':
      return "We're catching up on reviews — try again later.";
    case 'exists':
      return 'Looks like this event is already listed.';
    case 'captcha_failed':
      return "The bot check didn't go through. Try it again.";
    case 'network':
      return "Can't reach the server. Check your connection.";
    case 'not_signed_in':
      return 'Sign in with your email to continue.';
    case 'already_owned':
      return 'That house is already managed by an account.';
    case 'claim_pending':
      return 'You already have a request waiting for review.';
    case 'token_invalid':
      return "That link isn't valid anymore. Use the newest email from us.";
    case 'token_expired':
      return 'That link has expired. Use the newest email from us.';
    default:
      return 'Something went wrong. Try again.';
  }
}

const EVENT_FIELD_COPY: Record<string, string> = {
  title: 'Give the event a title of 3 to 80 characters, without < or >.',
  description: 'Describe the event in 10 to 600 characters (up to 6 line breaks, no < or >).',
  venue: 'Keep the venue name under 80 characters, without < or >.',
  address: 'Use a place name or street address (5 to 120 letters, numbers, and basic punctuation).',
  place_id: 'Pick the location again from the suggestions.',
  coordinates: 'Pick a location on the map.',
  starts_at: 'Pick a start time from now up to 120 days ahead.',
  ends_at: 'The end must be after the start and within 31 days of it.',
  url: 'Use a full https:// website link (no short links, IP addresses, or ports).',
  source_url: 'Use a full https:// source link (no short links, IP addresses, or ports).',
  adults_only: 'Choose whether the event is adults only.',
  transition: 'Someone already changed this event. Refresh the list.',
  reason: 'Keep the reason under 200 characters.',
};

/** Event-specific copy (Spec_Events A8). Falls back to userMessage for shared codes. */
export function eventUserMessage(e: DataError, regionName = 'this'): string {
  switch (e.code) {
    case 'rate_limited':
      if (e.detail === 'uid_hourly') return "You've added a few events already. Try again in an hour.";
      if (e.detail === 'uid_daily') return "That's the daily limit for adding events. Try again tomorrow.";
      if (e.detail === 'region_breaker') return 'Lots of events are coming in right now. Try again in a few minutes.';
      return 'Slow down a little and try again later.';
    case 'queue_full':
      return "We're catching up on reviews — try again later.";
    case 'submissions_closed':
      return 'Event submissions open soon.';
    case 'out_of_bounds':
      return `That spot is outside the ${regionName} events area.`;
    case 'exists':
      return 'Looks like this event is already listed.';
    case 'invalid_address':
      return 'Check the address: 5 to 120 characters.';
    case 'invalid_input':
      return (e.detail && EVENT_FIELD_COPY[e.detail]) || 'Check the event details and try again.';
    default:
      return userMessage(e, regionName);
  }
}
