'use client';

import { useEffect, useRef, useState } from 'react';
import { XIcon } from '@/components/shell/Icons';
import type { PinView, Region, Season } from '@/lib/data/types';
import { getMapAdapter } from '@/lib/maps';
import { findNearbyDuplicate, inRegion, mapPickMessage, pickStreetResult } from '@/lib/maps/mapPick';
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
}

type Pop = { kind: 'busy' } | { kind: 'dup'; pin: PinView } | { kind: 'msg'; text: string } | null;

export default function MapView({ season, region, pins, selectedId, onSelect, pickEnabled, onAddAt }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<MapAdapter | null>(null);
  const pinsRef = useRef(pins);
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
        if (selRef.current) a.focus(selRef.current);
      })
      .catch(() => {
        /* map failed to load; the List view still works */
      });
    return () => {
      live = false;
      off();
      offClick();
      a.destroy();
      adapter.current = null;
    };
  }, [season, region]);

  useEffect(() => {
    adapter.current?.setPins(pins);
  }, [pins]);

  useEffect(() => {
    if (selectedId) adapter.current?.focus(selectedId);
  }, [selectedId, pins]);

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
        {pickEnabled ? (
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
