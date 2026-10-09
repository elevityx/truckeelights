import { describe, expect, it } from 'vitest';
import { DataError, type DataErrorCode } from '@/lib/data/types';
import { ALREADY_LISTED, QUEUE_FULL, eventErrorCopy } from './messages';

const copy = (code: string, detail?: string) => eventErrorCopy(new DataError(code as DataErrorCode, detail), 'Truckee');

describe('eventErrorCopy', () => {
  it('has copy for each rate limit', () => {
    expect(copy('rate_limited', 'uid_hourly').message).toMatch(/hour/);
    expect(copy('rate_limited', 'uid_daily').message).toMatch(/daily limit/);
    expect(copy('rate_limited', 'region_breaker').message).toMatch(/few minutes/);
  });
  it('covers queue_full, submissions_closed, out_of_bounds and exists', () => {
    expect(copy('queue_full').message).toBe(QUEUE_FULL);
    expect(copy('submissions_closed').message).toBe('Event submissions open soon.');
    expect(copy('out_of_bounds')).toEqual({ message: 'That spot is outside the Truckee events area.', field: 'location' });
    expect(copy('exists').message).toBe(ALREADY_LISTED);
  });
  it('points invalid_input at its field', () => {
    expect(copy('invalid_input', 'title').field).toBe('title');
    expect(copy('invalid_input', 'starts_at').field).toBe('startDate');
    expect(copy('invalid_input', 'ends_at').field).toBe('endTime');
    expect(copy('invalid_input', 'lat').field).toBe('location');
    expect(copy('invalid_input', 'url').field).toBe('url');
    expect(copy('invalid_input', 'mystery').field).toBeUndefined();
  });
  it('falls back to the shared copy', () => {
    expect(copy('network').message).toMatch(/connection/);
    expect(copy('captcha_failed').message).toMatch(/bot check/);
  });
});
