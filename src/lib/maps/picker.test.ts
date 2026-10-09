import { describe, expect, it } from 'vitest';
import { eventBounds } from '@/lib/data/events';
import type { Region } from '@/lib/data/types';
import { EVENT_PLACE_TYPES, pinMapOptions, placeTypeAllowed } from './picker';

const truckee = {
  id: 'r', slug: 'truckee', name: 'Truckee', minLat: 39.2, maxLat: 39.4, minLng: -120.3, maxLng: -120.0, centerLat: 39.33, centerLng: -120.18,
  defaultZoom: 13, timezone: 'America/Los_Angeles', countryCode: 'US',
} as unknown as Region;
const start = { lat: 39.33, lng: -120.18 };

describe('pin-confirm map configuration', () => {
  it('houses keep region +0.05 deg on every side', () => {
    const r = pinMapOptions(truckee, 'halloween', start).restriction.latLngBounds;
    expect(r.east).toBeCloseTo(-119.95, 6);
    expect(r.west).toBeCloseTo(-120.35, 6);
    expect(r.north).toBeCloseTo(39.45, 6);
    expect(r.south).toBeCloseTo(39.15, 6);
  });
  it('events use eventBounds exactly (east edge +0.10, no second 0.05 pad)', () => {
    const b = eventBounds(truckee);
    const o = pinMapOptions(truckee, 'halloween', start, b);
    expect(o.restriction.latLngBounds).toEqual({ north: b.maxLat, south: b.minLat, east: b.maxLng, west: b.minLng });
    expect(o.restriction.latLngBounds.east).toBeCloseTo(-119.9, 6);
    expect(o.restriction.strictBounds).toBe(false);
    expect(o.center).toEqual(start);
  });
});

describe('event place types', () => {
  it('accepts venues, parks, plazas and street addresses', () => {
    for (const t of ['street_address', 'premise', 'subpremise', 'establishment', 'park', 'point_of_interest', 'tourist_attraction']) {
      expect(placeTypeAllowed([t, 'political'], EVENT_PLACE_TYPES)).toBe(true);
    }
    expect(placeTypeAllowed(['restaurant', 'establishment', 'food'], EVENT_PLACE_TYPES)).toBe(true);
  });
  it('rejects a town, a bare road and an empty list', () => {
    expect(placeTypeAllowed(['locality', 'political'], EVENT_PLACE_TYPES)).toBe(false);
    expect(placeTypeAllowed(['route'], EVENT_PLACE_TYPES)).toBe(false);
    expect(placeTypeAllowed([], EVENT_PLACE_TYPES)).toBe(false);
  });
  it('no allowlist (houses) accepts anything', () => {
    expect(placeTypeAllowed(['locality'], undefined)).toBe(true);
  });
});
