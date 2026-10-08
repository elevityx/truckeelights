// Pure state for the Add photos sheet (no DOM, no data layer), unit-tested in flow.test.ts.
import type { AddPhotosProgress, AddPhotosResult, DataErrorCode } from '@/lib/data/types';

export const MAX_PER_BATCH = 3;

export type ItemStage = 'ready' | 'resizing' | 'uploading' | 'done' | 'failed';
export interface Item {
  id: number;
  file: File;
  /** object URL for the preview; the component creates and revokes it */
  url: string;
  stage: ItemStage;
  error?: DataErrorCode;
}

export type Outcome =
  | { kind: 'thanks'; pending: number }
  | { kind: 'partial'; pending: number; failed: number; code: DataErrorCode }
  | { kind: 'overcap'; pending: number }
  | { kind: 'failed'; code: DataErrorCode };

export interface State {
  phase: 'pick' | 'uploading' | 'result';
  items: Item[];
  nextId: number;
  /** files ignored by the last pick because the batch was full */
  dropped: number;
  /** a pre-upload or retryable error code, shown on the pick screen */
  error: DataErrorCode | null;
  outcome: Outcome | null;
  /** bumps to remount the bot check after captcha_failed */
  captchaKey: number;
}

export type Action =
  | { type: 'add'; files: { file: File; url: string }[]; dropped?: number }
  | { type: 'remove'; id: number }
  | { type: 'start' }
  | { type: 'progress'; p: AddPhotosProgress }
  | { type: 'finish'; result: AddPhotosResult }
  | { type: 'fail'; code: DataErrorCode }
  | { type: 'retry' };

export const initialState: State = { phase: 'pick', items: [], nextId: 1, dropped: 0, error: null, outcome: null, captchaKey: 0 };

/** Keep the first files that fit in the batch; report how many were left out. */
export function takeUpTo<T>(have: number, incoming: readonly T[], max = MAX_PER_BATCH): { kept: T[]; dropped: number } {
  const room = Math.max(0, max - have);
  const kept = incoming.slice(0, room);
  return { kept, dropped: incoming.length - kept.length };
}

/** Image files only (some browsers report HEIC with an empty type, so allow that and let the resize decide). */
export function isPickable(f: { type: string }): boolean {
  return f.type === '' || f.type.startsWith('image/');
}

/** Errors where trying the same batch again right away won't help. */
export function isFinal(code: DataErrorCode): boolean {
  return code === 'photos_closed' || code === 'rate_limited';
}

const STAGE_WEIGHT: Record<ItemStage, number> = { ready: 0, resizing: 0.15, uploading: 0.55, done: 1, failed: 1 };

/** Overall progress 0–100 across the batch. */
export function overallPct(items: readonly Item[]): number {
  if (!items.length) return 0;
  const sum = items.reduce((a, it) => a + STAGE_WEIGHT[it.stage], 0);
  return Math.round((sum / items.length) * 100);
}

/** Pick the result screen from the counts and the first per-file error. */
export function outcomeOf(r: AddPhotosResult, firstError: DataErrorCode | undefined): Outcome {
  if (r.overCap > 0) return { kind: 'overcap', pending: r.pending };
  if (r.failed > 0 && r.pending === 0) return { kind: 'failed', code: firstError ?? 'unknown' };
  if (r.failed > 0) return { kind: 'partial', pending: r.pending, failed: r.failed, code: firstError ?? 'unknown' };
  return { kind: 'thanks', pending: r.pending };
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add': {
      if (s.phase !== 'pick') return s;
      const { kept, dropped } = takeUpTo(s.items.length, a.files);
      const items = [...s.items, ...kept.map((f, i) => ({ id: s.nextId + i, file: f.file, url: f.url, stage: 'ready' as const }))];
      return { ...s, items, nextId: s.nextId + kept.length, dropped: dropped + (a.dropped ?? 0), error: null };
    }
    case 'remove':
      if (s.phase !== 'pick') return s;
      return { ...s, items: s.items.filter((it) => it.id !== a.id), dropped: 0 };
    case 'start':
      if (s.phase !== 'pick' || !s.items.length) return s;
      return { ...s, phase: 'uploading', error: null, dropped: 0, items: s.items.map((it) => ({ ...it, stage: 'ready', error: undefined })) };
    case 'progress': {
      if (s.phase !== 'uploading') return s;
      const it = s.items[a.p.index];
      if (!it) return s;
      const items = s.items.slice();
      items[a.p.index] = { ...it, stage: a.p.stage, error: a.p.error };
      return { ...s, items };
    }
    case 'finish': {
      if (s.phase !== 'uploading') return s;
      const first = s.items.find((it) => it.stage === 'failed')?.error;
      return { ...s, phase: 'result', outcome: outcomeOf(a.result, first) };
    }
    case 'fail':
      // Before any file was sent (session / bot check): back to the picker with the message.
      return {
        ...s,
        phase: 'pick',
        error: a.code,
        captchaKey: a.code === 'captcha_failed' ? s.captchaKey + 1 : s.captchaKey,
        items: s.items.map((it) => ({ ...it, stage: 'ready', error: undefined })),
      };
    case 'retry':
      // Keep only the photos that didn't go through.
      return {
        ...s,
        phase: 'pick',
        outcome: null,
        error: null,
        items: s.items.filter((it) => it.stage !== 'done').map((it) => ({ ...it, stage: 'ready', error: undefined })),
      };
  }
}

/** Items a retry would drop (sent ones), so the component can revoke their object URLs. */
export function sentItems(s: State): Item[] {
  return s.items.filter((it) => it.stage === 'done');
}
