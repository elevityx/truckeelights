'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddHouseSheet from '@/components/add/AddHouseSheet';
import HouseSheet from '@/components/house/HouseSheet';
import ListView from '@/components/list/ListView';
import LoreBar from '@/components/lore/LoreBar';
import MapView from '@/components/map/MapView';
import Header from '@/components/shell/Header';
import { ListIcon, MapIcon } from '@/components/shell/Icons';
import Toast from '@/components/shell/Toast';
import { supabaseConfigured } from '@/config/public-env';
import {
  getRegionContext,
  listMapHouses,
  toDataError,
  userMessage,
  type DataError,
  type PinView,
  type RegionContext,
} from '@/lib/data';
import type { PickedPlace } from '@/lib/maps/types';
import { applySeason } from '@/lib/theme/applySeason';

export default function HomePage() {
  const [ctx, setCtx] = useState<RegionContext | null>(null);
  const [pins, setPins] = useState<PinView[]>([]);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'house' | 'add' | null>(null);
  const [addAt, setAddAt] = useState<{ place: PickedPlace; n: number } | null>(null); // map tap -> Add sheet at the pin step
  const [error, setError] = useState<DataError | 'unconfigured' | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }, []);

  const setUrlHouse = (id: string | null) => {
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('house', id);
    else u.searchParams.delete('house');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!supabaseConfigured()) {
        setError('unconfigured');
        return;
      }
      try {
        const c = await getRegionContext();
        if (cancelled) return;
        applySeason(c.season);
        const p = await listMapHouses(c.region.id);
        if (cancelled) return;
        setCtx(c);
        setPins(p);
        const q = new URLSearchParams(window.location.search);
        if (q.get('view') === 'list') setView('list');
        const h = q.get('house');
        if (h) {
          if (p.some((x) => x.id === h)) {
            setSelectedId(h);
            setSheet('house');
          } else {
            showToast("That house isn't on this season's map.");
          }
        }
      } catch (e) {
        if (!cancelled) setError(toDataError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setSheet('house');
    const u = new URL(window.location.href);
    u.searchParams.set('house', id);
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    setSelectedId(null);
    setUrlHouse(null);
  }, []);

  const reload = async (thenSelect: string) => {
    if (!ctx) return;
    try {
      setPins(await listMapHouses(ctx.region.id));
      select(thenSelect);
    } catch (e) {
      showToast(userMessage(toDataError(e)));
    }
  };

  const selectedPin = useMemo(() => pins.find((p) => p.id === selectedId) ?? null, [pins, selectedId]);

  if (error) {
    return (
      <main className="err-page">
        <h1 className="wm disp">Truckee Lights</h1>
        <p role="status">{error === 'unconfigured' ? "Site isn't configured." : userMessage(error)}</p>
      </main>
    );
  }
  if (!ctx) {
    return (
      <main className="err-page">
        <h1 className="wm disp">Truckee Lights</h1>
        <p role="status">Loading the map…</p>
      </main>
    );
  }

  return (
    <>
      <Header
        ctx={ctx}
        onAdd={() => {
          setAddAt(null);
          setSheet('add');
        }}
      />
      <div className="pbody">
        <div className="views">
          {view === 'map' ? (
            <MapView
              season={ctx.season}
              region={ctx.region}
              pins={pins}
              selectedId={selectedId}
              onSelect={select}
              pickEnabled={ctx.submissionsOpen}
              onAddAt={(place) => {
                setAddAt((prev) => ({ place, n: (prev?.n ?? 0) + 1 }));
                setSelectedId(null);
                setUrlHouse(null);
                setSheet('add');
              }}
            />
          ) : (
            <ListView season={ctx.season} year={ctx.year} pins={pins} onOpen={select} />
          )}
          <div className="seg viewtoggle" role="group" aria-label="Show houses as">
            <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
              <MapIcon />
              Map
            </button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              <ListIcon />
              List
            </button>
          </div>
        </div>
      </div>
      <LoreBar season={ctx.season} />
      <footer id="site-footer" />
      {sheet === 'house' && selectedPin && (
        <HouseSheet pin={selectedPin} season={ctx.season} year={ctx.year} onClose={closeSheet} onToast={showToast} />
      )}
      {sheet === 'add' && (
        <AddHouseSheet
          key={addAt ? `at-${addAt.n}` : 'search'}
          ctx={ctx}
          initialPlace={addAt?.place}
          onClose={() => setSheet(null)}
          onCreated={(id) => void reload(id)}
          onOpenExisting={(id) => select(id)}
        />
      )}
      <Toast message={toast} />
    </>
  );
}
