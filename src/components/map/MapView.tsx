'use client';

import { useEffect, useRef, useState } from 'react';
import { XIcon } from '@/components/shell/Icons';
import type { PinView, PublicEvent, Region, Season } from '@/lib/data/types';
import { getMapAdapter } from '@/lib/maps';
import { findNearbyDuplicate, inRegion, mapPickMessage, pickStreetResult } from '@/lib/maps/mapPick';
import type { Padding } from '@/lib/maps/eventLayout';
import type { MapAdapter, PickedPlace } from '@/lib/maps/types';
import { Fog, Troll } from './Decor';

interface Props {
  season: Season;
  region: Region;
  pins: PinView[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** Tap-to-add is on only while submissions are open. */
  pickEnabled: boolean;
  onAddAt(place: PickedPlace): void;
  /** Event pins (already filtered by the layer switch). */
  events?: PublicEvent[];
  onSelectEvent?(id: string): void;
  /** Set when the layer switch shows events: changes the hint. */
  eventsHint?: { houses: boolean; count: number } | null;
  /** Bump to fit the camera to the shown events (the layer switched to Events, or the page opened on it). 0 = never. */
  fitEventsSeq?: number;
}

type Pop = { kind: 'busy' } | { kind: 'dup'; pin: PinView } | { kind: 'msg'; text: string } | null;

const NO_EVENTS: PublicEvent[] = [];

/** Event pins hang up to ~64px above their point (disc + date badge); keep that clear under top controls. */
const PIN_H = 64;
const EDGE = 28;

/** Pixels to keep clear on each side: the float layer switch, the Map/List pill, and room for a pin. */
function fitPadding(wrap: HTMLElement): Padding {
  const w = wrap.getBoundingClientRect();
  let top = 0;
  let bottom = 0;
  const controls = [wrap.parentElement?.querySelector('.layerfloat'), wrap.parentElement?.querySelector('.viewtoggle')];
  for (const c of controls) {
    if (!(c instanceof HTMLElement)) continue;
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue; // hidden at this width
    if (r.top + r.height / 2 < w.top + w.height / 2) top = Math.max(top, r.bottom - w.top);
    else bottom = Math.max(bottom, w.bottom - r.top);
  }
  return { top: top + PIN_H, right: EDGE, bottom: bottom + 16, left: EDGE };
}

export default function MapView({ season, region, pins, selectedId, onSelect, pickEnabled, onAddAt, events = NO_EVENTS, onSelectEvent, eventsHint = null, fitEventsSeq = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<MapAdapter | null>(null);
  const pinsRef = useRef(pins);
  const eventsRef = useRef(events);
  const onSelectEventRef = useRef(onSelectEvent);
  const selRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onAddAtRef = useRef(onAddAt);
  const pickRef = useRef(pickEnabled);
  const seq = useRef(0);
  const [pop, setPop] = useState<Pop>(null);
  // The hint fades after the first tap on the map or 10 seconds.
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 10000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    pinsRef.current = pins;
    eventsRef.current = events;
    onSelectEventRef.current = onSelectEvent;
    selRef.current = selectedId;
    onSelectRef.current = onSelect;
    onAddAtRef.current = onAddAt;
    pickRef.current = pickEnabled;
  });

  // Build the map once per season (remount only when the season or region changes).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const a = getMapAdapter(season);
    adapter.current = a;
    let live = true;
    const off = a.onPinSelect((id) => {
      seq.current++;
      a.showProbe(null);
      setPop(null);
      setHint(false);
      onSelectRef.current(id);
    });
    const offEvent = a.onEventSelect((id) => {
      seq.current++;
      a.showProbe(null);
      setPop(null);
      setHint(false);
      onSelectEventRef.current?.(id);
    });
    const offClick = a.onMapClick((p) => {
      if (!pickRef.current) return;
      setHint(false);
      const n = ++seq.current;
      if (!inRegion(region, p)) {
        a.showProbe(null);
        setPop({ kind: 'msg', text: mapPickMessage('outside', region.name) });
        return;
      }
      setPop({ kind: 'busy' });
      a.showProbe(p);
      a.zoomTo(p, 18);
      a.reverseGeocode(p)
        .then((results) => pickStreetResult(results, region, p))
        .catch(() => ({ ok: false as const, reason: 'failed' as const }))
        .then((r) => {
          if (!live || n !== seq.current) return; // unmounted, or a newer tap won
          a.showProbe(null);
          if (!r.ok) {
            setPop({ kind: 'msg', text: mapPickMessage(r.reason, region.name) });
            return;
          }
          const dup = findNearbyDuplicate(pinsRef.current, r.place);
          if (dup) {
            setPop({ kind: 'dup', pin: dup });
            return;
          }
          setPop(null);
          onAddAtRef.current(r.place);
        });
    });
    a.mount(el, { season, region })
      .then(() => {
        a.setPins(pinsRef.current);
        a.setEvents(eventsRef.current, region.timezone);
        if (selRef.current) a.focus(selRef.current);
      })
      .catch(() => {
        /* map failed to load; the List view still works */
      });
    return () => {
      live = false;
      off();
      offEvent();
      offClick();
      a.destroy();
      adapter.current = null;
    };
  }, [season, region]);

  useEffect(() => {
    adapter.current?.setPins(pins);
  }, [pins]);

  useEffect(() => {
    adapter.current?.setEvents(events, region.timezone);
  }, [events, region.timezone]);

  // After the events effect above, so the adapter fits the events this render shows.
  useEffect(() => {
    const el = host.current?.parentElement;
    if (fitEventsSeq > 0 && el) adapter.current?.fitEvents(fitPadding(el));
  }, [fitEventsSeq]);

  useEffect(() => {
    if (selectedId) adapter.current?.focus(selectedId);
  }, [selectedId, pins, events]);

  const dismiss = () => {
    seq.current++;
    adapter.current?.showProbe(null);
    setPop(null);
  };

  const H = season === 'halloween';
  const glyph = H ? 'pumpkin' : 'tree';
  return (
    <div className="mapwrap" aria-label={`Map of ${region.name} houses. Use the List view for a text version.`}>
      <div ref={host} className="mapdiv" />
      {H && <Fog />}
      {H && <Troll />}
      <p className={hint && !pop ? 'maphint' : 'maphint gone'} aria-hidden={!hint || !!pop}>
        {eventsHint ? (
          eventsHint.count === 0 ? (
            'No events yet — know one? Add it.'
          ) : eventsHint.houses ? (
            `${pins.length} houses · ${eventsHint.count} events`
          ) : (
            `${eventsHint.count} upcoming ${eventsHint.count === 1 ? 'event' : 'events'} · tap one for details`
          )
        ) : pickEnabled ? (
          <>
            <span className="hint-long">Tap a {glyph} to see a house · tap the map to add one</span>
            <span className="hint-short">Tap a {glyph} · tap the map to add</span>
          </>
        ) : (
          `Tap a ${glyph}`
        )}
      </p>
      <div className="mappop-live" aria-live="polite">
        {pop && (
          <div className="mappop">
            {pop.kind === 'busy' && <p>Finding that address…</p>}
            {pop.kind === 'msg' && <p>{pop.text}</p>}
            {pop.kind === 'dup' && (
              <>
                <p>
                  Already on the map: <strong>{pop.pin.address}</strong>
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    const id = pop.pin.id;
                    dismiss();
                    onSelectRef.current(id);
                  }}
                >
                  View it
                </button>
              </>
            )}
            {pop.kind !== 'busy' && (
              <button type="button" className="iconbtn" aria-label="Dismiss" onClick={dismiss}>
                <XIcon />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
