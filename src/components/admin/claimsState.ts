// Pure helpers for the admin Claims tab and the Overview subscriber panel (Spec_Subscribe_Accounts §7, B5, C6-C8).
// The database re-checks everything; these are for fast feedback and display only.
import type { AdminClaim, ClaimKind, DataError, DigestToday } from '@/lib/data/types';

export type ClaimFilter = 'pending' | 'approved' | 'rejected';
export const CLAIM_FILTERS: ClaimFilter[] = ['pending', 'approved', 'rejected'];
export const CLAIM_FILTER_LABEL: Record<ClaimFilter, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

export function claimsBadgeText(pending: number | null): string {
  return pending === null || pending <= 0 ? 'Claims' : `Claims (${pending})`;
}

export const KIND_LABEL: Record<ClaimKind, string> = { claim: 'Claim', removal: 'Removal request' };

export type ClaimAction = 'approve' | 'reject' | 'clear_owner';
/** Pending rows can be approved or rejected. A claim on a house that has an owner can also clear that owner. */
export function claimActionsFor(c: Pick<AdminClaim, 'status' | 'kind' | 'currentOwnerMasked'>): ClaimAction[] {
  if (c.status !== 'pending') return [];
  const a: ClaimAction[] = ['approve', 'reject'];
  if (c.currentOwnerMasked !== null) a.push('clear_owner');
  return a;
}

/** What approving does, in plain words, shown above the buttons. */
export function approveHint(c: Pick<AdminClaim, 'kind' | 'currentOwnerMasked'>): string {
  if (c.kind === 'removal') return 'Approving takes this house off the map for good, like Release on the Houses tab.';
  return c.currentOwnerMasked !== null
    ? `Approving replaces the current owner (${c.currentOwnerMasked}) with this person.`
    : 'Approving lets this person manage the listing: hide, unhide, and ask for removal.';
}

export function approveLabel(kind: ClaimKind): string {
  return kind === 'removal' ? 'Approve removal' : 'Approve';
}

export const CLAIM_REASON_MAX = 200;
/** Reject keeps an optional reason (admins only), at most 200 characters. */
export function checkClaimReason(raw: string): { ok: true; reason: string | undefined } | { ok: false; error: string } {
  const reason = raw.trim().replace(/\s+/g, ' ');
  if (reason.length > CLAIM_REASON_MAX) return { ok: false, error: `Keep the reason under ${CLAIM_REASON_MAX} characters.` };
  return { ok: true, reason: reason === '' ? undefined : reason };
}

export function claimErrorText(e: DataError, fallback: string): string {
  switch (e.code) {
    case 'already_owned': return 'This house was given to someone else in the meantime. Refresh the list.';
    case 'not_found': return 'That request is gone. Refresh the list.';
    case 'not_pending': return 'Someone already handled this request. Refresh the list.';
    case 'invalid_input':
      return e.detail === 'transition' || e.detail === 'status' ? 'Someone already handled this request. Refresh the list.' : fallback;
    default: return fallback;
  }
}

/** Errors after which the list is stale and should reload. */
export function claimErrorStale(e: DataError): boolean {
  return e.code === 'already_owned' || e.code === 'not_found' || e.code === 'not_pending' ||
    (e.code === 'invalid_input' && (e.detail === 'transition' || e.detail === 'status'));
}

/** Age like "3 h ago" from an ISO time. */
export function ageText(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

// ---- Overview: digest usage (C8) -----------------------------------------------------------------------
export type UsageLevel = 'ok' | 'warn' | 'full';

/** Whole percent of the provider's daily limit used, clamped to 0-100. */
export function usagePercent(d: Pick<DigestToday, 'sent' | 'providerDailyLimit'>): number {
  if (!(d.providerDailyLimit > 0)) return 0;
  return Math.min(100, Math.round((d.sent / d.providerDailyLimit) * 100));
}

/** warn from 80% of the provider limit; full at the limit. */
export function usageLevel(d: Pick<DigestToday, 'sent' | 'providerDailyLimit'>): UsageLevel {
  if (!(d.providerDailyLimit > 0)) return 'ok';
  const r = d.sent / d.providerDailyLimit;
  return r >= 1 ? 'full' : r >= 0.8 ? 'warn' : 'ok';
}

/** The banner copy, or null when nothing needs attention. */
export function usageBanner(d: DigestToday): string | null {
  if (d.capHit) return 'The digest hit its daily cap and left some people for the next run. Upgrade Resend ($20/mo) to send more.';
  const l = usageLevel(d);
  if (l === 'full') return 'Resend\'s daily limit is used up. Sign-in emails may not arrive until tomorrow. Upgrade Resend ($20/mo).';
  if (l === 'warn') return 'Email use is above 80% of Resend\'s daily limit. Upgrade Resend ($20/mo).';
  return null;
}
