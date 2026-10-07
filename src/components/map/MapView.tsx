'use client';

import { useEffect, useRef, useState } from 'react';
import type { PinView, Region, Season } from '@/lib/data/types';
import { getMapAdapter } from '@/lib/maps';
import type { MapAdapter } from '@/lib/maps/types';
import { Fog, Troll } from './Decor';

interface Props {
  season: Season;
  region: Region;
  pins: PinView[];
  selectedId: string | null;
  onSelect(id: string): void;
}

export default function MapView({ season, region, pins, selectedId, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const adapter = useRef<MapAdapter | null>(null);
  const pinsRef = useRef(pins);
  const selRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  // The "Tap a pumpkin" hint fades after the first pin tap or 8 seconds.
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 8000);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    pinsRef.current = pins;
    selRef.current = selectedId;
    onSelectRef.current = onSelect;
  });

  // Build the map once per season (remount only when the season or region changes).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const a = getMapAdapter(season);
    adapter.current = a;
    const off = a.onPinSelect((id) => {
      setHint(false);
      onSelectRef.current(id);
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
      off();
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

  const H = season === 'halloween';
  return (
    <div className="mapwrap" aria-label={`Map of ${region.name} houses. Use the List view for a text version.`}>
      <div ref={host} className="mapdiv" />
      {H && <Fog />}
      {H && <Troll />}
      <p className={hint ? 'maphint' : 'maphint gone'} aria-hidden={!hint}>
        Tap a {H ? 'pumpkin' : 'tree'}
      </p>
    </div>
  );
}
