import { describe, expect, it } from 'vitest';
import type { PinView, Region } from '@/lib/data/types';
import { distanceM, findNearbyDuplicate, pickStreetResult, type GeocodeCandidate } from './mapPick';

const region = {
  id: 'r',
  slug: 'truckee',
  name: 'Truckee',
  minLat: 39.25,
  maxLat: 39.4,
  minLng: -120.3,
  maxLng: -120.05,
  centerLat: 39.33,
  centerLng: -120.18,
  defaultZoom: 12,
  timezone: 'America/Los_Angeles',
  countryCode: 'US',
} as Region;

const tap = { lat: 39.3275, lng: -120.1833 };
const c = (o: Partial<GeocodeCandidate>): GeocodeCandidate => ({
  placeId: 'ChIJ_example_1',
  address: '10100 Donner Pass Rd, Truckee, CA 96161, USA',
  lat: tap.lat,
  lng: tap.lng,
  types: ['street_address'],
  ...o,
});
const pin = (o: Partial<PinView>): PinView => ({ id: 'h1', address: '1 A St, Truckee', lat: 39.3, lng: -120.2, photoCount: 0, badges: [], ...o });

describe('pickStreetResult', () => {
  it('takes the first street-level result and keeps the tapped point', () => {
    const r = pickStreetResult([c({ types: ['route'], placeId: 'route_id_123' }), c({ types: ['premise'], lat: 39.3276 })], region, tap);
    expect(r).toEqual({ ok: true, place: expect.objectContaining({ types: ['premise'], lat: tap.lat, lng: tap.lng }) });
  });
  it('rejects non-street results', () => {
    expect(pickStreetResult([c({ types: ['route'] }), c({ types: ['locality', 'political'] })], region, tap)).toEqual({ ok: false, reason: 'not_street' });
    expect(pickStreetResult([], region, tap)).toEqual({ ok: false, reason: 'not_street' });
  });
  it('rejects a tap or a result outside the region box', () => {
    expect(pickStreetResult([c({})], region, { lat: 39.5, lng: -120.18 })).toEqual({ ok: false, reason: 'outside' });
    expect(pickStreetResult([c({ lat: 39.6 })], region, tap)).toEqual({ ok: false, reason: 'outside' });
  });
});

describe('findNearbyDuplicate', () => {
  const place = { placeId: 'p_1234567890', address: '10100 Donner Pass Rd, Truckee, CA', lat: tap.lat, lng: tap.lng, types: ['street_address'] };
  it('matches a pin within 30 m, nearest first', () => {
    const near = pin({ id: 'near', lat: tap.lat + 0.0001, lng: tap.lng }); // ~11 m
    const nearer = pin({ id: 'nearer', lat: tap.lat + 0.00005, lng: tap.lng }); // ~5.5 m
    expect(findNearbyDuplicate([near, nearer], place)?.id).toBe('nearer');
  });
  it('ignores pins farther than 30 m', () => {
    expect(findNearbyDuplicate([pin({ lat: tap.lat + 0.0005, lng: tap.lng })], place)).toBeNull(); // ~55 m
  });
  it('matches the same street line regardless of distance and punctuation', () => {
    expect(findNearbyDuplicate([pin({ id: 'same', address: '10100 Donner Pass Rd., Truckee' })], place)?.id).toBe('same');
  });
  it('distance is about right', () => {
    expect(Math.round(distanceM(tap, { lat: tap.lat + 0.001, lng: tap.lng }))).toBe(111);
  });
});
