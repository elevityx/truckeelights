// Pure decisions for the TruckeeVibes widget integration (Spec_Vibes_Widget L1.1): which UI shows events, and the two-phase
// handoff that keeps at most one event sheet (native EventSheet or the widget panel) in every committed DOM state.
import type { EventsProvider } from '@/config/public-env';
import type { State } from './vibes';

export type Mode = 'native' | 'widget';

/** The widget script is loaded only for shadow/vibes and only when the region context has `events` (invariant 14/17). */
export function needsWidget(provider: EventsProvider, hasEvents: boolean): boolean {
  return hasEvents && (provider === 'shadow' || provider === 'vibes');
}

/** Plan §3.3 S1-S3: the widget shows only while it is loading (<= 5 s) or ready; anything else is the native UI. */
export function vibesMode(provider: EventsProvider, hasEvents: boolean, state: State | 'off', loaderFailed: boolean): Mode {
  if (provider !== 'vibes' || !hasEvents || loaderFailed) return 'native';
  return state === 'loading' || state === 'ready' ? 'widget' : 'native';
}

// ---- handoff reducer -----------------------------------------------------------------------------------

export type Phase = 'steady' | 'toNative' | 'toWidget';
export interface HandoffState {
  mode: Mode;
  phase: Phase;
  /** native -> widget: the id of the native sheet that was open, reopened in the widget after the native sheet unmounted. */
  pendingOpenId: string | null;
  /** A select (row or pin tap) that arrived during a handoff; last one wins, replayed once the phase is steady. */
  queued: string | null;
}
export const INITIAL_HANDOFF: HandoffState = { mode: 'native', phase: 'steady', pendingOpenId: null, queued: null };

export type HandoffEvent =
  /** Render time: the mode vibesMode() returns now; nativeOpenId = the open native sheet's id in the previous render. */
  | { type: 'target'; mode: Mode; nativeOpenId: string | null }
  /** The effect after a transition render's commit; widgetOpenId = controller.openId(). */
  | { type: 'commit'; widgetOpenId: string | null }
  | { type: 'select'; id: string };

export type HandoffAction =
  | { kind: 'closeWidget' }
  | { kind: 'openWidget'; id: string }
  /** For `to: 'widget'` after an openWidget, the executor sends openId null when that open returned false. */
  | { kind: 'handoff'; to: Mode; openId: string | null }
  | { kind: 'select'; id: string };

export interface HandoffStep {
  state: HandoffState;
  actions: HandoffAction[];
  nativeSheetAllowed: boolean;
  widgetOwnsSheet: boolean;
}

/** nativeSheetAllowed: the host may render the native EventSheet. widgetOwnsSheet: the widget panel is (or is about to be) the sheet. */
export function sheetGates(s: HandoffState): { nativeSheetAllowed: boolean; widgetOwnsSheet: boolean } {
  if (s.phase === 'toNative') return { nativeSheetAllowed: false, widgetOwnsSheet: false };
  if (s.phase === 'toWidget') return { nativeSheetAllowed: false, widgetOwnsSheet: true };
  return s.mode === 'native' ? { nativeSheetAllowed: true, widgetOwnsSheet: false } : { nativeSheetAllowed: false, widgetOwnsSheet: true };
}

const step = (state: HandoffState, actions: HandoffAction[] = []): HandoffStep => ({ state, actions, ...sheetGates(state) });

export function handoffStep(prev: HandoffState, ev: HandoffEvent): HandoffStep {
  switch (ev.type) {
    case 'target': {
      if (ev.mode === prev.mode) return step(prev);
      if (prev.phase !== 'steady') {
        // Flipped back before the effect ran: nothing was closed or opened yet, so the previous sheet owner simply stays.
        // A queued select stays queued and is replayed by the next commit step (render time runs no actions).
        return step({ mode: ev.mode, phase: 'steady', pendingOpenId: null, queued: prev.queued });
      }
      if (ev.mode === 'native') return step({ mode: 'native', phase: 'toNative', pendingOpenId: null, queued: prev.queued });
      return step({ mode: 'widget', phase: 'toWidget', pendingOpenId: ev.nativeOpenId, queued: prev.queued });
    }
    case 'commit': {
      if (prev.phase === 'steady') return prev.queued ? step({ ...prev, queued: null }, [{ kind: 'select', id: prev.queued }]) : step(prev);
      const actions: HandoffAction[] =
        prev.phase === 'toNative'
          ? [{ kind: 'closeWidget' }, { kind: 'handoff', to: 'native', openId: ev.widgetOpenId }]
          : prev.pendingOpenId
            ? [{ kind: 'openWidget', id: prev.pendingOpenId }, { kind: 'handoff', to: 'widget', openId: prev.pendingOpenId }]
            : [{ kind: 'handoff', to: 'widget', openId: null }];
      if (prev.queued) actions.push({ kind: 'select', id: prev.queued });
      return step({ mode: prev.mode, phase: 'steady', pendingOpenId: null, queued: null }, actions);
    }
    case 'select':
      if (prev.phase === 'steady') return step(prev, [{ kind: 'select', id: ev.id }]);
      return step({ ...prev, queued: ev.id });
  }
}

export function describeAction(a: HandoffAction): string {
  switch (a.kind) {
    case 'closeWidget':
      return 'closeWidget';
    case 'openWidget':
      return `openWidget(${a.id})`;
    case 'handoff':
      return `handoff(${a.to}, ${a.openId})`;
    case 'select':
      return `select(${a.id})`;
  }
}

export interface HandoffPorts {
  close(): void;
  open(id: string): boolean;
  handoff(h: { to: Mode; openId: string | null }): void;
  select(id: string): void;
}

/** Runs a step's actions in order; a widget handoff after a failed openWidget carries openId null. */
export function runHandoffActions(actions: HandoffAction[], ports: HandoffPorts): void {
  let opened = true;
  for (const a of actions) {
    if (a.kind === 'closeWidget') ports.close();
    else if (a.kind === 'openWidget') opened = ports.open(a.id);
    else if (a.kind === 'handoff') ports.handoff({ to: a.to, openId: a.to === 'widget' && !opened ? null : a.openId });
    else ports.select(a.id);
  }
}
