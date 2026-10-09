import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startClock } from './useClock';

function fakeDoc() {
  const handlers = new Set<() => void>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, h: () => void) => handlers.add(h),
    removeEventListener: (_: string, h: () => void) => handlers.delete(h),
    fire: () => handlers.forEach((h) => h()),
    handlers,
  };
}

describe('startClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T20:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('ticks with the current time every interval', () => {
    const seen: number[] = [];
    const stop = startClock((n) => seen.push(n), 60_000, fakeDoc() as never);
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);
    expect(seen).toEqual([Date.parse('2026-10-30T20:01:00Z'), Date.parse('2026-10-30T20:02:00Z')]);
    stop();
  });

  it('ticks when the tab becomes visible, not when it is hidden', () => {
    const d = fakeDoc();
    const seen: number[] = [];
    const stop = startClock((n) => seen.push(n), 60_000, d as never);
    d.visibilityState = 'hidden';
    d.fire();
    expect(seen).toEqual([]);
    vi.setSystemTime(new Date('2026-10-31T08:00:00Z'));
    d.visibilityState = 'visible';
    d.fire();
    expect(seen).toEqual([Date.parse('2026-10-31T08:00:00Z')]);
    stop();
  });

  it('cleanup stops the timer and removes the listener', () => {
    const d = fakeDoc();
    const seen: number[] = [];
    startClock((n) => seen.push(n), 60_000, d as never)();
    vi.advanceTimersByTime(180_000);
    expect(seen).toEqual([]);
    expect(d.handlers.size).toBe(0);
  });
});
