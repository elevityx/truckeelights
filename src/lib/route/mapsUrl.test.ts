import { describe, expect, it } from 'vitest';
import { directionsUrl, legUrls, splitLegs, waypointsPerLeg } from './mapsUrl';

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 39.3 + i / 1000, lng: -120.18 - i / 1000 }));
const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('waypointsPerLeg', () => {
  it('is 3 on phones (coarse pointer or narrow) and 9 on desktop', () => {
    expect(waypointsPerLeg({ coarse: true, width: 1280 })).toBe(3);
    expect(waypointsPerLeg({ coarse: false, width: 390 })).toBe(3);
    expect(waypointsPerLeg({ coarse: false, width: 767 })).toBe(3);
    expect(waypointsPerLeg({ coarse: false, width: 768 })).toBe(9);
  });
});

describe('splitLegs', () => {
  const sizes = (n: number, per: number) => splitLegs(ids(n), per).map((l) => l.stops.length);

  it('works for 1, 4, 10 and 25 stops on phones', () => {
    expect(sizes(1, 3)).toEqual([1]);
    expect(sizes(4, 3)).toEqual([4]);
    expect(sizes(10, 3)).toEqual([4, 4, 2]);
    expect(sizes(25, 3)).toEqual([4, 4, 4, 4, 4, 4, 1]);
  });

  it('works for 1, 4, 10 and 25 stops on desktop', () => {
    expect(sizes(1, 9)).toEqual([1]);
    expect(sizes(4, 9)).toEqual([4]);
    expect(sizes(10, 9)).toEqual([10]);
    expect(sizes(25, 9)).toEqual([10, 10, 5]);
  });

  it('chains legs: each starts at the previous leg’s last stop, and every stop appears once', () => {
    for (const per of [3, 9]) {
      for (const n of [1, 4, 10, 25]) {
        const legs = splitLegs(ids(n), per);
        expect(legs[0].from).toBeNull();
        for (let i = 1; i < legs.length; i++) expect(legs[i].from).toBe(legs[i - 1].stops.at(-1));
        expect(legs.flatMap((l) => l.stops)).toEqual(ids(n));
        for (const l of legs) expect(l.stops.length - 1).toBeLessThanOrEqual(per); // waypoints within the limit
      }
    }
  });

  it('handles an empty route', () => {
    expect(splitLegs([], 3)).toEqual([]);
  });
});

describe('directionsUrl', () => {
  it('builds origin, destination, pipe-separated waypoints and the travel mode', () => {
    const u = new URL(directionsUrl({ lat: 39.327, lng: -120.183 }, pts(3), 'walking'));
    expect(u.origin + u.pathname).toBe('https://www.google.com/maps/dir/');
    expect(u.searchParams.get('api')).toBe('1');
    expect(u.searchParams.get('origin')).toBe('39.327000,-120.183000');
    expect(u.searchParams.get('destination')).toBe('39.302000,-120.182000');
    expect(u.searchParams.get('waypoints')).toBe('39.300000,-120.180000|39.301000,-120.181000');
    expect(u.searchParams.get('travelmode')).toBe('walking');
  });

  it('escapes the separators and the My Location origin', () => {
    const s = directionsUrl('my-location', pts(2), 'driving');
    expect(s).toContain('origin=My+Location');
    expect(s).toContain('waypoints=39.300000%2C-120.180000');
    expect(s).toContain('destination=39.301000%2C-120.181000');
    expect(s).not.toMatch(/[ |]/);
    expect(new URL(s).searchParams.get('origin')).toBe('My Location');
  });

  it('leaves out origin when the location is unknown, and waypoints for a single stop', () => {
    const u = new URL(directionsUrl(null, pts(1), 'driving'));
    expect(u.searchParams.has('origin')).toBe(false);
    expect(u.searchParams.has('waypoints')).toBe(false);
    expect(u.searchParams.get('destination')).toBe('39.300000,-120.180000');
  });
});

describe('legUrls', () => {
  it('starts leg 1 at the origin and later legs at the previous leg’s last stop', () => {
    const p = pts(10);
    const urls = legUrls(p, 3, null, 'walking').map((s) => new URL(s).searchParams);
    expect(urls).toHaveLength(3);
    expect(urls[0].has('origin')).toBe(false);
    expect(urls[0].get('destination')).toBe('39.303000,-120.183000');
    expect(urls[1].get('origin')).toBe(urls[0].get('destination'));
    expect(urls[2].get('origin')).toBe(urls[1].get('destination'));
    expect(urls[2].get('waypoints')).toBe('39.308000,-120.188000');
    expect(urls[2].get('destination')).toBe('39.309000,-120.189000');
  });
});
