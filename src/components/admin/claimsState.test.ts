import { describe, expect, it } from 'vitest';
import { DataError } from '@/lib/data/types';
import { toAdminClaim } from '@/lib/data/adminAccounts';
import {
  ageText, approveHint, approveLabel, checkClaimReason, claimActionsFor, claimErrorStale, claimErrorText, claimsBadgeText,
  usageBanner, usageLevel, usagePercent,
} from './claimsState';

describe('claims badge and actions', () => {
  it('shows only a positive pending count', () => {
    expect(claimsBadgeText(null)).toBe('Claims');
    expect(claimsBadgeText(0)).toBe('Claims');
    expect(claimsBadgeText(4)).toBe('Claims (4)');
  });
  it('offers approve/reject on pending rows only, plus clear owner when an owner exists', () => {
    expect(claimActionsFor({ status: 'pending', kind: 'claim', currentOwnerMasked: null })).toEqual(['approve', 'reject']);
    expect(claimActionsFor({ status: 'pending', kind: 'claim', currentOwnerMasked: 's•••@gmail.com' })).toEqual(['approve', 'reject', 'clear_owner']);
    expect(claimActionsFor({ status: 'approved', kind: 'claim', currentOwnerMasked: 's•••@gmail.com' })).toEqual([]);
    expect(claimActionsFor({ status: 'rejected', kind: 'removal', currentOwnerMasked: null })).toEqual([]);
  });
  it('explains what approve does per kind', () => {
    expect(approveHint({ kind: 'removal', currentOwnerMasked: 'a•••@b.com' })).toMatch(/off the map/);
    expect(approveHint({ kind: 'claim', currentOwnerMasked: 'a•••@b.com' })).toContain('a•••@b.com');
    expect(approveHint({ kind: 'claim', currentOwnerMasked: null })).toMatch(/manage the listing/);
    expect(approveLabel('removal')).toBe('Approve removal');
    expect(approveLabel('claim')).toBe('Approve');
  });
});

describe('reject reason', () => {
  it('is optional, trimmed, and capped at 200', () => {
    expect(checkClaimReason('   ')).toEqual({ ok: true, reason: undefined });
    expect(checkClaimReason('  Not   theirs ')).toEqual({ ok: true, reason: 'Not theirs' });
    expect(checkClaimReason('x'.repeat(201)).ok).toBe(false);
    expect(checkClaimReason('x'.repeat(200)).ok).toBe(true);
  });
});

describe('errors', () => {
  it('maps already_owned and stale rows', () => {
    expect(claimErrorText(new DataError('already_owned'), 'fb')).toMatch(/someone else/);
    expect(claimErrorText(new DataError('invalid_input', 'transition'), 'fb')).toMatch(/already handled/);
    expect(claimErrorText(new DataError('rate_limited'), 'fb')).toBe('fb');
    expect(claimErrorStale(new DataError('already_owned'))).toBe(true);
    expect(claimErrorStale(new DataError('network'))).toBe(false);
  });
});

describe('ageText', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('rounds down to the largest unit', () => {
    expect(ageText('2026-10-20T11:59:50Z', now)).toBe('just now');
    expect(ageText('2026-10-20T11:15:00Z', now)).toBe('45 min ago');
    expect(ageText('2026-10-20T09:00:00Z', now)).toBe('3 h ago');
    expect(ageText('2026-10-19T09:00:00Z', now)).toBe('1 day ago');
    expect(ageText('2026-10-17T09:00:00Z', now)).toBe('3 days ago');
    expect(ageText('nope', now)).toBe('');
  });
});

describe('row mapping', () => {
  const raw = { id: 'c', kind: 'weird', house_id: 'h', address: '1 Main', house_status: 'visible', status: 'pending', note: null, reason: null,
    created_at: 'x', resolved_at: null, claimant_masked: 'j•••@yahoo.com', current_owner_masked: null };
  it('keeps only masked values and defaults unknown kinds to claim', () => {
    const c = toAdminClaim(raw);
    expect(c.kind).toBe('claim');
    expect(c.claimantMasked).toBe('j•••@yahoo.com');
    expect(c.currentOwnerMasked).toBeNull();
    expect(toAdminClaim({ ...raw, kind: 'removal' }).kind).toBe('removal');
  });
});

describe('digest emails today vs the daily cap', () => {
  const d = (sent: number, capHit = false, cap = 500) => ({ sent, failed: 0, cap, capHit });
  it('computes percent and level against digest_daily_cap', () => {
    expect(usagePercent(d(155))).toBe(31);
    expect(usagePercent(d(2500))).toBe(100);
    expect(usagePercent(d(5, false, 0))).toBe(0);
    expect(usageLevel(d(399))).toBe('ok');
    expect(usageLevel(d(400))).toBe('warn');
    expect(usageLevel(d(500))).toBe('full');
  });
  it('warns at 80% and at the cap; never claims a provider limit or says to upgrade Resend', () => {
    expect(usageBanner(d(10))).toBeNull();
    expect(usageBanner(d(400))).toMatch(/80% of the daily cap \(500\)/);
    expect(usageBanner(d(500))).toMatch(/reached its daily cap/);
    expect(usageBanner(d(10, true))).toMatch(/reached its daily cap/);
    for (const n of [400, 500]) expect(usageBanner(d(n))).not.toMatch(/Resend|upgrade|sign-in/i);
  });
});
