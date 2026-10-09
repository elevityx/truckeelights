import { describe, expect, it } from 'vitest';
import { DataError } from '@/lib/data/types';
import {
  actionsFor, badgeText, buildEventInput, checkReason, displayHost, emptyForm, eventErrorText, 
  parseEventUrl, type EventFormValues,
} from './eventsState';

const TZ = 'America/Los_Angeles';
const region = { minLat: 39.3, maxLat: 39.4, minLng: -120.3, maxLng: -120.1, timezone: TZ };
const good = (o: Partial<EventFormValues> = {}): EventFormValues => ({
  ...emptyForm(), title: 'Pumpkin Walk', description: 'Walk the lit pumpkin trail.', address: 'Downtown Park, Truckee',
  lat: '39.33', lng: '-120.18', startDate: '2026-10-30', startTime: '16:00', ...o,
});

describe('actions and badge', () => {
  it('offers the allowed actions per status', () => {
    expect(actionsFor('pending')).toEqual(['approve', 'reject', 'edit']);
    expect(actionsFor('approved')).toEqual(['edit', 'hide']);
    expect(actionsFor('hidden')).toContain('restore');
    expect(actionsFor('rejected')).toContain('restore');
    expect(actionsFor('rejected')).not.toContain('hide');
  });
  it('badge shows only a positive pending count', () => {
    expect(badgeText(null)).toBe('Events');
    expect(badgeText(0)).toBe('Events');
    expect(badgeText(3)).toBe('Events (3)');
  });
});

describe('reject reason', () => {
  it('requires a reason and caps it at 200', () => {
    expect(checkReason('   ').ok).toBe(false);
    expect(checkReason('x'.repeat(201)).ok).toBe(false);
    expect(checkReason('  Not   local ')).toEqual({ ok: true, reason: 'Not local' });
    expect(checkReason('x'.repeat(200)).ok).toBe(true);
  });
});

describe('parseEventUrl (A6)', () => {
  it('accepts a plain https link and returns the host', () => {
    expect(parseEventUrl('https://Example.com/a?b=1')).toBe('example.com');
    expect(parseEventUrl('https://www.visittruckee.com/events')).toBe('www.visittruckee.com');
  });
  it.each([
    'http://example.com', 'javascript:alert(1)', 'https://user@example.com', 'https://user:pw@example.com', 'https://example.com:8443/',
    'https://localhost/', 'https://intranet/', 'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::1]/',
    'https://bit.ly/abc', 'https://t.co/x', 'https://exa mple.com', 'https://example.com/a\\b', 'https://example.com/"x', `https://example.com/${'a'.repeat(300)}`,
    'https://example.c', 'https://-bad.com', 'https://www.bit.ly/x', 'HTTPS://example.com', 'https://example.com./x', 'https://example.com/`x',
  ])('rejects %s', (u) => {
    expect(parseEventUrl(u)).toBeNull();
  });
  it('display falls back to a marked label', () => {
    expect(displayHost(null)).toBeNull();
    expect(displayHost('https://example.com/x')).toBe('example.com');
    expect(displayHost('http://evil.test')).toBe('unrecognized link');
  });
});

describe('buildEventInput', () => {
  it('builds a valid input and leaves optional fields null', () => {
    const r = buildEventInput(good(), region);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.startsAt).toBe('2026-10-30T23:00:00.000Z');
      expect(r.input.endsAt).toBeNull();
      expect(r.input.venue).toBeNull();
      expect(r.input.url).toBeNull();
      expect(r.sourceUrl).toBeNull();
    }
  });
  it('allows past start dates for admins', () => {
    expect(buildEventInput(good({ startDate: '2025-01-01' }), region).ok).toBe(true);
  });
  it('collects field errors', () => {
    const r = buildEventInput(good({ title: 'ab', description: 'short', address: 'x', lat: '', url: 'http://x.com', sourceUrl: 'https://bit.ly/z' }), region);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['address', 'description', 'lat', 'sourceUrl', 'title', 'url']);
  });
  it('bans angle brackets and too many newlines', () => {
    const r = buildEventInput(good({ title: 'A <b>', venue: 'V>', description: 'a\n\n\n\n\n\n\nb long enough' }), region);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['description', 'title', 'venue']);
  });
  it('flags coordinates outside the admin box', () => {
    const r = buildEventInput(good({ lat: '39.9', lng: '-119.8' }), region);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.lat).toBe('That spot is outside the map area.');
  });
  it('validates against the admin box (Amendment 3): Reno and Carson City pass, Gardnerville and Fernley fail', () => {
    const truckee = { minLat: 39.15, maxLat: 39.45, minLng: -120.42, maxLng: -119.98, timezone: TZ };
    expect(buildEventInput(good({ lat: '39.545', lng: '-119.825' }), truckee).ok).toBe(true);
    expect(buildEventInput(good({ lat: '39.164', lng: '-119.767' }), truckee).ok).toBe(true);
    expect(buildEventInput(good({ lat: '38.94', lng: '-119.75' }), truckee).ok).toBe(false);
    expect(buildEventInput(good({ lat: '39.61', lng: '-119.25' }), truckee).ok).toBe(false);
  });
  it('asks "Ends the next day?" and never infers', () => {
    const r = buildEventInput(good({ startTime: '20:00', endTime: '01:00' }), region);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.endDate).toBe('Ends the next day? Set the end date.');
    const ok = buildEventInput(good({ startTime: '20:00', endDate: '2026-10-31', endTime: '01:00' }), region);
    expect(ok.ok).toBe(true);
  });
  it('rejects an end before start with an explicit end date, and spans over 31 days', () => {
    const a = buildEventInput(good({ endDate: '2026-10-29', endTime: '10:00' }), region);
    expect(!a.ok && a.errors.endDate).toBe('The end must be after the start.');
    const b = buildEventInput(good({ endDate: '2026-12-15', endTime: '10:00' }), region);
    expect(!b.ok && b.errors.endDate).toMatch(/31 days/);
  });
  it('rejects a time inside the DST gap', () => {
    const r = buildEventInput(good({ startDate: '2027-03-14', startTime: '02:30' }), region);
    expect(!r.ok && r.errors.startTime).toMatch(/does not exist/);
  });
  it('keeps a valid source url', () => {
    const r = buildEventInput(good({ sourceUrl: ' https://example.org/page ' }), region);
    expect(r.ok && r.sourceUrl).toBe('https://example.org/page');
  });
});

describe('eventErrorText', () => {
  it('maps server errors to copy', () => {
    expect(eventErrorText(new DataError('invalid_input', 'transition'), 'x')).toMatch(/no longer allowed/);
    expect(eventErrorText(new DataError('invalid_input', 'starts_at'), 'x')).toMatch(/120 days/);
    expect(eventErrorText(new DataError('not_found'), 'x')).toMatch(/gone/);
    expect(eventErrorText(new DataError('network'), 'fb')).toBe('fb');
  });
});
