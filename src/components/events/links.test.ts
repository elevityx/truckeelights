import { describe, expect, it } from 'vitest';
import type { PublicEvent } from '@/lib/data/types';
import { directionsUrl, eventShareUrl, googleCalendarUrl, safeWebsite, townOf, worthTheDrive } from './links';

const e: PublicEvent = {
  id: '11111111-2222-4333-8444-555555555555',
  title: 'Halloween in the Park & more',
  description: 'Trick-or-treat downtown.\nCostume contest at 5:30.',
  venue: 'Downtown Park',
  address: '10046 Church St, Truckee, CA 96161',
  lat: 39.3274,
  lng: -120.1838,
  startsAt: '2026-10-30T23:00:00.000Z',
  endsAt: '2026-10-31T01:00:00.000Z',
  url: 'https://example.org/park',
  adultsOnly: false,
};

describe('worthTheDrive (Amendment 3)', () => {
  const truckee = { minLat: 39.15, maxLat: 39.45, minLng: -120.42, maxLng: -119.98 };
  it.each([
    ['Downtown Truckee', 39.3274, -120.1838, false],
    ['Sand Harbor', 39.1979, -119.9306, false],
    ['Crystal Bay', 39.2266, -120.0039, false],
    ['Reno (Wilbur May Arboretum)', 39.545, -119.825, true],
    ['Carson City', 39.164, -119.767, true],
  ])('%s -> %s', (_n, lat, lng, far) => {
    expect(worthTheDrive(truckee, { lat: lat as number, lng: lng as number })).toBe(far);
  });
});

describe('googleCalendarUrl', () => {
  it('builds an encoded TEMPLATE link in UTC', () => {
    const u = new URL(googleCalendarUrl(e, 'America/Los_Angeles'));
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(u.searchParams.get('action')).toBe('TEMPLATE');
    expect(u.searchParams.get('text')).toBe('Halloween in the Park & more');
    expect(u.searchParams.get('dates')).toBe('20261030T230000Z/20261031T010000Z');
    expect(u.searchParams.get('ctz')).toBe('America/Los_Angeles');
    expect(u.searchParams.get('location')).toBe('Downtown Park, 10046 Church St, Truckee, CA 96161');
    expect(u.searchParams.get('details')).toBe('Trick-or-treat downtown.\nCostume contest at 5:30.\n\nhttps://example.org/park');
    expect(u.search).not.toContain('& more'); // the ampersand is escaped, not a new param
    expect([...u.searchParams.keys()]).toEqual(['action', 'text', 'dates', 'ctz', 'details', 'location']);
  });
  it('gives an event with no end 3 hours', () => {
    const u = new URL(googleCalendarUrl({ ...e, endsAt: null, url: null, venue: null }, 'America/Los_Angeles'));
    expect(u.searchParams.get('dates')).toBe('20261030T230000Z/20261031T020000Z');
    expect(u.searchParams.get('details')).toBe(e.description);
    expect(u.searchParams.get('location')).toBe(e.address);
  });
});

describe('other links', () => {
  it('directions use the pin coordinates', () => {
    const u = new URL(directionsUrl(e));
    expect(u.searchParams.get('api')).toBe('1');
    expect(u.searchParams.get('destination')).toBe('39.3274,-120.1838');
  });
  it('share link opens the event', () => {
    expect(eventShareUrl('https://truckeelights.com', e.id)).toBe(`https://truckeelights.com/?event=${e.id}`);
  });
  it('only https websites render', () => {
    expect(safeWebsite('https://example.org/a')).toBe('https://example.org/a');
    expect(safeWebsite('http://example.org')).toBeNull();
    expect(safeWebsite('javascript:alert(1)')).toBeNull();
    expect(safeWebsite(null)).toBeNull();
    expect(safeWebsite('https://bit.ly/x')).toBeNull();
    expect(safeWebsite('https://127.0.0.1/')).toBeNull();
    expect(safeWebsite('https://example.org:8443/')).toBeNull();
    expect(safeWebsite('https://u@example.org/')).toBeNull();
  });
  it('finds the town in an address', () => {
    expect(townOf('10046 Church St, Truckee, CA 96161, USA')).toBe('Truckee');
    expect(townOf('Heritage Plaza, Tahoe City, CA')).toBe('Tahoe City');
    expect(townOf('2005 NV-28, Incline Village, NV 89451')).toBe('Incline Village');
    expect(townOf('Truckee')).toBe('Truckee');
  });
});
