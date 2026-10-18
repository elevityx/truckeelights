// The TruckeeVibes events widget (Spec_Vibes_Widget L1.1): one SRI-pinned release file from truckeevibes.com, loaded only when
// get_region_context returns `events` and NEXT_PUBLIC_EVENTS_PROVIDER is shadow/vibes (AGENTS.md invariant 17). A bump is a new
// file + manifest entry on TruckeeVibes and a PR here changing both values together (old files stay forever).
import type { Season } from '@/lib/data/types';

export const VIBES_WIDGET = {
  src: 'https://truckeevibes.com/widget/v1/tv-events.1.0.2.js',
  integrity: 'sha384-06AtMAD0fZ9RvtXu5+HeN2H5CXd+oR+W5SvNEoZWuoXH3P0hlQvOpCTVJsXi4ZD1',
} as const;

// ---- public types, copied from TruckeeVibes widget/src/types.ts (v1) ----
export interface Box { minLat: number; maxLat: number; minLng: number; maxLng: number }
export interface WidgetEvent {
  id: string; title: string; description: string; venue: string | null; address: string; lat: number; lng: number;
  startsAt: string; endsAt: string | null; url: string | null; adultsOnly: boolean;
  origin: 'lights' | 'vibes'; formerIds: string[]; pageUrl: string | null; allDay: boolean; startDate: string | null;
  endDate: string | null; timeKnown: boolean;
}
export type State = 'loading' | 'ready' | 'held' | 'stale' | 'failed';
export interface StateInfo { note: string | null; dataAt: string | null; confirmedAt: string | null }
export interface ControllerOptions {
  season: Season; year: number; tz: string; localBox: Box;
  endpoint?: string;
  headless?: boolean;
  onShare?(e: WidgetEvent): void;
  now?(): number; fetch?: typeof fetch;
}
export interface Controller {
  on(ev: 'events', fn: (evs: WidgetEvent[]) => void): () => void;
  on(ev: 'state', fn: (s: State, info: StateInfo) => void): () => void;
  on(ev: 'open' | 'close', fn: (id: string) => void): () => void;
  mountList(el: HTMLElement, o?: { onAdd?(): void }): () => void;
  mountUpcoming(el: HTMLElement, o: { onAdd?(): void; onSeeAll(): void }): () => void;
  open(id: string): boolean; close(): void; isOpen(): boolean; openId(): string | null; refresh(): Promise<void>; destroy(): void;
  readonly state: State; readonly events: readonly WidgetEvent[];
}
export interface VibesGlobal { version: string; createController(o: ControllerOptions): Controller }

let memo: Promise<VibesGlobal> | null = null;

/** Test hook: forget the memoized load. */
export function resetVibesLoader(): void {
  memo = null;
}

/**
 * Appends one `<script async src integrity crossorigin=anonymous referrerpolicy>` (memoized per page). Rejects on the script's
 * error event (network failure or SRI mismatch), on timeout, when `window.TruckeeVibes` is missing, or on a major version other than 1.
 */
export function loadVibesWidget(doc: Document, win: Window, timeoutMs = 5000): Promise<VibesGlobal> {
  if (memo) return memo;
  memo = new Promise<VibesGlobal>((resolve, reject) => {
    const s = doc.createElement('script');
    let done = false;
    const finish = (err: Error | null, g?: VibesGlobal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(g!);
    };
    const timer = setTimeout(() => finish(new Error('tv_timeout')), timeoutMs);
    s.addEventListener('error', () => finish(new Error('tv_load')));
    s.addEventListener('load', () => {
      const g = (win as unknown as { TruckeeVibes?: VibesGlobal }).TruckeeVibes;
      if (!g || typeof g.createController !== 'function' || typeof g.version !== 'string') return finish(new Error('tv_global'));
      if (g.version.split('.')[0] !== '1') return finish(new Error('tv_version'));
      finish(null, g);
    });
    s.async = true;
    s.src = VIBES_WIDGET.src;
    s.setAttribute('integrity', VIBES_WIDGET.integrity);
    s.setAttribute('crossorigin', 'anonymous');
    s.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    doc.head.appendChild(s);
  });
  return memo;
}
