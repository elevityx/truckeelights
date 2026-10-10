import { describe, expect, it } from 'vitest';
import { formatDistance, haversine } from './geo';

describe('haversine', () => {
  it('is zero for the same point and symmetric', () => {
    const a = { lat: 39.3279, lng: -120.1833 };
    const b = { lat: 39.3338, lng: -120.1802 };
    expect(haversine(a, a)).toBe(0);
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 9);
  });
  it('matches known distances', () => {
    // One degree of latitude is about 111.2 km.
    expect(haversine({ lat: 39, lng: -120 }, { lat: 40, lng: -120 })).toBeGreaterThan(111_000);
    expect(haversine({ lat: 39, lng: -120 }, { lat: 40, lng: -120 })).toBeLessThan(111_400);
    // Downtown Truckee to Reno is roughly 50 km in a straight line.
    const d = haversine({ lat: 39.3279, lng: -120.1833 }, { lat: 39.5296, lng: -119.8138 });
    expect(d).toBeGreaterThan(38_000);
    expect(d).toBeLessThan(42_000);
  });
});

describe('formatDistance', () => {
  it('uses feet under a tenth of a mile, else miles', () => {
    expect(formatDistance(10)).toBe('50 ft');
    expect(formatDistance(100)).toBe('350 ft');
    expect(formatDistance(800)).toBe('0.5 mi');
    expect(formatDistance(40_000)).toBe('25 mi');
  });
});
