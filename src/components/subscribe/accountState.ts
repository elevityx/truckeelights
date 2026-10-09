// Pure helpers for `/account/`: what each house card may do, claim notes and search, the prefs editor, delete.
import type { DataErrorCode, MyAccount, OwnedHouse, PinView, Subscription, SubscriptionPrefs } from '@/lib/data/types';

export interface HouseView {
  pill: { text: string; tone: 'ok' | 'warn' | 'mute' };
  /** Hide (visible only, C6). */
  canHide: boolean;
  /** Unhide (owner-hidden only; an admin-hidden house never, C6). */
  canUnhide: boolean;
  canRequestRemoval: boolean;
  note: string;
}

export function houseView(h: OwnedHouse): HouseView {
  const adminHidden = h.status === 'hidden' && !h.hiddenByOwner;
  const pill = h.removalPending
    ? { text: 'Removal requested', tone: 'warn' as const }
    : adminHidden
      ? { text: 'Hidden by an admin', tone: 'mute' as const }
      : h.status === 'hidden'
        ? { text: 'Hidden', tone: 'warn' as const }
        : { text: 'On the map', tone: 'ok' as const };
  const note = h.removalPending
    ? 'An admin will take it off the map soon. You can withdraw the request until then.'
    : adminHidden
      ? 'An admin hid this house. Reply to any of our emails if you think that’s a mistake.'
      : h.status === 'hidden'
        ? 'Hidden houses keep their votes and photos. Nobody sees them until you unhide.'
        : 'Hide takes it off the map for now. A removal request takes it off for good.';
  return {
    pill,
    canHide: h.status === 'visible' && !h.removalPending,
    canUnhide: h.status === 'hidden' && h.hiddenByOwner && !h.removalPending,
    canRequestRemoval: !h.removalPending,
    note,
  };
}

/** Errors on owner actions, in plain words. */
export function ownerActionMessage(code: DataErrorCode): string {
  switch (code) {
    case 'rate_limited':
      return 'That house changed a few times today already. Try again tomorrow.';
    case 'forbidden':
      return 'You can’t change that house. It may have been hidden by an admin, or it’s no longer in your account.';
    case 'claim_pending':
      return 'There’s already a request waiting for this house.';
    case 'already_owned':
      return 'That house is already in your account.';
    case 'not_found':
      return 'That house isn’t on this season’s map anymore.';
    case 'invalid_input':
      return 'Check the note: up to 300 characters, without < or >.';
    case 'not_signed_in':
      return 'Your sign-in ended. Sign in again to continue.';
    case 'network':
      return 'Can’t reach the server. Check your connection.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export const NOTE_MIN = 10;
export const NOTE_MAX = 300;

/** Claim notes (and removal notes when given): 10-300 characters, no < or > (the server checks too). */
export function noteProblem(raw: string, required = true): string {
  const n = raw.trim();
  if (!n && !required) return '';
  if (n.length < NOTE_MIN) return `Add a few words so the admin can check. At least ${NOTE_MIN} characters.`;
  if (n.length > NOTE_MAX) return `Keep it under ${NOTE_MAX} characters.`;
  if (/[<>]/.test(n)) return 'Remove the < and > characters.';
  return '';
}

/** Houses on this season's map matching the query, minus the ones already in the account. */
export function searchHouses(pins: readonly PinView[], query: string, ownIds: ReadonlySet<string>, max = 8): PinView[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (q.length < 2) return [];
  return pins.filter((p) => !ownIds.has(p.id) && p.address.toLowerCase().includes(q)).slice(0, max);
}

/** "Keep at least one": turning off the last topic is refused (use Stop emails instead). */
export function toggleTopic(p: SubscriptionPrefs, t: 'houses' | 'events'): SubscriptionPrefs | null {
  const next = { ...p, [t]: !p[t] };
  return next.houses || next.events ? next : null;
}

export function prefsChanged(sub: Subscription | null, draft: SubscriptionPrefs): boolean {
  if (!sub) return true;
  return sub.houses !== draft.houses || sub.events !== draft.events || sub.cadence !== draft.cadence;
}

export function draftFrom(sub: Subscription | null): SubscriptionPrefs {
  return sub ? { houses: sub.houses, events: sub.events, cadence: sub.cadence } : { houses: true, events: true, cadence: 'daily' };
}

export const DELETE_WORD = 'DELETE';
export function deleteReady(typed: string): boolean {
  return typed.trim() === DELETE_WORD;
}

/** The pending claim (kind 'claim'), if any: one per account. */
export function pendingClaim(a: MyAccount) {
  return a.claims.find((c) => c.kind === 'claim') ?? null;
}

/** The pending removal request for a house, if any. */
export function pendingRemoval(a: MyAccount, houseId: string) {
  return a.claims.find((c) => c.kind === 'removal' && c.houseId === houseId) ?? null;
}

/** "88 Lantern Ct, Truckee, CA 96161" -> ["88 Lantern Ct", "Truckee, CA 96161"]. */
export function splitAddress(a: string): [string, string] {
  const i = a.indexOf(',');
  return i < 0 ? [a, ''] : [a.slice(0, i).trim(), a.slice(i + 1).trim()];
}
