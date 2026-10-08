import { describe, expect, it } from 'vitest';
import type { StorageJob } from '@/lib/data/types';
import { bannerText, relativeAge, stuckJobs } from './photosState';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const job = (kind: StorageJob['kind'], ageS: number): StorageJob => ({
  id: 1, kind, bucket: 'photos', objectName: 'a', newObjectName: null, attempts: 0, lastError: null,
  createdAt: new Date(NOW - ageS * 1000).toISOString(),
});

describe('stuckJobs', () => {
  it('revocation kinds are stuck after 60 s', () => {
    expect(stuckJobs([job('delete_public', 59), job('rotate_public', 59)], NOW)).toHaveLength(0);
    expect(stuckJobs([job('delete_public', 61), job('rotate_public', 61)], NOW)).toHaveLength(2);
  });
  it('upload deletes are stuck after 2 minutes', () => {
    expect(stuckJobs([job('delete_upload', 100)], NOW)).toHaveLength(0);
    expect(stuckJobs([job('delete_upload', 121)], NOW)).toHaveLength(1);
  });
  it('bad timestamps fail visible', () => {
    expect(stuckJobs([{ ...job('delete_upload', 0), createdAt: 'nope' }], NOW)).toHaveLength(1);
  });
  it('banner copy', () => {
    expect(bannerText(2)).toContain('2 photo cleanup tasks are stuck');
    expect(bannerText(1)).toContain('1 photo cleanup task is stuck');
  });
});

describe('relativeAge', () => {
  it('formats', () => {
    expect(relativeAge(new Date(NOW - 5_000).toISOString(), NOW)).toBe('just now');
    expect(relativeAge(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 hours ago');
  });
});
