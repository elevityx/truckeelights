'use client';

// The page's link to the TruckeeVibes widget (Spec_Vibes_Widget L1.1, r3). One controller per page after `ctx`, destroyed on unmount.
// `lights` (or no `events` capability) never loads the script. `shadow` runs a headless controller and only logs a comparison.
// `vibes` shows the widget while it is loading or ready, else the native UI; every switch is a two-phase handoff (vibesMode.ts)
// across a React commit, so the native EventSheet and the widget panel are never both in the DOM.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EventsProvider } from '@/config/public-env';
import { eventBounds } from '@/lib/data/events';
import type { PublicEvent, RegionContext } from '@/lib/data/types';
import { notEnded } from '@/lib/time/pacific';
import { loadVibesWidget, type Controller, type State, type WidgetEvent } from './vibes';
import { effectiveState, handoffStep, INITIAL_HANDOFF, loadingDeadlineMs, needsWidget, runHandoffActions, sheetGates, vibesMode, type HandoffState, type Phase } from './vibesMode';

// useLayoutEffect warns during the static prerender; it only matters in the browser.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type Handoff = { to: 'native' | 'widget'; openId: string | null };
export interface VibesHooks {
  onOpen(id: string): void;
  onClose(id: string): void;
  onShare(e: PublicEvent): void;
  onHandoff(h: Handoff): void;
}
export interface UseVibesInput {
  ctx: RegionContext | null;
  provider: EventsProvider;
  /** The page's native list (null until loaded): the shadow comparison's input and the native fallback. */
  nativeEvents: PublicEvent[] | null;
  /** The host's own selection: `sheet === 'event' ? eventId : null`. */
  hostOpenEventId: string | null;
  hooks: VibesHooks;
}
export interface UseVibesResult {
  mode: 'native' | 'widget';
  controller: Controller | null;
  events: PublicEvent[];
  state: State | 'off';
  /** The host renders the native <EventSheet> only when true. */
  nativeSheetAllowed: boolean;
  /** True while the widget panel is (or is about to be) the event sheet. */
  widgetOwnsSheet: boolean;
  /** Runs `fn` now, or (during a handoff) once the handoff is done; the last one queued wins. For row and pin taps. */
  whenSteady(fn: () => void): void;
}

/** The widget's event as Lights' PublicEvent (the map, counts and Add-event dedupe use it). */
export function toPublicEvent(e: WidgetEvent): PublicEvent {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    venue: e.venue,
    address: e.address,
    lat: e.lat,
    lng: e.lng,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    url: e.url,
    adultsOnly: e.adultsOnly,
  };
}

/** C1 shadow comparison: counts only (missing = native - widget, extra = widget - native), both after notEnded(now). */
export function shadowCounts(native: PublicEvent[], widget: PublicEvent[], now: number) {
  const n = new Set(native.filter((e) => notEnded(e, now)).map((e) => e.id));
  const w = new Set(widget.filter((e) => notEnded(e, now)).map((e) => e.id));
  let missing = 0;
  let extra = 0;
  n.forEach((id) => !w.has(id) && missing++);
  w.forEach((id) => !n.has(id) && extra++);
  return { lights: n.size, vibes: w.size, missing, extra };
}

export function useVibes(input: UseVibesInput): UseVibesResult {
  const { ctx, provider, nativeEvents, hostOpenEventId, hooks } = input;
  const hasEvents = !!ctx?.events;
  const active = needsWidget(provider, hasEvents);

  const hooksRef = useRef(hooks);
  const nativeRef = useRef(nativeEvents);
  const phaseRef = useRef<Phase>('steady');
  const queuedFn = useRef<(() => void) | null>(null);
  const [controller, setController] = useState<Controller | null>(null);
  const controllerRef = useRef<Controller | null>(null);
  const [wState, setWState] = useState<State>('loading');
  const [loaderFailed, setLoaderFailed] = useState(false);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [hs, setHs] = useState<HandoffState>(INITIAL_HANDOFF);
  const [deadlinePassed, setDeadlinePassed] = useState(false);

  useIsoLayoutEffect(() => {
    hooksRef.current = hooks;
    nativeRef.current = nativeEvents;
    controllerRef.current = controller;
    phaseRef.current = hs.phase;
  });

  // The controller: created once per page after ctx, destroyed on unmount. No script at all unless shadow/vibes and `events`.
  useEffect(() => {
    if (!active || !ctx) return;
    let cancelled = false;
    let c: Controller | null = null;
    const offs: (() => void)[] = [];
    loadVibesWidget(document, window).then(
      (g) => {
        if (cancelled) return;
        try {
          c = g.createController({
            season: ctx.season,
            year: ctx.year,
            tz: ctx.region.timezone,
            localBox: eventBounds(ctx.region),
            headless: provider === 'shadow',
            onShare: (e) => hooksRef.current.onShare(toPublicEvent(e)),
          });
        } catch {
          setLoaderFailed(true);
          return;
        }
        const cc = c;
        offs.push(
          cc.on('events', (evs) => {
            const pub = evs.map(toPublicEvent);
            setEvents(pub);
            const native = nativeRef.current;
            if (provider === 'shadow' && native && cc.state === 'ready') {
              const k = shadowCounts(native, pub, Date.now());
              console.info(`tv-shadow lights=${k.lights} vibes=${k.vibes} missing=${k.missing} extra=${k.extra}`);
              document.documentElement.dataset.tvShadow = `missing=${k.missing} extra=${k.extra} state=${cc.state}`;
            }
          }),
          cc.on('state', (s) => setWState(s)),
          // Emits caused by a handoff's own close/open are not host actions (the handoff reports them).
          cc.on('open', (id) => phaseRef.current === 'steady' && hooksRef.current.onOpen(id)),
          cc.on('close', (id) => phaseRef.current === 'steady' && hooksRef.current.onClose(id)),
        );
        setController(cc);
      },
      () => {
        if (!cancelled) setLoaderFailed(true);
      },
    );
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      c?.destroy();
    };
  }, [active, ctx, provider]);

  // The 5 s loading budget runs from page start, whatever the script or the API pages take; the controller stays alive, so a
  // later `ready` still switches to the widget (a normal native -> widget handoff).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setDeadlinePassed(true), loadingDeadlineMs(performance.now()));
    return () => clearTimeout(t);
  }, [active]);

  const state: State | 'off' = !active ? 'off' : loaderFailed ? 'failed' : effectiveState(wState, deadlinePassed);
  const target = vibesMode(provider, hasEvents, state, loaderFailed);
  let cur = hs;
  if (target !== hs.mode) {
    // R1 / M1: the first render with the new mode also enters the handoff phase (React re-renders before committing).
    const nativeOpenId = sheetGates(hs).widgetOwnsSheet ? null : hostOpenEventId;
    cur = handoffStep(hs, { type: 'target', mode: target, nativeOpenId }).state;
    setHs(cur);
  }

  // The effect after a transition render's commit is the boundary: close the panel (to native) or open it (to widget) only now,
  // then return to steady and hand off in the same batch; a tap queued meanwhile is replayed after.
  useEffect(() => {
    if (hs.phase === 'steady' && !hs.queued) return;
    const c = controllerRef.current;
    const s = handoffStep(hs, { type: 'commit', widgetOpenId: c?.openId() ?? null });
    runHandoffActions(s.actions, {
      close: () => c?.close(),
      open: (id) => c?.open(id) ?? false,
      handoff: (h) => hooksRef.current.onHandoff(h),
      select: () => {
        phaseRef.current = 'steady';
        const fn = queuedFn.current;
        queuedFn.current = null;
        fn?.();
      },
    });
    phaseRef.current = s.state.phase;
    // The commit boundary of the handoff (spec r3): the phase returns to steady here, in the same batch as onHandoff.
    // A tap queued after this effect's render (prev !== hs) keeps its slot; the next run of this effect replays it.
    setHs((prev) => (prev === hs ? s.state : { ...s.state, queued: prev.queued }));
  }, [hs]);

  const whenSteady = useCallback((fn: () => void) => {
    if (phaseRef.current === 'steady') return fn();
    queuedFn.current = fn;
    setHs((s) => handoffStep(s, { type: 'select', id: 'tap' }).state);
  }, []);

  const gates = sheetGates(cur);
  return { mode: cur.mode, controller, events, state, ...gates, whenSteady };
}
