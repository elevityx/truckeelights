import { describe, expect, it } from 'vitest';
import { toAdminEvent } from './adminEvents';
import { eventArgs, eventBounds, eventBoundsAdmin, inEventBounds, inEventBoundsAdmin, parseSubmitEvent, toPublicEvent } from './events';
import { eventsCapability } from './public';
import type { EventInput } from './types';

const truckee = { minLat: 39.15, maxLat: 39.45, minLng: -120.42, maxLng: -119.98 };
const raw = {
  id: 'e1', title: 'Fake Walk', description: 'A made-up walk.', venue: null, address: 'Fakepine Park, Truckee',
  lat: '39.33', lng: -120.18, starts_at: '2026-10-30T16:00:00-07:00', ends_at: null, url: null, adults_only: false,
};

describe('eventBounds (mirror of SQL private.event_bounds)', () => {
  it('pads 0.05 on every side and 0.10 on the east edge', () => {
    const b = eventBounds(truckee);
    expect(b.minLat).toBeCloseTo(39.1, 9);
    expect(b.maxLat).toBeCloseTo(39.5, 9);
    expect(b.minLng).toBeCloseTo(-120.47, 9);
    expect(b.maxLng).toBeCloseTo(-119.88, 9);
  });
  it.each([
    ['Truckee', 39.328, -120.183, true],
    ['Tahoe City', 39.1677, -120.1452, true],
    ['Sand Harbor', 39.1979, -119.9306, true],
    ['Crystal Bay', 39.2266, -120.0039, true],
    ['Reno', 39.5296, -119.8138, false],
    ['NaN', Number.NaN, -120.18, false],
    ['Infinity', 39.33, Number.POSITIVE_INFINITY, false],
  ])('%s -> %s', (_name, lat, lng, inside) => {
    expect(inEventBounds(truckee, lat as number, lng as number)).toBe(inside);
  });
});

describe('eventBoundsAdmin (mirror of SQL private.event_bounds_admin, Amendment 3)', () => {
  it('is lat 39.09-39.60, lng -120.47 to -119.60 for Truckee', () => {
    const b = eventBoundsAdmin(truckee);
    expect(b.minLat).toBeCloseTo(39.09, 9);
    expect(b.maxLat).toBeCloseTo(39.6, 9);
    expect(b.minLng).toBeCloseTo(-120.47, 9);
    expect(b.maxLng).toBeCloseTo(-119.6, 9);
  });
  it('contains the whole local box', () => {
    const a = eventBoundsAdmin(truckee);
    const l = eventBounds(truckee);
    expect(a.minLat <= l.minLat && a.maxLat >= l.maxLat && a.minLng <= l.minLng && a.maxLng >= l.maxLng).toBe(true);
  });
  it.each([
    ['Truckee', 39.328, -120.183, true, true],
    ['Sand Harbor', 39.1979, -119.9306, true, true],
    ['Reno (Wilbur May Arboretum)', 39.545, -119.825, true, false],
    ['Carson City', 39.164, -119.767, true, false],
    ['Gardnerville', 38.94, -119.75, false, false],
    ['Fernley', 39.61, -119.25, false, false],
    ['NaN', Number.NaN, -119.8, false, false],
    ['Infinity', 39.5, Number.POSITIVE_INFINITY, false, false],
  ])('%s -> admin %s, local %s', (_name, lat, lng, admin, local) => {
    expect(inEventBoundsAdmin(truckee, lat as number, lng as number)).toBe(admin);
    expect(inEventBounds(truckee, lat as number, lng as number)).toBe(local);
  });
});

describe('toPublicEvent', () => {
  it('maps snake_case to the A12 shape with ISO UTC times and numeric coordinates', () => {
    expect(toPublicEvent(raw)).toEqual({
      id: 'e1', title: 'Fake Walk', description: 'A made-up walk.', venue: null, address: 'Fakepine Park, Truckee',
      lat: 39.33, lng: -120.18, startsAt: '2026-10-30T23:00:00.000Z', endsAt: null, url: null, adultsOnly: false,
    });
  });
});

describe('toAdminEvent', () => {
  it('adds the admin fields', () => {
    const a = toAdminEvent({
      ...raw, ends_at: '2026-10-31T01:00:00Z', status: 'pending', source: 'seed', source_url: 'https://example.org/s',
      reject_reason: null, created_at: '2026-10-08T00:00:00Z', same_day_warning: true, season: 'halloween', year: 2026,
    });
    expect(a).toMatchObject({
      endsAt: '2026-10-31T01:00:00.000Z', status: 'pending', source: 'seed', sourceUrl: 'https://example.org/s',
      rejectReason: null, createdAt: '2026-10-08T00:00:00Z', sameDayWarning: true, season: 'halloween', year: 2026,
    });
  });
});

describe('eventArgs', () => {
  it('maps every EventInput field to its RPC parameter', () => {
    const i: EventInput = {
      title: 't', description: 'd', venue: null, address: 'a', placeId: 'p', lat: 1, lng: 2,
      startsAt: '2026-10-30T23:00:00.000Z', endsAt: null, url: 'https://x.org', adultsOnly: true,
    };
    expect(eventArgs(i)).toEqual({
      p_title: 't', p_description: 'd', p_venue: null, p_address: 'a', p_place_id: 'p', p_lat: 1, p_lng: 2,
      p_starts_at: '2026-10-30T23:00:00.000Z', p_ends_at: null, p_url: 'https://x.org', p_adults_only: true,
    });
  });
});

describe('parseSubmitEvent', () => {
  it('created carries the id', () => {
    expect(parseSubmitEvent([{ result: 'created', event_id: 'e1' }])).toEqual({ result: 'created', eventId: 'e1' });
  });
  it('exists may carry no id (not approved)', () => {
    expect(parseSubmitEvent([{ result: 'exists', event_id: null }])).toEqual({ result: 'exists', eventId: null });
    expect(parseSubmitEvent({ result: 'exists', event_id: 'e2' })).toEqual({ result: 'exists', eventId: 'e2' });
  });
  it('anything else is unknown', () => {
    expect(() => parseSubmitEvent([])).toThrow('unknown');
    expect(() => parseSubmitEvent([{ result: 'created', event_id: null }])).toThrow('unknown');
  });
});

describe('eventsCapability (A1)', () => {
  it('missing key -> undefined (DB without events)', () => {
    expect(eventsCapability(undefined)).toBeUndefined();
    expect(eventsCapability(null)).toBeUndefined();
    expect(eventsCapability(true)).toBeUndefined();
  });
  it('reads open strictly', () => {
    expect(eventsCapability({ open: true })).toEqual({ open: true });
    expect(eventsCapability({ open: 'true' })).toEqual({ open: false });
    expect(eventsCapability({})).toEqual({ open: false });
  });
});
