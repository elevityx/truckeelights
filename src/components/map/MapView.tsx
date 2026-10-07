'use client';

import { useEffect, useRef } from 'react';
import type { PinView, Region, Season } from '@/lib/data/types';
import { getMapAdapter } from '@/lib/maps';
import type { MapAdapter } from '@/lib/maps/types';
import { Fog, Ridge, Troll } from './Decor';

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
    const off = a.onPinSelect((id) => onSelectRef.current(id));
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
      <Ridge season={season} />
      {H && <Fog />}
      {H && <Troll />}
      <p className="maphint">Tap a {H ? 'pumpkin' : 'tree'}</p>
    </div>
  );
}
