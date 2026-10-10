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
  appendStops,
  withHidden,
  type Stop,
} from './stops';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number): Stop => ({ kind: 'house', id: uid(n) });
const E = (n: number) => ({ kind: 'event', id: uid(n) }); // events are not route stops; only used to prove they are dropped

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
    saveStops('k', [H(1), H(2)], () => s);
    expect(loadStops('k', () => s)).toEqual([H(1), H(2)]);
    // a stored route from before houses-only drops its event stops quietly
    const old = memStore({ k: JSON.stringify([H(1), E(2), H(3)]) });
    expect(loadStops('k', () => old)).toEqual([H(1), H(3)]);
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
    expect(cleanStops([H(1), H(1), E(1), { kind: 'house', id: uid(1).toUpperCase() }])).toEqual([H(1)]);
  });
});

describe('editing', () => {
  it('toggles and stops at the cap', () => {
    expect(toggleStop([], H(1))).toEqual({ stops: [H(1)], result: 'added' });
    expect(toggleStop([H(1), H(2)], H(1))).toEqual({ stops: [H(2)], result: 'removed' });
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
    const live = { houses: new Set([uid(1), uid(3)]) };
    expect(pruneStops([H(1), H(2), H(3)], live)).toEqual({ stops: [H(1), H(3)], dropped: 1 });
    expect(pruneStops([], live)).toEqual({ stops: [], dropped: 0 });
  });
  it('words the toast', () => {
    expect(droppedToast(1)).toBe('1 stop is no longer on the map');
    expect(droppedToast(3)).toBe('3 stops are no longer on the map');
  });
});

describe('share link', () => {
  it('builds a readable link on the site', () => {
    expect(routeShareUrl('https://truckeelights.com/', [H(1), H(2)])).toBe(
      `https://truckeelights.com/?route=house:${uid(1)},house:${uid(2)}`,
    );
    expect(routeShareUrl(undefined, [H(1)])).toBe(`https://truckeelights.com/?route=house:${uid(1)}`);
  });

  it('parses its own link back, through URL decoding', () => {
    const url = new URL(routeShareUrl('https://truckeelights.com', [H(1), H(2), H(3)]));
    expect(parseRouteParam(url.searchParams.get('route'))).toEqual([H(1), H(2), H(3)]);
  });

  it('validates: junk entries skipped, duplicates dropped, capped, null when absent', () => {
    expect(parseRouteParam(null)).toBeNull();
    expect(parseRouteParam('')).toEqual([]);
    expect(parseRouteParam(`house:${uid(1)},house:${uid(1)},bogus,event:<script>,party:${uid(2)},event:${uid(2)},house:${uid(2)}`)).toEqual([H(1), H(2)]);
    expect(parseRouteParam(`event:${uid(2)}`)).toEqual([]);
    const long = Array.from({ length: 30 }, (_, i) => `house:${uid(i)}`).join(',');
    expect(parseRouteParam(long)).toHaveLength(MAX_STOPS);
  });

  it('decides whether to load, open, or ask before replacing', () => {
    expect(shareDecision([], [H(1)])).toBe('load');
    expect(shareDecision([H(1)], [])).toBe('none');
    expect(shareDecision([H(1), H(2)], [H(1), H(2)])).toBe('same');
    expect(shareDecision([H(1), H(2)], [H(2), H(1)])).toBe('ask');
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

describe('degraded loads never prune', () => {
  it('keeps every stop when houses failed to load', () => {
    expect(pruneStops([H(1), H(9)], { houses: null })).toEqual({ stops: [H(1), H(9)], dropped: 0 });
  });
  it('an empty but successful houses load still prunes', () => {
    expect(pruneStops([H(2)], { houses: new Set() })).toEqual({ stops: [], dropped: 1 });
  });
});

describe('late location answers', () => {
  it('append respects the latest route and the cap (20 stops, 5 added while pending)', () => {
    const latest = Array.from({ length: 25 }, (_, i) => H(i + 1));
    const out = appendStops(latest, [H(100), H(101)]);
    expect(out).toHaveLength(MAX_STOPS);
    expect(out).toEqual(latest);
  });
  it('append skips duplicates already added meanwhile', () => {
    expect(appendStops([H(1), H(2)], [H(2), H(3)])).toEqual([H(1), H(2), H(3)]);
  });
  it('reorder does not resurrect a stop removed meanwhile, and keeps hidden stops', () => {
    // Latest route: H1, H7 (not shown right now, so hidden), H3. H2 was removed while pending.
    const latest = [H(1), H(7), H(3)];
    expect(withHidden(latest, [H(3), H(1)])).toEqual([H(3), H(1), H(7)]);
  });
});
