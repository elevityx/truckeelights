import { describe, expect, it } from 'vitest';
import {
  capBannerVisible, capFromBool, capText, flooded, lastHourIso, shortUid, topShare, voidArgs, voidConfirmText, voidResultText,
  type CapState, type VotesSwitch,
} from './votesState';

const on: VotesSwitch = { kind: 'on' };
const off: VotesSwitch = { kind: 'off' };

describe('capBannerVisible', () => {
  it('shows when voting is open and cap is off or unknown', () => {
    expect(capBannerVisible(on, { kind: 'off' })).toBe(true);
    expect(capBannerVisible(on, { kind: 'unknown' })).toBe(true);
  });
  it('shows while voting state is unknown too (no false calm)', () => {
    expect(capBannerVisible({ kind: 'unknown' }, { kind: 'off' })).toBe(true);
  });
  it('hidden when cap on, loading, managed, or voting off', () => {
    expect(capBannerVisible(on, { kind: 'on' })).toBe(false);
    expect(capBannerVisible(on, { kind: 'loading' })).toBe(false);
    expect(capBannerVisible(on, { kind: 'managed' })).toBe(false);
    expect(capBannerVisible(off, { kind: 'off' })).toBe(false);
  });
});

describe('capText / capFromBool', () => {
  it('labels every state', () => {
    const states: CapState[] = [capFromBool(true), capFromBool(false), { kind: 'loading' }, { kind: 'managed' }, { kind: 'unknown' }];
    expect(states.map(capText)).toEqual([
      'Network cap: on', 'Network cap: off (not verified)', 'Network cap: checking…',
      'Network cap: managed by the site owner', 'Network cap: unknown',
    ]);
  });
});

describe('topShare / flooded', () => {
  it('computes percent', () => expect(topShare({ votes24h: 40, topVoter24h: 10 })).toBe(25));
  it('null when unknowable', () => {
    expect(topShare({ votes24h: 0, topVoter24h: 3 })).toBeNull();
    expect(topShare({ votes24h: 10, topVoter24h: null })).toBeNull();
    expect(topShare({ votes24h: 10, topVoter24h: NaN })).toBeNull();
  });
  it('flags at >=50% and >=20 votes only', () => {
    expect(flooded({ votes24h: 20, topVoter24h: 10 })).toBe(true);
    expect(flooded({ votes24h: 20, topVoter24h: 9 })).toBe(false);
    expect(flooded({ votes24h: 19, topVoter24h: 19 })).toBe(false);
  });
});

describe('void helpers', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  it('last hour', () => expect(lastHourIso(now)).toBe('2026-10-31T11:00:00.000Z'));
  it('args per kind', () => {
    expect(voidArgs('hour', { topVoter: null }, now)).toEqual({ since: '2026-10-31T11:00:00.000Z', uid: null });
    expect(voidArgs('top', { topVoter: 'abc' }, now)).toEqual({ since: null, uid: 'abc' });
    expect(voidArgs('top', { topVoter: null }, now)).toBeNull();
    expect(voidArgs('reset', { topVoter: 'abc' }, now)).toEqual({ since: null, uid: null });
  });
  it('shows only 8 chars of a uid', () => {
    expect(shortUid('12345678-aaaa-bbbb')).toBe('12345678');
    expect(shortUid(null)).toBe('–');
    expect(voidConfirmText('top', '1 Elm', { topVoter: '12345678-aaaa' })).not.toContain('aaaa');
  });
  it('result copy', () => {
    expect(voidResultText(1)).toBe('1 vote voided');
    expect(voidResultText(0)).toBe('0 votes voided');
  });
});
