'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { publicEnv } from '@/config/public-env';
import type { PinView, PublicEvent, Season } from '@/lib/data/types';
import { firstSegment } from '@/lib/text/address';
import type { Point } from '@/lib/route/geo';
import type { TravelMode } from '@/lib/route/mapsUrl';
import { orderStops } from '@/lib/route/order';
import {
  MAX_STOPS,
  NEARBY_MAX,
  ROUTE_PARAM,
  droppedToast,
  loadStops,
  moveStop,
  nearbyHouses,
  parseRouteParam,
  pruneStops,
  routeKey,
  routeShareUrl,
  saveStops,
  shareDecision,
  toggleStop,
  type Stop,
  type StopKind,
} from '@/lib/route/stops';
import { shareOrCopy, shareToast } from '@/lib/share/urls';

const localStore = () => window.localStorage; // may throw; stops.ts catches

/** A stop joined with what the map shows for it. */
export interface RouteStopView {
  kind: StopKind;
  id: string;
  lat: number;
  lng: number;
  title: string;
  sub: string;
}

type Geo = { status: 'unknown' } | { status: 'ok'; p: Point } | { status: 'denied' };

/** One-shot position; never watched, never stored, never sent anywhere but the Google Maps link. */
function currentPosition(): Promise<Point | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

export const defaultMode = (season: Season): TravelMode => (season === 'halloween' ? 'walking' : 'driving');

interface Args {
  season: Season | null;
  pins: PinView[];
  events: PublicEvent[];
  toast(msg: string): void;
  /** The map camera's center, when there is a map. */
  mapCenter(): Point | null;
  /** The region's center: the last fallback for Nearby houses. */
  regionCenter: Point | null;
}

export function useRoute({ season, pins, events, toast, mapCenter, regionCenter }: Args) {
  const [stops, setStops] = useState<Stop[]>([]);
  const [incoming, setIncoming] = useState<Stop[] | null>(null);
  const [mode, setMode] = useState<TravelMode>('walking');
  const [geo, setGeo] = useState<Geo>({ status: 'unknown' });
  const [busy, setBusy] = useState<'order' | 'nearby' | null>(null);
  const keyRef = useRef<string | null>(null);
  const stopsRef = useRef<Stop[]>([]);

  const commit = useCallback((next: Stop[]) => {
    stopsRef.current = next;
    setStops(next);
    if (keyRef.current) saveStops(keyRef.current, next, localStore);
  }, []);

  /**
   * Call once the season's houses and events are loaded. Restores the saved route (dropping stops that are no longer
   * public) and reads a shared `?route=` link. Returns true when the route panel should open.
   */
  const init = useCallback(
    (s: Season, y: number, livePins: PinView[], liveEvents: PublicEvent[], search: string): boolean => {
      keyRef.current = routeKey(s, y);
      setMode(defaultMode(s));
      const live = { houses: new Set(livePins.map((p) => p.id)), events: new Set(liveEvents.map((e) => e.id)) };
      const saved = pruneStops(loadStops(keyRef.current, localStore), live);
      commit(saved.stops);
      if (saved.dropped > 0) toast(droppedToast(saved.dropped));

      const shared = parseRouteParam(new URLSearchParams(search).get(ROUTE_PARAM));
      if (shared === null) return false;
      // Done with the link: a reload shouldn't ask again.
      const u = new URL(window.location.href);
      u.searchParams.delete(ROUTE_PARAM);
      history.replaceState(null, '', u.pathname + u.search + u.hash);
      const valid = pruneStops(shared, live).stops;
      switch (shareDecision(saved.stops, valid)) {
        case 'none':
          toast("That route's stops aren't on the map anymore.");
          return false;
        case 'load':
          commit(valid);
          return true;
        case 'same':
          return true;
        case 'ask':
          setIncoming(valid);
          return true;
      }
    },
    [commit, toast],
  );

  const has = useCallback((kind: StopKind, id: string) => stops.some((s) => s.kind === kind && s.id === id), [stops]);

  const toggle = useCallback(
    (kind: StopKind, id: string) => {
      const r = toggleStop(stopsRef.current, { kind, id });
      if (r.result === 'full') {
        toast(`Your route is full (${MAX_STOPS} stops).`);
        return;
      }
      commit(r.stops);
      toast(r.result === 'added' ? `Added to your route (${r.stops.length})` : 'Removed from your route');
    },
    [commit, toast],
  );

  const views = useMemo<RouteStopView[]>(() => {
    const ph = new Map(pins.map((p) => [p.id, p]));
    const pe = new Map(events.map((e) => [e.id, e]));
    const out: RouteStopView[] = [];
    for (const s of stops) {
      if (s.kind === 'house') {
        const p = ph.get(s.id);
        if (p) out.push({ kind: 'house', id: p.id, lat: p.lat, lng: p.lng, title: firstSegment(p.address), sub: '' });
      } else {
        const e = pe.get(s.id);
        if (e) out.push({ kind: 'event', id: e.id, lat: e.lat, lng: e.lng, title: e.title, sub: e.venue ?? firstSegment(e.address) });
      }
    }
    return out;
  }, [stops, pins, events]);

  /** Asks for location once per visit; later calls reuse the answer. */
  const locate = useCallback(async (): Promise<Point | null> => {
    if (geo.status === 'ok') return geo.p;
    if (geo.status === 'denied') return null;
    const p = await currentPosition();
    setGeo(p ? { status: 'ok', p } : { status: 'denied' });
    return p;
  }, [geo]);

  const order = useCallback(async () => {
    if (views.length < 2) return;
    setBusy('order');
    const p = await locate();
    setBusy(null);
    const cur = views; // order what's on the map, in the current order
    const idx = orderStops(cur, p);
    commit(idx.map((i) => ({ kind: cur[i].kind, id: cur[i].id })));
    toast(p ? 'Ordered from your location' : 'Ordered from your first stop');
  }, [views, locate, commit, toast]);

  const nearby = useCallback(async () => {
    const room = MAX_STOPS - stopsRef.current.length;
    if (room <= 0) {
      toast(`Your route is full (${MAX_STOPS} stops).`);
      return;
    }
    setBusy('nearby');
    const p = await locate();
    setBusy(null);
    const center = p ?? mapCenter() ?? regionCenter;
    if (!center) return;
    const skip = new Set(stopsRef.current.filter((s) => s.kind === 'house').map((s) => s.id));
    const add = nearbyHouses(pins, center, skip, Math.min(NEARBY_MAX, room));
    const where = p ? 'you' : 'the map center';
    if (add.length === 0) {
      toast(`No more houses within 1 km of ${where}`);
      return;
    }
    commit([...stopsRef.current, ...add.map((h) => ({ kind: 'house' as const, id: h.id }))]);
    toast(`Added ${add.length} nearby ${add.length === 1 ? 'house' : 'houses'} (within 1 km of ${where})`);
  }, [locate, mapCenter, regionCenter, pins, commit, toast]);

  const move = useCallback(
    (i: number, dir: -1 | 1) => {
      commit(moveStop(views, i, dir).map((v) => ({ kind: v.kind, id: v.id })));
    },
    [views, commit],
  );

  const remove = useCallback(
    (i: number) => {
      const v = views[i];
      if (!v) return;
      commit(stopsRef.current.filter((s) => !(s.kind === v.kind && s.id === v.id)));
    },
    [views, commit],
  );

  const clear = useCallback(() => commit([]), [commit]);

  const share = useCallback(async () => {
    if (!season) return;
    const n = views.length;
    const data = {
      title: season === 'halloween' ? 'Truckee Frights' : 'Truckee Lights',
      text: season === 'halloween' ? `My trick-or-treat route: ${n} stops` : `My light tour: ${n} stops`,
      url: routeShareUrl(publicEnv.siteUrl, views),
    };
    const msg = shareToast(await shareOrCopy(data, navigator));
    if (msg) toast(msg);
  }, [season, views, toast]);

  const resolveIncoming = useCallback(
    (replace: boolean) => {
      if (replace && incoming) {
        commit(incoming);
        toast('Route replaced');
      }
      setIncoming(null);
    },
    [incoming, commit, toast],
  );

  return {
    stops,
    views,
    count: views.length,
    has,
    toggle,
    init,
    order,
    nearby,
    move,
    remove,
    clear,
    share,
    mode,
    setMode,
    origin: geo.status === 'ok' ? geo.p : null,
    busy,
    incoming,
    resolveIncoming,
  };
}

export type RouteApi = ReturnType<typeof useRoute>;
