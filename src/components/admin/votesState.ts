import type { AdminVoteRow } from '@/lib/data/types';

/** Server-read tri-state for a switch. Starts `loading`; never seeded from a default. */
export type VotesSwitch = { kind: 'loading' } | { kind: 'on' } | { kind: 'off' } | { kind: 'unknown' };

/** Network cap adds `managed`: a region-only admin may not read or change it. */
export type CapState = VotesSwitch | { kind: 'managed' };

export const capFromBool = (on: boolean): CapState => ({ kind: on ? 'on' : 'off' });

/** Amber banner: voting is not known to be closed and the cap is not verified on. Unprobed/unknown counts as off. */
export function capBannerVisible(votes: VotesSwitch, cap: CapState): boolean {
  if (votes.kind === 'off') return false;
  if (cap.kind === 'managed') return false; // the owner manages it; we can't see it
  return cap.kind !== 'on' && cap.kind !== 'loading';
}

export function capText(c: CapState): string {
  switch (c.kind) {
    case 'on': return 'Network cap: on';
    case 'off': return 'Network cap: off (not verified)';
    case 'loading': return 'Network cap: checking…';
    case 'managed': return 'Network cap: managed by the site owner';
    default: return 'Network cap: unknown';
  }
}

/** Share of the last 24 h held by the top voter, as a whole percent, or null when unknowable. */
export function topShare(r: Pick<AdminVoteRow, 'votes24h' | 'topVoter24h'>): number | null {
  if (r.topVoter24h == null || !(r.votes24h > 0)) return null;
  const n = Number(r.topVoter24h);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(100, Math.round((n / r.votes24h) * 100));
}

/** Highlight when one voter holds at least half of 20+ recent votes. */
export function flooded(r: Pick<AdminVoteRow, 'votes24h' | 'topVoter24h'>): boolean {
  const s = topShare(r);
  return s !== null && s >= 50 && r.votes24h >= 20;
}

/** First 8 chars of a uid, nothing more. */
export const shortUid = (uid: string | null): string => (uid ? uid.slice(0, 8) : '–');

export const lastHourIso = (now: number): string => new Date(now - 3_600_000).toISOString();

export type VoidKind = 'hour' | 'top' | 'reset';

/** Args for adminVoidVotes(since, uid). `top` without a uid is not allowed (null). */
export function voidArgs(kind: VoidKind, row: Pick<AdminVoteRow, 'topVoter'>, now: number): { since: string | null; uid: string | null } | null {
  if (kind === 'hour') return { since: lastHourIso(now), uid: null };
  if (kind === 'top') return row.topVoter ? { since: null, uid: row.topVoter } : null;
  return { since: null, uid: null };
}

export function voidConfirmText(kind: VoidKind, address: string, row: Pick<AdminVoteRow, 'topVoter'>): string {
  if (kind === 'hour') return `Void the votes cast on ${address} in the last hour?`;
  if (kind === 'top') return `Void every vote from ${shortUid(row.topVoter)}… on ${address}?`;
  return `Reset ${address} to 0 votes? Every vote on it is voided.`;
}

export const voidResultText = (n: number): string => `${n} ${n === 1 ? 'vote' : 'votes'} voided`;

/** Clock read kept out of component bodies (react-hooks/purity). */
export const nowMs = (): number => Date.now();
