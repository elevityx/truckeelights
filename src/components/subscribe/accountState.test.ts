import { describe, expect, it } from 'vitest';
import type { MyAccount, OwnedHouse, PinView } from '@/lib/data/types';
import {
  deleteReady,
  draftFrom,
  houseView,
  noteProblem,
  ownerActionMessage,
  pendingClaim,
  pendingRemoval,
  prefsChanged,
  searchHouses,
  splitAddress,
  toggleTopic,
} from './accountState';

const house = (o: Partial<OwnedHouse> = {}): OwnedHouse => ({
  id: 'h1',
  address: '88 Lantern Ct, Truckee, CA 96161',
  status: 'visible',
  hiddenByOwner: false,
  votes: 100,
  approvedPhotos: 4,
  removalPending: false,
  ...o,
});

describe('house card actions (C6)', () => {
  it('visible: hide and request removal, no unhide', () => {
    expect(houseView(house())).toMatchObject({ canHide: true, canUnhide: false, canRequestRemoval: true, pill: { text: 'On the map' } });
  });
  it('owner-hidden: unhide only', () => {
    expect(houseView(house({ status: 'hidden', hiddenByOwner: true }))).toMatchObject({ canHide: false, canUnhide: true, pill: { text: 'Hidden' } });
  });
  it('admin-hidden: never unhide', () => {
    const v = houseView(house({ status: 'hidden', hiddenByOwner: false }));
    expect(v.canHide).toBe(false);
    expect(v.canUnhide).toBe(false);
    expect(v.pill.text).toBe('Hidden by an admin');
  });
  it('removal pending: no hide/unhide, no second request', () => {
    const v = houseView(house({ removalPending: true }));
    expect(v).toMatchObject({ canHide: false, canUnhide: false, canRequestRemoval: false, pill: { text: 'Removal requested' } });
  });
});

describe('claims', () => {
  it('notes: 10-300 chars, no < or >; optional notes may be empty', () => {
    expect(noteProblem('short')).toMatch(/10/);
    expect(noteProblem('Blue door, ghost on the roof.')).toBe('');
    expect(noteProblem('x'.repeat(301))).toMatch(/300/);
    expect(noteProblem('my <b>house</b> for sure')).toMatch(/</);
    expect(noteProblem('   ', false)).toBe('');
    expect(noteProblem('hi', false)).not.toBe('');
  });
  it('search: 2+ letters, case-insensitive, skips houses already in the account', () => {
    const pins = [
      { id: 'a', address: '1730 Old Signal Rd, Truckee' },
      { id: 'b', address: '412 Snowshed Ln, Truckee' },
      { id: 'c', address: '301 Snowshed Ln, Truckee' },
    ] as PinView[];
    expect(searchHouses(pins, 's', new Set())).toEqual([]);
    expect(searchHouses(pins, 'SNOWSHED', new Set()).map((p) => p.id)).toEqual(['b', 'c']);
    expect(searchHouses(pins, 'snowshed', new Set(['b'])).map((p) => p.id)).toEqual(['c']);
    expect(searchHouses(pins, 'truckee', new Set(), 2)).toHaveLength(2);
  });
  it('finds the pending claim and a house’s removal request', () => {
    const a: MyAccount = {
      email: 'x',
      subscription: null,
      houses: [],
      claims: [
        { id: 'r', kind: 'removal', houseId: 'h1', address: 'A', status: 'pending', createdAt: '' },
        { id: 'c', kind: 'claim', houseId: 'h2', address: 'B', status: 'pending', createdAt: '' },
      ],
    };
    expect(pendingClaim(a)?.id).toBe('c');
    expect(pendingRemoval(a, 'h1')?.id).toBe('r');
    expect(pendingRemoval(a, 'h2')).toBeNull();
  });
});

describe('prefs editor', () => {
  it('refuses turning off the last topic', () => {
    expect(toggleTopic({ houses: true, events: false, cadence: 'daily' }, 'houses')).toBeNull();
    expect(toggleTopic({ houses: true, events: true, cadence: 'daily' }, 'houses')).toEqual({ houses: false, events: true, cadence: 'daily' });
  });
  it('detects changes against the saved subscription', () => {
    const sub = { regionSlug: 'truckee', houses: true, events: true, cadence: 'daily' as const, status: 'active' as const, confirmedAt: null };
    expect(prefsChanged(sub, draftFrom(sub))).toBe(false);
    expect(prefsChanged(sub, { ...draftFrom(sub), cadence: 'weekly' })).toBe(true);
    expect(prefsChanged(null, draftFrom(null))).toBe(true);
    expect(draftFrom(null)).toEqual({ houses: true, events: true, cadence: 'daily' });
  });
});

describe('misc', () => {
  it('delete needs the exact word', () => {
    expect(deleteReady('DELETE')).toBe(true);
    expect(deleteReady(' DELETE ')).toBe(true);
    expect(deleteReady('delete')).toBe(false);
    expect(deleteReady('')).toBe(false);
  });
  it('splits an address for the card', () => {
    expect(splitAddress('88 Lantern Ct, Truckee, CA 96161')).toEqual(['88 Lantern Ct', 'Truckee, CA 96161']);
    expect(splitAddress('88 Lantern Ct')).toEqual(['88 Lantern Ct', '']);
  });
  it('owner errors have specific copy', () => {
    expect(ownerActionMessage('rate_limited')).toMatch(/tomorrow/);
    expect(ownerActionMessage('claim_pending')).toMatch(/already/);
    expect(ownerActionMessage('unknown')).toMatch(/went wrong/);
  });
});
