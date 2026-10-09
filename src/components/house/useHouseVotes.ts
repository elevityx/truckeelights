'use client';

// Shared vote state per house, so the sheet's VotePanel and the lightbox heart stay in sync (same total, same
// 5 a day, one serial queue). A tiny module store read through useSyncExternalStore; the logic is the pure
// voteReducer in votePanel.logic.ts.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { toDataError, userMessage } from '@/lib/data/errors';
import { initialVoteState, nextToSend, voteErrorMessage, voteReducer, canTap, type VoteAction, type VoteState } from './votePanel.logic';
import { votesApi, type VotesApi } from './votesApi';

export type VoteSource = 'panel' | 'photo';

interface Check {
  houseId: string;
  photoId: string | null;
  from: VoteSource;
  busy: boolean;
  error: string;
  resetKey: number;
  /** Unique per check, so a stale completion cannot act on a replacement check. */
  id: number;
}
let checkSeq = 0;

const states = new Map<string, VoteState>();
const listeners = new Set<() => void>();
let session: boolean | null = null; // null = not asked yet
let exhausted = false; // uid_daily: session-wide, until reload
let check: Check | null = null; // the one pending first vote waiting for the bot check
let apiP: Promise<VotesApi> | null = null;
const api = () => (apiP ??= votesApi());
/** Bumps on every vote settle (ok or fail); a status read that started before the latest bump is stale. */
let settleSeq = 0;

/** Called with a house's new total whenever its vote store moves (optimistic tap, settle, rollback, server sync),
 *  even with no panel mounted, so the pins, list and map never keep a vote the server refused. */
let pinListener: ((houseId: string, total: number) => void) | null = null;
export function setPinTotalListener(fn: ((houseId: string, total: number) => void) | null) {
  pinListener = fn;
}

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function get(houseId: string, seed: number): VoteState {
  let s = states.get(houseId);
  if (!s) {
    s = { ...initialVoteState(seed), dailyExhausted: exhausted };
    states.set(houseId, s);
  }
  return s;
}

function dispatch(houseId: string, a: VoteAction) {
  const cur = states.get(houseId);
  if (!cur) return;
  const next = voteReducer(cur, a);
  if (next === cur) return;
  states.set(houseId, next);
  if (a.type !== 'seed' && next.total !== cur.total) pinListener?.(houseId, next.total);
  if (next.dailyExhausted && !exhausted) {
    exhausted = true;
    for (const [id, s] of states) if (!s.dailyExhausted) states.set(id, voteReducer(s, { type: 'exhaust' }));
  }
  emit();
}

const idleNow = (houseId: string) => {
  const s = states.get(houseId);
  return !!s && s.queue.length === 0 && !s.inFlight;
};

async function pump(houseId: string) {
  const s = states.get(houseId);
  if (!s) return;
  const photoId = nextToSend(s);
  if (photoId === undefined) return;
  dispatch(houseId, { type: 'send' });
  try {
    const r = await (await api()).voteHouse(houseId, photoId);
    settleSeq++;
    dispatch(houseId, { type: 'ok', total: r.totalVotes, left: r.leftToday });
  } catch (e) {
    const err = toDataError(e);
    settleSeq++;
    if (err.code === 'not_signed_in') session = false; // the next tap shows the bot check again
    dispatch(houseId, { type: 'fail', code: err.code, detail: err.detail, message: voteErrorMessage(err.code, err.detail, userMessage(err)) });
    // The response may have been lost after the vote committed: re-read the server's count once nothing is queued.
    if ((err.code === 'network' || err.code === 'unknown') && idleNow(houseId)) void refresh(houseId);
  }
  void pump(houseId);
}

function accept(houseId: string, photoId: string | null) {
  dispatch(houseId, { type: 'tap', photoId });
  try {
    navigator.vibrate?.(10);
  } catch {
    /* not supported */
  }
  void pump(houseId);
}

async function tap(houseId: string, photoId: string | null, from: VoteSource) {
  const s = states.get(houseId);
  if (!s || !canTap(s) || check) return; // one bot check per pending vote, even across repeated taps
  if (session !== true) session = await (await api()).hasSession().catch(() => false);
  if (!session) {
    check = { houseId, photoId, from, busy: false, error: '', resetKey: 0, id: ++checkSeq };
    emit();
    return;
  }
  accept(houseId, photoId);
}

async function onToken(token: string) {
  const c = check;
  if (!c || c.busy) return;
  check = { ...c, busy: true, error: '' };
  emit();
  try {
    await (await api()).ensureAnonymousSession(token);
    session = true;
    if (check?.id !== c.id) return; // cancelled or replaced meanwhile (sheet closed, house or photo switched): drop the tap
    check = null;
    emit();
    accept(c.houseId, c.photoId);
    void refresh(c.houseId);
  } catch (e) {
    if (check?.id !== c.id) return; // cancelled or replaced meanwhile
    check = { ...c, busy: false, error: userMessage(toDataError(e)), resetKey: c.resetKey + 1 };
    emit();
  }
}

function cancelCheck() {
  if (!check) return;
  check = null;
  emit();
}

/** Server truth for the house on open (only with a session; without one the device has all 5). */
async function refresh(houseId: string) {
  try {
    const a = await api();
    if (session !== true) session = await a.hasSession().catch(() => false);
    if (!session) return;
    const startedAt = settleSeq;
    const r = await a.getMyVoteStatus(houseId);
    if (settleSeq !== startedAt) return; // a vote settled while this read was in flight: its answer is older than the store
    dispatch(houseId, { type: 'sync', total: r.totalVotes, left: r.leftToday });
  } catch (e) {
    if (toDataError(e).code === 'not_signed_in') session = false;
    // Otherwise keep the pin's count and 5 left; a vote will report the real state.
  }
}

/** The shared vote state of one house. `seedTotal` is the pin's count (used until the server answers). */
export function useHouseVotes(houseId: string, seedTotal: number) {
  const state = useSyncExternalStore(
    subscribe,
    () => get(houseId, seedTotal),
    () => get(houseId, seedTotal),
  );
  const checkState = useSyncExternalStore(
    subscribe,
    () => check,
    () => null,
  );
  useEffect(() => {
    dispatch(houseId, { type: 'seed', total: seedTotal });
  }, [houseId, seedTotal]);
  const vote = useCallback((photoId: string | null, from: VoteSource) => void tap(houseId, photoId, from), [houseId]);
  return {
    state,
    /** The pending bot check, if it belongs to this house. */
    check: checkState && checkState.houseId === houseId ? checkState : null,
    vote,
    refresh: useCallback(() => void refresh(houseId), [houseId]),
    onToken,
    cancelCheck,
  };
}

/** Test seam: the open-sheet status read. */
export const _refresh = (houseId: string) => refresh(houseId);

/** Test seams: the module store without React. */
export const _store = {
  tap,
  onToken,
  cancelCheck,
  get: get,
  getCheck: () => check,
  setSession: (v: boolean | null) => {
    session = v;
  },
  reset() {
    states.clear();
    check = null;
    session = null;
    exhausted = false;
    settleSeq = 0;
    pinListener = null;
    apiP = null;
  },
  settle: async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  },
};
