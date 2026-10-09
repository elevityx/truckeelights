import { describe, expect, it } from 'vitest';
import {
  MAX_STOPS,
  cleanStops,
  droppedToast,
  loadStops,
  moveStop,
  nearbyHouses,
  parseRouteParam,
  pruneStops,
  routeKey,
  routeShareUrl,
  saveStops,
  shareDecision,
  toggleStop,
  type Stop,
} from './stops';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number): Stop => ({ kind: 'house', id: uid(n) });
const E = (n: number): Stop => ({ kind: 'event', id: uid(n) });

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}
const throwing = () => {
  throw new Error('SecurityError');
};
const throwingMethods = () => ({ getItem: throwing, setItem: throwing, removeItem: throwing });

describe('storage', () => {
  it('keys by season and year', () => {
    expect(routeKey('halloween', 2026)).toBe('tl:route:halloween-2026');
    expect(routeKey('christmas', 2026)).toBe('tl:route:christmas-2026');
  });

  it('round-trips through storage', () => {
    const s = memStore();
    saveStops('k', [H(1), E(2)], () => s);
    expect(loadStops('k', () => s)).toEqual([H(1), E(2)]);
    saveStops('k', [], () => s);
    expect(s.m.has('k')).toBe(false);
  });

  it('survives a throwing or missing localStorage', () => {
    expect(loadStops('k', throwing)).toEqual([]);
    expect(loadStops('k', throwingMethods)).toEqual([]);
    expect(loadStops('k', () => null)).toEqual([]);
    expect(() => saveStops('k', [H(1)], throwing)).not.toThrow();
    expect(() => saveStops('k', [H(1)], throwingMethods)).not.toThrow();
  });

  it('ignores junk and caps at 25 stops', () => {
    expect(loadStops('k', () => memStore({ k: 'not json' }))).toEqual([]);
    expect(loadStops('k', () => memStore({ k: '{"a":1}' }))).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => H(i));
    const s = memStore({ k: JSON.stringify([{ kind: 'x', id: uid(1) }, { kind: 'house', id: 'nope' }, ...many]) });
    const got = loadStops('k', () => s);
    expect(got).toHaveLength(MAX_STOPS);
    expect(got[0]).toEqual(H(0));
  });

  it('drops duplicates', () => {
    expect(cleanStops([H(1), H(1), E(1), { kind: 'house', id: uid(1).toUpperCase() }])).toEqual([H(1), E(1)]);
  });
});

describe('editing', () => {
  it('toggles and stops at the cap', () => {
    expect(toggleStop([], H(1))).toEqual({ stops: [H(1)], result: 'added' });
    expect(toggleStop([H(1), E(2)], H(1))).toEqual({ stops: [E(2)], result: 'removed' });
    const full = Array.from({ length: MAX_STOPS }, (_, i) => H(i));
    expect(toggleStop(full, H(99)).result).toBe('full');
    expect(toggleStop(full, H(3)).result).toBe('removed');
  });

  it('moves up and down within bounds', () => {
    expect(moveStop([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveStop([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    expect(moveStop([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveStop([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});

describe('dropping stale stops', () => {
  it('keeps only stops still on the map', () => {
    const live = { houses: new Set([uid(1), uid(3)]), events: new Set([uid(2)]) };
    expect(pruneStops([H(1), H(2), E(2), E(3), H(3)], live)).toEqual({ stops: [H(1), E(2), H(3)], dropped: 2 });
    expect(pruneStops([], live)).toEqual({ stops: [], dropped: 0 });
  });
  it('words the toast', () => {
    expect(droppedToast(1)).toBe('1 stop is no longer on the map');
    expect(droppedToast(3)).toBe('3 stops are no longer on the map');
  });
});

describe('share link', () => {
  it('builds a readable link on the site', () => {
    expect(routeShareUrl('https://truckeelights.com/', [H(1), E(2)])).toBe(
      `https://truckeelights.com/?route=house:${uid(1)},event:${uid(2)}`,
    );
    expect(routeShareUrl(undefined, [H(1)])).toBe(`https://truckeelights.com/?route=house:${uid(1)}`);
  });

  it('parses its own link back, through URL decoding', () => {
    const url = new URL(routeShareUrl('https://truckeelights.com', [H(1), E(2), H(3)]));
    expect(parseRouteParam(url.searchParams.get('route'))).toEqual([H(1), E(2), H(3)]);
  });

  it('validates: junk entries skipped, duplicates dropped, capped, null when absent', () => {
    expect(parseRouteParam(null)).toBeNull();
    expect(parseRouteParam('')).toEqual([]);
    expect(parseRouteParam(`house:${uid(1)},house:${uid(1)},bogus,event:<script>,party:${uid(2)},event:${uid(2)}`)).toEqual([H(1), E(2)]);
    const long = Array.from({ length: 30 }, (_, i) => `house:${uid(i)}`).join(',');
    expect(parseRouteParam(long)).toHaveLength(MAX_STOPS);
  });

  it('decides whether to load, open, or ask before replacing', () => {
    expect(shareDecision([], [H(1)])).toBe('load');
    expect(shareDecision([H(1)], [])).toBe('none');
    expect(shareDecision([H(1), E(2)], [H(1), E(2)])).toBe('same');
    expect(shareDecision([H(1), E(2)], [E(2), H(1)])).toBe('ask');
    expect(shareDecision([H(1)], [H(1), H(2)])).toBe('ask');
  });
});

describe('nearbyHouses', () => {
  const at = (n: number, dLat: number) => ({ id: uid(n), lat: 39.33 + dLat, lng: -120.18 });
  const center = { lat: 39.33, lng: -120.18 };
  it('takes the closest within 1 km, skipping ones already in the route, at most 8', () => {
    const houses = [at(1, 0.005), at(2, 0.001), at(3, 0.02), at(4, 0.003), ...Array.from({ length: 10 }, (_, i) => at(10 + i, 0.0001 * (i + 1)))];
    const got = nearbyHouses(houses, center, new Set([uid(10)]));
    expect(got).toHaveLength(8);
    expect(got.map((h) => h.id)).not.toContain(uid(10));
    expect(got.map((h) => h.id)).not.toContain(uid(3)); // about 2.2 km away
    expect(got[0].id).toBe(uid(11));
    const few = nearbyHouses([at(1, 0.005), at(2, 0.001), at(3, 0.02)], center, new Set());
    expect(few.map((h) => h.id)).toEqual([uid(2), uid(1)]);
  });
});
