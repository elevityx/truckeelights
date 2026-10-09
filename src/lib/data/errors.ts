import { DataError, type DataErrorCode } from './types';

const CODES: readonly string[] = [
  'not_signed_in', 'region_not_found', 'submissions_closed', 'invalid_place_id', 'invalid_address',
  'invalid_coordinates', 'out_of_bounds', 'rate_limited', 'forbidden', 'not_found', 'house_released',
  'must_be_hidden', 'invalid_input', 'photo_expired', 'upload_missing', 'not_pending', 'not_approved',
  'invalid_image', 'photos_closed', 'captcha_failed', 'auth_failed', 'network', 'unknown',
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
    case 'captcha_failed':
      return "The bot check didn't go through. Try it again.";
    case 'network':
      return "Can't reach the server. Check your connection.";
    default:
      return 'Something went wrong. Try again.';
  }
}
