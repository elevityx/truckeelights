import { describe, expect, it } from 'vitest';
import { eventBounds, inBounds } from './eventBounds';

// The Truckee region row (public, from the truckee_data migration).
const truckee = { minLat: 39.15, maxLat: 39.45, minLng: -120.42, maxLng: -119.98 };

describe('eventBounds', () => {
  const b = eventBounds(truckee);
  it('pads 0.05° and 0.10° east', () => {
    expect(b.south).toBeCloseTo(39.1);
    expect(b.north).toBeCloseTo(39.5);
    expect(b.west).toBeCloseTo(-120.47);
    expect(b.east).toBeCloseTo(-119.88);
  });
  it('takes the north shore and leaves out Reno', () => {
    expect(inBounds(b, { lat: 39.328, lng: -120.183 })).toBe(true); // Truckee
    expect(inBounds(b, { lat: 39.17, lng: -120.141 })).toBe(true); // Tahoe City
    expect(inBounds(b, { lat: 39.198, lng: -119.93 })).toBe(true); // Sand Harbor
    expect(inBounds(b, { lat: 39.227, lng: -120.004 })).toBe(true); // Crystal Bay
    expect(inBounds(b, { lat: 39.529, lng: -119.813 })).toBe(false); // Reno
  });
  it('rejects NaN', () => {
    expect(inBounds(b, { lat: NaN, lng: -120.1 })).toBe(false);
  });
});
