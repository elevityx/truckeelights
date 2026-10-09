import { describe, expect, it } from 'vitest';
import type { StorageJob } from '@/lib/data/types';
import {
  bannerText, relativeAge, settleCleanup, stuckJobs, switchChecked, switchDisabled, switchFromOpen, switchStatusText, switchTarget,
  type PhotosSwitch,
} from './photosState';

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

describe('photos kill-switch state', () => {
  const unknowns: PhotosSwitch[] = [{ kind: 'loading' }, { kind: 'unknown' }];
  it('never reports OFF until the server said so', () => {
    for (const u of unknowns) {
      expect(switchChecked(u)).toBeUndefined();
      expect(switchStatusText(u)).not.toBe('Off');
      expect(switchDisabled(u, false)).toBe(true);
      expect(switchTarget(u)).toBeNull();
    }
  });
  it('mirrors the server value and toggles to the opposite', () => {
    expect(switchChecked(switchFromOpen(true))).toBe(true);
    expect(switchChecked(switchFromOpen(false))).toBe(false);
    expect(switchStatusText(switchFromOpen(true))).toBe('On');
    expect(switchTarget(switchFromOpen(true))).toBe(false);
    expect(switchTarget(switchFromOpen(false))).toBe(true);
    expect(switchDisabled(switchFromOpen(true), false)).toBe(false);
  });
  it('is disabled while a change is in flight', () => {
    expect(switchDisabled(switchFromOpen(true), true)).toBe(true);
  });
  it('ON survives leave-and-return because state is reloaded, not defaulted', () => {
    // a fresh mount starts at loading (not off), then takes the server's value
    const mount: PhotosSwitch = { kind: 'loading' };
    expect(switchChecked(mount)).toBeUndefined();
    expect(switchChecked(switchFromOpen(true))).toBe(true);
  });
});

describe('settleCleanup', () => {
  it('is clean only when no jobs remain open', async () => {
    expect(await settleCleanup(async () => ({ open: 0 }))).toEqual({ pending: false });
  });
  it('is pending when jobs stay open', async () => {
    expect(await settleCleanup(async () => ({ open: 2 }))).toEqual({ pending: true });
  });
  it('is pending when the runner throws', async () => {
    expect(await settleCleanup(async () => { throw new Error('storage down'); })).toEqual({ pending: true });
  });
  it('is pending on a malformed result', async () => {
    expect(await settleCleanup((async () => ({})) as never)).toEqual({ pending: true });
  });
});
