import { describe, expect, it } from 'vitest';
import { initialState, isFinal, isPickable, outcomeOf, overallPct, reducer, takeUpTo, type State } from './flow';

const f = (name: string) => ({ file: { name } as unknown as File, url: `blob:${name}` });
const pick = (s: State, ...names: string[]) => reducer(s, { type: 'add', files: names.map(f) });

describe('batch limits', () => {
  it('keeps the first 3 of 5', () => {
    expect(takeUpTo(0, [1, 2, 3, 4, 5])).toEqual({ kept: [1, 2, 3], dropped: 2 });
  });
  it('fills only the room left', () => {
    expect(takeUpTo(2, ['a', 'b'])).toEqual({ kept: ['a'], dropped: 1 });
    expect(takeUpTo(3, ['a'])).toEqual({ kept: [], dropped: 1 });
  });
  it('picks across two choices up to 3 and reports the dropped count', () => {
    let s = pick(initialState, 'a', 'b');
    s = pick(s, 'c', 'd', 'e');
    expect(s.items.map((i) => i.url)).toEqual(['blob:a', 'blob:b', 'blob:c']);
    expect(s.dropped).toBe(2);
    expect(new Set(s.items.map((i) => i.id)).size).toBe(3);
  });
  it('frees a slot on remove', () => {
    let s = pick(initialState, 'a', 'b', 'c');
    s = reducer(s, { type: 'remove', id: s.items[1].id });
    s = pick(s, 'd');
    expect(s.items.map((i) => i.url)).toEqual(['blob:a', 'blob:c', 'blob:d']);
    expect(s.dropped).toBe(0);
  });
  it('accepts images and empty types only', () => {
    expect(isPickable({ type: 'image/heic' })).toBe(true);
    expect(isPickable({ type: '' })).toBe(true);
    expect(isPickable({ type: 'application/pdf' })).toBe(false);
  });
});

describe('state machine', () => {
  it('does not start with nothing picked', () => {
    expect(reducer(initialState, { type: 'start' }).phase).toBe('pick');
  });

  it('pick → uploading → result (thanks)', () => {
    let s = reducer(pick(initialState, 'a', 'b'), { type: 'start' });
    expect(s.phase).toBe('uploading');
    expect(pick(s, 'c')).toBe(s); // no picking mid-upload
    s = reducer(s, { type: 'progress', p: { index: 0, total: 2, stage: 'uploading' } });
    expect(s.items[0].stage).toBe('uploading');
    expect(overallPct(s.items)).toBe(28);
    s = reducer(s, { type: 'progress', p: { index: 0, total: 2, stage: 'done' } });
    s = reducer(s, { type: 'progress', p: { index: 1, total: 2, stage: 'done' } });
    expect(overallPct(s.items)).toBe(100);
    s = reducer(s, { type: 'finish', result: { pending: 2, overCap: 0, failed: 0 } });
    expect(s.phase).toBe('result');
    expect(s.outcome).toEqual({ kind: 'thanks', pending: 2 });
  });

  it('rate limited after one: partial outcome, retry keeps only the unsent photos', () => {
    let s = reducer(pick(initialState, 'a', 'b', 'c'), { type: 'start' });
    s = reducer(s, { type: 'progress', p: { index: 0, total: 3, stage: 'done' } });
    s = reducer(s, { type: 'progress', p: { index: 1, total: 3, stage: 'failed', error: 'rate_limited' } });
    s = reducer(s, { type: 'progress', p: { index: 2, total: 3, stage: 'failed', error: 'rate_limited' } });
    s = reducer(s, { type: 'finish', result: { pending: 1, overCap: 0, failed: 2 } });
    expect(s.outcome).toEqual({ kind: 'partial', pending: 1, failed: 2, code: 'rate_limited' });
    s = reducer(s, { type: 'retry' });
    expect(s.phase).toBe('pick');
    expect(s.items.map((i) => [i.url, i.stage])).toEqual([
      ['blob:b', 'ready'],
      ['blob:c', 'ready'],
    ]);
  });

  it('all failed: failed outcome with the first error', () => {
    let s = reducer(pick(initialState, 'a'), { type: 'start' });
    s = reducer(s, { type: 'progress', p: { index: 0, total: 1, stage: 'failed', error: 'photos_closed' } });
    s = reducer(s, { type: 'finish', result: { pending: 0, overCap: 0, failed: 1 } });
    expect(s.outcome).toEqual({ kind: 'failed', code: 'photos_closed' });
    expect(isFinal('photos_closed')).toBe(true);
    expect(isFinal('rate_limited')).toBe(true);
    expect(isFinal('invalid_image')).toBe(false);
  });

  it('captcha_failed goes back to pick and bumps the bot check key', () => {
    let s = reducer(pick(initialState, 'a'), { type: 'start' });
    s = reducer(s, { type: 'fail', code: 'captcha_failed' });
    expect(s.phase).toBe('pick');
    expect(s.error).toBe('captcha_failed');
    expect(s.captchaKey).toBe(1);
    expect(reducer(s, { type: 'fail', code: 'network' }).captchaKey).toBe(1);
  });

  it('ignores progress for an unknown index and outside the upload phase', () => {
    const s = reducer(pick(initialState, 'a'), { type: 'start' });
    expect(reducer(s, { type: 'progress', p: { index: 5, total: 1, stage: 'done' } })).toBe(s);
    const p = pick(initialState, 'a');
    expect(reducer(p, { type: 'progress', p: { index: 0, total: 1, stage: 'done' } })).toBe(p);
  });
});

describe('outcomeOf', () => {
  it('over cap wins', () => {
    expect(outcomeOf({ pending: 1, overCap: 1, failed: 1 }, 'invalid_image')).toEqual({ kind: 'overcap', pending: 1 });
  });
  it('defaults the code to unknown', () => {
    expect(outcomeOf({ pending: 0, overCap: 0, failed: 1 }, undefined)).toEqual({ kind: 'failed', code: 'unknown' });
  });
});

describe('add with a pre-trimmed pick', () => {
  it('adds the caller-reported dropped count', () => {
    const s = reducer(initialState, { type: 'add', files: [f('a'), f('b'), f('c')], dropped: 4 });
    expect(s.items).toHaveLength(3);
    expect(s.dropped).toBe(4);
  });
});
