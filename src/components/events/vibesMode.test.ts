import { describe, expect, it } from 'vitest';
import {
  describeAction,
  effectiveState,
  LOADING_BUDGET_MS,
  loadingDeadlineMs,
  handoffStep,
  INITIAL_HANDOFF,
  needsWidget,
  runHandoffActions,
  sheetGates,
  vibesMode,
  type HandoffAction,
  type HandoffEvent,
  type HandoffState,
} from './vibesMode';

const STATES = ['loading', 'ready', 'held', 'stale', 'failed', 'off'] as const;

// AC-L1-03: the full decision table.
describe('vibesMode', () => {
  it('lights is native always and never loads the widget', () => {
    for (const s of STATES) for (const lf of [false, true]) for (const ev of [false, true]) expect(vibesMode('lights', ev, s, lf)).toBe('native');
    expect(needsWidget('lights', true)).toBe(false);
  });
  it('no events capability is native and never loads the widget', () => {
    for (const p of ['shadow', 'vibes'] as const) {
      for (const s of STATES) expect(vibesMode(p, false, s, false)).toBe('native');
      expect(needsWidget(p, false)).toBe(false);
    }
  });
  it('shadow loads the widget but stays native for every state', () => {
    expect(needsWidget('shadow', true)).toBe(true);
    for (const s of STATES) for (const lf of [false, true]) expect(vibesMode('shadow', true, s, lf)).toBe('native');
  });
  it('vibes is the widget while loading or ready, native for held, stale, failed and a loader failure', () => {
    expect(needsWidget('vibes', true)).toBe(true);
    expect(vibesMode('vibes', true, 'loading', false)).toBe('widget');
    expect(vibesMode('vibes', true, 'ready', false)).toBe('widget');
    for (const s of ['held', 'stale', 'failed'] as const) expect(vibesMode('vibes', true, s, false)).toBe('native');
    for (const s of STATES) expect(vibesMode('vibes', true, s, true)).toBe('native');
  });
});

const steady = (mode: 'native' | 'widget'): HandoffState => ({ ...INITIAL_HANDOFF, mode });
const names = (a: HandoffAction[]) => a.map(describeAction);

// AC-L1-17d: the two-phase handoff reducer.
describe('handoffStep', () => {
  it('starts native and steady', () => {
    expect(INITIAL_HANDOFF).toEqual({ mode: 'native', phase: 'steady', pendingOpenId: null, queued: null });
    expect(sheetGates(INITIAL_HANDOFF)).toEqual({ nativeSheetAllowed: true, widgetOwnsSheet: false });
    expect(sheetGates(steady('widget'))).toEqual({ nativeSheetAllowed: false, widgetOwnsSheet: true });
  });

  it('widget -> native: gate the native sheet in R1, then close the panel and hand off in the effect', () => {
    const r1 = handoffStep(steady('widget'), { type: 'target', mode: 'native', nativeOpenId: null });
    expect(r1.state).toMatchObject({ mode: 'native', phase: 'toNative' });
    expect(r1.nativeSheetAllowed).toBe(false);
    expect(r1.widgetOwnsSheet).toBe(false);
    expect(r1.actions).toEqual([]);
    const e = handoffStep(r1.state, { type: 'commit', widgetOpenId: 'W1' });
    expect(names(e.actions)).toEqual(['closeWidget', 'handoff(native, W1)']);
    expect(e.state.phase).toBe('steady');
    expect(e.nativeSheetAllowed).toBe(true);
  });

  it('native -> widget: unmount the native sheet in M1, then open the panel and hand off in the effect', () => {
    const m1 = handoffStep(steady('native'), { type: 'target', mode: 'widget', nativeOpenId: 'X' });
    expect(m1.state).toMatchObject({ mode: 'widget', phase: 'toWidget', pendingOpenId: 'X' });
    expect(m1.nativeSheetAllowed).toBe(false);
    expect(m1.widgetOwnsSheet).toBe(true);
    expect(m1.actions).toEqual([]);
    const e = handoffStep(m1.state, { type: 'commit', widgetOpenId: null });
    expect(names(e.actions)).toEqual(['openWidget(X)', 'handoff(widget, X)']);
    expect(e.state).toMatchObject({ mode: 'widget', phase: 'steady', pendingOpenId: null });
  });

  it('native -> widget with nothing open hands off null', () => {
    const m1 = handoffStep(steady('native'), { type: 'target', mode: 'widget', nativeOpenId: null });
    const e = handoffStep(m1.state, { type: 'commit', widgetOpenId: null });
    expect(names(e.actions)).toEqual(['handoff(widget, null)']);
  });

  it('a failed open hands off null', () => {
    const m1 = handoffStep(steady('native'), { type: 'target', mode: 'widget', nativeOpenId: 'X' });
    const e = handoffStep(m1.state, { type: 'commit', widgetOpenId: null });
    const log: string[] = [];
    runHandoffActions(e.actions, {
      close: () => log.push('close'),
      open: (id) => (log.push(`open ${id}`), false),
      handoff: (h) => log.push(`handoff(${h.to}, ${h.openId})`),
      select: () => log.push('select'),
    });
    expect(log).toEqual(['open X', 'handoff(widget, null)']);
    const ok: string[] = [];
    runHandoffActions(e.actions, { close: () => {}, open: () => true, handoff: (h) => ok.push(`handoff(${h.to}, ${h.openId})`), select: () => {} });
    expect(ok).toEqual(['handoff(widget, X)']);
  });

  it('no mode change and a commit while steady produce no actions', () => {
    for (const m of ['native', 'widget'] as const) {
      const same = handoffStep(steady(m), { type: 'target', mode: m, nativeOpenId: 'X' });
      expect(same.actions).toEqual([]);
      expect(same.state).toEqual(steady(m));
      expect(handoffStep(steady(m), { type: 'commit', widgetOpenId: 'X' }).actions).toEqual([]);
    }
  });

  it('a select while steady runs at once; during a handoff it is queued (last wins) and emitted once after steady', () => {
    expect(names(handoffStep(steady('widget'), { type: 'select', id: 'a' }).actions)).toEqual(['select(a)']);
    for (const [from, to] of [['widget', 'native'], ['native', 'widget']] as const) {
      let s = handoffStep(steady(from), { type: 'target', mode: to, nativeOpenId: null }).state;
      const q1 = handoffStep(s, { type: 'select', id: 'a' });
      expect(q1.actions).toEqual([]);
      s = handoffStep(q1.state, { type: 'select', id: 'b' }).state;
      expect(s.queued).toBe('b');
      const e = handoffStep(s, { type: 'commit', widgetOpenId: null });
      const sel = names(e.actions).filter((n) => n.startsWith('select'));
      expect(sel).toEqual(['select(b)']);
      expect(names(e.actions).at(-1)).toBe('select(b)'); // after the handoff
      expect(e.state.queued).toBeNull();
      expect(handoffStep(e.state, { type: 'commit', widgetOpenId: null }).actions).toEqual([]);
    }
  });

  it('a flip back before the effect returns to steady without closing or opening anything', () => {
    const r1 = handoffStep(steady('widget'), { type: 'target', mode: 'native', nativeOpenId: null });
    const back = handoffStep(r1.state, { type: 'target', mode: 'widget', nativeOpenId: null });
    expect(back.state).toMatchObject({ mode: 'widget', phase: 'steady' });
    expect(back.actions).toEqual([]);
    const m1 = handoffStep(steady('native'), { type: 'target', mode: 'widget', nativeOpenId: 'X' });
    const back2 = handoffStep(m1.state, { type: 'target', mode: 'native', nativeOpenId: null });
    expect(back2.state).toMatchObject({ mode: 'native', phase: 'steady', pendingOpenId: null });
    expect(back2.nativeSheetAllowed).toBe(true);
  });

  it('never closes the widget in a step whose committed state allowed the native sheet; never opens before the gate closed', () => {
    // Walk every event sequence of length <= 5 and check the ordering invariants on each step.
    const events: HandoffEvent[] = [
      { type: 'target', mode: 'native', nativeOpenId: 'X' },
      { type: 'target', mode: 'widget', nativeOpenId: 'X' },
      { type: 'commit', widgetOpenId: 'W' },
      { type: 'select', id: 's' },
    ];
    const walk = (s: HandoffState, depth: number) => {
      if (depth === 0) return;
      for (const ev of events) {
        const before = sheetGates(s);
        const step = handoffStep(s, ev);
        const n = names(step.actions);
        if (n.includes('closeWidget')) {
          expect(before.nativeSheetAllowed).toBe(false); // the committed DOM had no native sheet
          expect(step.nativeSheetAllowed).toBe(true); // it may mount only in the next render
        }
        if (n.some((x) => x.startsWith('openWidget'))) expect(before.nativeSheetAllowed).toBe(false);
        walk(step.state, depth - 1);
      }
    };
    walk(steady('native'), 5);
    walk(steady('widget'), 5);
  });
});

// Review P2: the empty loading phase is bounded at 5 s from page start, not by the widget's own API timeouts.
describe('loading budget', () => {
  it('is 5 s from page start', () => {
    expect(LOADING_BUDGET_MS).toBe(5000);
    expect(loadingDeadlineMs(0)).toBe(5000);
    expect(loadingDeadlineMs(1200)).toBe(3800);
    expect(loadingDeadlineMs(7000)).toBe(0);
  });
  it('turns a still-loading widget into the native UI once the budget is spent, and only loading', () => {
    expect(effectiveState('loading', false)).toBe('loading');
    expect(effectiveState('loading', true)).toBe('failed');
    for (const s of ['ready', 'held', 'stale', 'failed', 'off'] as const) expect(effectiveState(s, true)).toBe(s);
    expect(vibesMode('vibes', true, effectiveState('loading', true), false)).toBe('native');
    expect(vibesMode('vibes', true, effectiveState('ready', true), false)).toBe('widget'); // recovery once ready
  });
});
