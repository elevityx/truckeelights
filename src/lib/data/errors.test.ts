import { describe, expect, it } from 'vitest';
import { toDataError, userMessage } from './errors';
import { DataError } from './types';

describe('toDataError', () => {
  it('maps a PostgREST message equal to a code', () => {
    expect(toDataError({ message: 'rate_limited' }).code).toBe('rate_limited');
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

describe('userMessage', () => {
  it('uses the region name for out_of_bounds', () => {
    expect(userMessage(new DataError('out_of_bounds'), 'Truckee')).toBe('That spot is outside the Truckee map area.');
  });
  it('falls back to the default copy', () => {
    expect(userMessage(new DataError('unknown'))).toBe('Something went wrong. Try again.');
  });
});
