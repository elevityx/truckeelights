import { describe, expect, it } from 'vitest';
import { eventUserMessage, toDataError, userMessage } from './errors';
import { DataError } from './types';

describe('toDataError', () => {
  it('maps a PostgREST message equal to a code', () => {
    expect(toDataError({ message: 'rate_limited' }).code).toBe('rate_limited');
  });
  it('maps votes_closed from PostgREST (not unknown)', () => {
    expect(toDataError({ message: 'votes_closed' }).code).toBe('votes_closed');
  });
  it('copies details into detail', () => {
    const e = toDataError({ message: 'invalid_address', details: 'characters' });
    expect(e.code).toBe('invalid_address');
    expect(e.detail).toBe('characters');
  });
  it('maps a fetch TypeError to network', () => {
    expect(toDataError(new TypeError('Failed to fetch')).code).toBe('network');
  });
  it('maps a captcha auth error to captcha_failed', () => {
    const e = Object.assign(new Error('captcha verification process failed'), { name: 'AuthApiError' });
    expect(toDataError(e).code).toBe('captcha_failed');
  });
  it('maps other auth errors to auth_failed', () => {
    const e = Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError' });
    expect(toDataError(e).code).toBe('auth_failed');
  });
  it('maps everything else to unknown', () => {
    expect(toDataError({ message: 'boom' }).code).toBe('unknown');
    expect(toDataError('x').code).toBe('unknown');
  });
  it('passes a DataError through', () => {
    const d = new DataError('forbidden');
    expect(toDataError(d)).toBe(d);
  });
});

describe('photo error codes', () => {
  it.each(['photo_expired', 'upload_missing', 'not_pending', 'not_approved', 'invalid_image', 'photos_closed'])(
    'maps a message equal to %s',
    (code) => {
      expect(toDataError({ message: code }).code).toBe(code);
    },
  );
});

describe('userMessage', () => {
  it.each([
    ['photo_expired', 'That upload took too long. Try again.'],
    ['upload_missing', 'That upload took too long. Try again.'],
    ['invalid_image', "That photo couldn't be read. Try a different one."],
    ['photos_closed', 'Adding photos opens soon.'],
    ['not_pending', 'Someone already handled this photo. Refresh the list.'],
    ['not_approved', 'Someone already handled this photo. Refresh the list.'],
  ] as const)('has copy for %s', (code, msg) => {
    expect(userMessage(new DataError(code))).toBe(msg);
  });
  it('uses the region name for out_of_bounds', () => {
    expect(userMessage(new DataError('out_of_bounds'), 'Truckee')).toBe('That spot is outside the Truckee map area.');
  });
  it('falls back to the default copy', () => {
    expect(userMessage(new DataError('unknown'))).toBe('Something went wrong. Try again.');
  });
});

// Spec_Events A8: every code the event RPCs raise maps through CODES (one test per code).
describe('event error codes', () => {
  it.each([
    'not_signed_in', 'region_not_found', 'submissions_closed', 'invalid_input', 'out_of_bounds', 'rate_limited',
    'queue_full', 'exists', 'forbidden', 'not_found',
  ])('maps a message equal to %s', (code) => {
    expect(toDataError({ message: code, details: 'x' }).code).toBe(code);
  });
  it('keeps the field name of invalid_input', () => {
    const e = toDataError({ message: 'invalid_input', details: 'starts_at' });
    expect([e.code, e.detail]).toEqual(['invalid_input', 'starts_at']);
  });
});

describe('eventUserMessage', () => {
  it.each([
    ['uid_hourly', "You've added a few events already. Try again in an hour."],
    ['uid_daily', "That's the daily limit for adding events. Try again tomorrow."],
    ['region_breaker', 'Lots of events are coming in right now. Try again in a few minutes.'],
  ])('rate_limited %s', (detail, msg) => {
    expect(eventUserMessage(new DataError('rate_limited', detail))).toBe(msg);
  });
  it.each([
    ['queue_full', "We're catching up on reviews — try again later."],
    ['submissions_closed', 'Event submissions open soon.'],
    ['exists', 'Looks like this event is already listed.'],
  ] as const)('has copy for %s', (code, msg) => {
    expect(eventUserMessage(new DataError(code))).toBe(msg);
  });
  it('uses the region name for out_of_bounds', () => {
    expect(eventUserMessage(new DataError('out_of_bounds'), 'Truckee')).toBe('That spot is outside the Truckee events area.');
  });
  it.each(['title', 'description', 'venue', 'address', 'place_id', 'coordinates', 'starts_at', 'ends_at', 'url',
    'source_url', 'adults_only', 'transition', 'reason'])('has field copy for invalid_input %s', (field) => {
    const msg = eventUserMessage(new DataError('invalid_input', field));
    expect(msg).not.toBe('Check the event details and try again.');
    expect(msg.length).toBeGreaterThan(10);
  });
  it('falls back for an unknown field and for shared codes', () => {
    expect(eventUserMessage(new DataError('invalid_input', 'nope'))).toBe('Check the event details and try again.');
    expect(eventUserMessage(new DataError('network'))).toBe(userMessage(new DataError('network')));
  });
});

// Spec_Subscribe_Accounts §6: every code the subscribe/account RPCs and functions raise maps through CODES.
describe('subscribe + account error codes', () => {
  it.each([
    'not_signed_in', 'forbidden', 'invalid_input', 'rate_limited', 'already_owned', 'claim_pending', 'token_invalid',
    'token_expired',
  ])('maps a message equal to %s', (code) => {
    expect(toDataError({ message: code }).code).toBe(code);
  });
  it.each(['already_owned', 'claim_pending', 'token_invalid', 'token_expired', 'not_signed_in'] as const)('has copy for %s', (code) => {
    expect(userMessage(new DataError(code))).not.toBe('Something went wrong. Try again.');
  });
});
