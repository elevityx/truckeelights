import { describe, expect, it } from 'vitest';
import type { Region } from '@/lib/data/types';
import { checkDraft, earliestStartDate, emptyDraft, isBot, urlProblem, type EventDraft } from './eventForm';

const region: Region = {
  id: 'r', slug: 'truckee', name: 'Truckee', minLat: 39.15, maxLat: 39.45, minLng: -120.42, maxLng: -119.98,
  centerLat: 39.328, centerLng: -120.183, defaultZoom: 12, timezone: 'America/Los_Angeles', countryCode: 'US',
};
const now = Date.parse('2026-10-08T19:00:00Z'); // Thu Oct 8, noon Pacific
const good: EventDraft = {
  ...emptyDraft,
  title: '  Glenshire   Glow Walk ',
  startDate: '2026-10-27',
  startTime: '18:30',
  address: '88 Lantern Ct, Truckee, CA',
  place: { placeId: 'abc', lat: 39.33, lng: -120.18 },
  description: 'Walk the loop with glow sticks.\nKids welcome.',
};

describe('checkDraft', () => {
  it('builds the RPC input with Pacific times', () => {
    const r = checkDraft({ ...good, endTime: '20:00', url: 'https://example.org/x', venue: ' Glenshire Loop ' }, region, now);
    expect(r.errors).toEqual({});
    expect(r.input).toEqual({
      title: 'Glenshire Glow Walk',
      description: 'Walk the loop with glow sticks.\nKids welcome.',
      venue: 'Glenshire Loop',
      address: '88 Lantern Ct, Truckee, CA',
      placeId: 'abc',
      lat: 39.33,
      lng: -120.18,
      startsAt: '2026-10-28T01:30:00.000Z',
      endsAt: '2026-10-28T03:00:00.000Z',
      url: 'https://example.org/x',
      adultsOnly: false,
    });
  });
  it('requires the basics', () => {
    const r = checkDraft(emptyDraft, region, now);
    expect(Object.keys(r.errors).sort()).toEqual(['description', 'location', 'startDate', 'startTime', 'title']);
    expect(r.input).toBeNull();
  });
  it('bans angle brackets and long text', () => {
    const r = checkDraft({ ...good, title: '<b>x</b>', venue: 'a<b', description: 'x'.repeat(601) }, region, now);
    expect(r.errors.title).toMatch(/</);
    expect(r.errors.venue).toMatch(/</);
    expect(r.errors.description).toMatch(/600/);
  });
  it('limits line breaks', () => {
    expect(checkDraft({ ...good, description: 'line\n'.repeat(8) + 'end' }, region, now).errors.description).toMatch(/line breaks/);
  });
  it('asks for the end date when the end time is earlier on the same day', () => {
    const r = checkDraft({ ...good, startTime: '20:00', endTime: '01:00' }, region, now);
    expect(r.errors.endTime).toBe('Ends the next day? Set the end date.');
    expect(r.askEndDate).toBe(true);
    const fixed = checkDraft({ ...good, startTime: '20:00', endTime: '01:00', endDate: '2026-10-28' }, region, now);
    expect(fixed.errors).toEqual({});
    expect(fixed.input?.endsAt).toBe('2026-10-28T08:00:00.000Z');
  });
  it('needs an end time with an end date, and caps the length at 31 days', () => {
    expect(checkDraft({ ...good, endDate: '2026-10-28' }, region, now).errors.endTime).toBeDefined();
    expect(checkDraft({ ...good, endDate: '2026-12-01', endTime: '10:00' }, region, now).errors.endDate).toMatch(/31/);
  });
  it('enforces the submit window', () => {
    expect(checkDraft({ ...good, startDate: '2026-10-07' }, region, now).errors.startDate).toBeDefined();
    expect(checkDraft({ ...good, startDate: '2026-10-08', startTime: '11:30' }, region, now).errors).toEqual({}); // 30 min ago is fine
    expect(checkDraft({ ...good, startDate: '2027-02-06' }, region, now).errors.startDate).toMatch(/120/);
  });
  it('rejects the DST gap', () => {
    const later = Date.parse('2026-12-20T19:00:00Z');
    expect(checkDraft({ ...good, startDate: '2027-03-14', startTime: '02:30' }, region, later).errors.startTime).toMatch(/clocks/);
  });
  it('checks the event bounds and the address characters', () => {
    expect(checkDraft({ ...good, place: { placeId: null, lat: 39.529, lng: -119.813 } }, region, now).errors.location).toMatch(/outside/);
    expect(checkDraft({ ...good, place: { placeId: null, lat: 39.198, lng: -119.93 } }, region, now).errors).toEqual({});
    expect(checkDraft({ ...good, address: 'Café & Bar, Truckee' }, region, now).errors.address).toBeDefined();
  });
});

describe('urlProblem', () => {
  it.each([
    ['https://example.org', null],
    ['https://www.tcpud.org/recreation/special-events/harvest-fest?x=1#top', null],
    ['http://example.org', 'https'],
    ['javascript:alert(1)', 'https'],
    ['https://user@example.org', 'characters'],
    ['https://example.org:8443/', 'port'],
    ['https://192.168.0.1/', 'website'],
    ['https://3232235521/', 'website'],
    ['https://0x7f000001/', 'website'],
    ['https://[::1]/', 'port'],
    ['https://localhost/', 'website'],
    ['https://intranet/', 'website'],
    ['https://bit.ly/abc', 'full link'],
    ['https://example.org/"onmouseover', 'characters'],
    ['https://example.org/a b', 'characters'],
    ['https://example.org\\@evil.com', 'characters'],
    ['https://example.org/' + 'a'.repeat(300), 'shorter'],
    ['HTTPS://example.org', 'https'],
    ['https://example.org./event', 'website'],
    ['https://foo.localhost/x', 'website'],
    ['https://www.bit.ly/x', 'full link'],
    ['https://example.org/`x', 'characters'],
  ])('%s', (url, expected) => {
    const p = urlProblem(url);
    if (expected === null) expect(p).toBeNull();
    else expect(p).toContain(expected);
  });
});

describe('honeypot', () => {
  it('flags a filled hidden field', () => {
    expect(isBot({ honeypot: '' })).toBe(false);
    expect(isBot({ honeypot: 'http://spam' })).toBe(true);
  });
});

describe('earliestStartDate', () => {
  it('uses the Pacific date of now minus one hour', () => {
    // 2026-10-31 00:30 PDT = 07:30Z. One hour earlier is still Oct 30 23:30 PDT, so Oct 30 stays selectable.
    expect(earliestStartDate(Date.parse('2026-10-31T07:30:00Z'), 'America/Los_Angeles')).toBe('2026-10-30');
    expect(earliestStartDate(Date.parse('2026-10-31T08:30:00Z'), 'America/Los_Angeles')).toBe('2026-10-31');
  });
});

describe('a rejected place type', () => {
  it('clears the earlier valid location and address', async () => {
    const { clearRejectedPlace, emptyDraft } = await import('./eventForm');
    const armed = { ...emptyDraft, place: { placeId: 'park', lat: 39.3, lng: -120.2 }, address: '10 Park Way' };
    const after = clearRejectedPlace(armed);
    expect(after.place).toBeNull();
    expect(after.address).toBe('');
  });
});
