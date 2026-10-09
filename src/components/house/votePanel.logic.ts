// Pure vote state for one house (optimistic taps, a serial queue, rollback). No React, no I/O.
import { DAILY_LIMIT } from '@/lib/votes/meter';
import type { DataErrorCode } from '@/lib/data/types';

export interface VoteState {
  total: number;
  left: number;
  /** Taps not yet confirmed, oldest first; each holds its photo id (null for a plain house vote). The head is in flight when `inFlight`. */
  queue: (string | null)[];
  inFlight: boolean;
  /** uid_daily: every vote button and heart is off until reload (the store spreads it to every house). */
  dailyExhausted: boolean;
  /** votes_closed from the server. */
  closed: boolean;
  /** True once the server has answered for this house in this session; a stale pin total must not overwrite it. */
  reconciled: boolean;
  /** Bumps on every accepted tap (drives the "+1" pop). */
  taps: number;
  /** Last settle, for the live region and toasts. `n` bumps each time. */
  note: { text: string; error: boolean; n: number } | null;
}

export type VoteAction =
  | { type: 'sync'; total: number; left: number }
  | { type: 'seed'; total: number }
  | { type: 'tap'; photoId: string | null }
  | { type: 'send' }
  | { type: 'ok'; total: number; left: number }
  | { type: 'fail'; code: DataErrorCode; detail?: string; message: string }
  | { type: 'exhaust' };

export function initialVoteState(total: number): VoteState {
  return { total: clean(total), left: DAILY_LIMIT, queue: [], inFlight: false, dailyExhausted: false, closed: false, reconciled: false, taps: 0, note: null };
}

function clean(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Shown under the vote button and at the bottom of the list (spec §4.8). Public copy. */
export const VOTE_PRIVACY =
  "We count votes per device and per network using a scrambled, daily-reset code. We don't store your IP address.";

export const leftText = (left: number) => `${left} of ${DAILY_LIMIT} left today`;

const idle = (s: VoteState) => s.queue.length === 0 && !s.inFlight;

/** Can a tap be taken right now? */
export function canTap(s: VoteState): boolean {
  return s.left > 0 && !s.dailyExhausted && !s.closed;
}

/** The photo id to send next, or undefined when nothing should be sent (empty queue, or one already in flight). */
export function nextToSend(s: VoteState): string | null | undefined {
  return s.inFlight || s.queue.length === 0 ? undefined : s.queue[0];
}

const TERMINAL_RATE = ['house_daily', 'uid_daily', 'network_daily', 'house_breaker', 'region_breaker'];

/** Errors that would fail every queued tap the same way (so the rest of the queue is dropped, not sent). */
export function isTerminal(code: DataErrorCode, detail?: string): boolean {
  if (code === 'votes_closed' || code === 'not_signed_in') return true;
  return code === 'rate_limited' && detail !== undefined && TERMINAL_RATE.includes(detail);
}

export function voteReducer(s: VoteState, a: VoteAction): VoteState {
  switch (a.type) {
    case 'sync':
      // Server truth on open; never overwrite optimistic taps that are still pending.
      return idle(s) ? { ...s, total: clean(a.total), left: Math.min(DAILY_LIMIT, clean(a.left)), reconciled: true } : s;
    case 'seed':
      // The pin's count, used until the server answers. Never clobbers a total this session already reconciled.
      return idle(s) && !s.reconciled ? { ...s, total: clean(a.total) } : s;
    case 'tap':
      if (!canTap(s)) return s;
      return { ...s, total: s.total + 1, left: s.left - 1, queue: [...s.queue, a.photoId], taps: s.taps + 1 };
    case 'send':
      return s.inFlight || s.queue.length === 0 ? s : { ...s, inFlight: true };
    case 'ok': {
      if (!s.inFlight) return s;
      const queue = s.queue.slice(1);
      const left = Math.max(0, clean(a.left) - queue.length);
      return {
        ...s,
        queue,
        inFlight: false,
        reconciled: true,
        // Taps still queued were already counted locally, so add them on top of the server's answer.
        total: clean(a.total) + queue.length,
        left,
        note: { text: `Voted. ${leftText(left)}.`, error: false, n: (s.note?.n ?? 0) + 1 },
      };
    }
    case 'fail': {
      if (!s.inFlight) return s;
      // Roll back the failed head. Terminal errors would fail every queued tap the same way, so those are dropped
      // and rolled back too; other errors (a dropped connection, a revoked photo) leave the rest of the queue to be sent.
      const terminal = isTerminal(a.code, a.detail);
      const undo = terminal ? s.queue.length : 1;
      let left = Math.min(DAILY_LIMIT, s.left + undo);
      let { dailyExhausted, closed } = s;
      if (a.code === 'rate_limited' && (a.detail === 'house_daily' || a.detail === 'network_daily')) left = 0;
      if (a.code === 'rate_limited' && a.detail === 'uid_daily') dailyExhausted = true;
      if (a.code === 'votes_closed') closed = true;
      return {
        ...s,
        queue: terminal ? [] : s.queue.slice(1),
        inFlight: false,
        reconciled: true,
        total: Math.max(0, s.total - undo),
        left,
        dailyExhausted,
        closed,
        note: { text: a.message, error: true, n: (s.note?.n ?? 0) + 1 },
      };
    }
    case 'exhaust':
      return { ...s, dailyExhausted: true };
  }
}

/** Visitor text for a failed vote (spec §4.4). */
export function voteErrorMessage(code: DataErrorCode, detail: string | undefined, fallback: string): string {
  if (code === 'rate_limited') {
    if (detail === 'house_daily') return `All ${DAILY_LIMIT} votes used for this house today. More at midnight.`;
    if (detail === 'uid_daily') return "You've used today's votes. Come back tomorrow.";
    if (detail === 'network_daily') return 'This network has given this house 25 votes today. More at midnight.';
    if (detail === 'house_breaker' || detail === 'region_breaker') return 'This house is getting a lot of love right now — try again in a few minutes.';
  }
  if (code === 'votes_closed') return 'Voting opens soon.';
  if (code === 'not_found') return detail === 'photo' ? "That photo can't take votes anymore." : "This house isn't on the map anymore.";
  if (code === 'not_signed_in') return 'Do the quick bot check again to vote.';
  return fallback;
}
