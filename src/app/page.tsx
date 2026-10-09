'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddHouseSheet from '@/components/add/AddHouseSheet';
import AddChooser from '@/components/events/AddChooser';
import AddEventSheet from '@/components/events/AddEventSheet';
import { devEventsFixture, eventsApi } from '@/components/events/api';
import EventSheet from '@/components/events/EventSheet';
import { EventsView, UpcomingEvents } from '@/components/events/EventsList';
import { layerUrl, readLayer, saveLayer, showsEvents, showsHouses, type Layer } from '@/components/events/layer';
import LayerSwitch from '@/components/events/LayerSwitch';
import AddPhotosSheet from '@/components/photos/AddPhotosSheet';
import HouseSheet from '@/components/house/HouseSheet';
import { setPinTotalListener } from '@/components/house/useHouseVotes';
import ListView from '@/components/list/ListView';
import { devVotesFixture } from '@/components/house/votesApi';
import LoreBar from '@/components/lore/LoreBar';
import MapView from '@/components/map/MapView';
import HomeIntro from '@/components/home/HomeIntro';
import Header from '@/components/shell/Header';
import { ListIcon, MapIcon } from '@/components/shell/Icons';
import Toast from '@/components/shell/Toast';
import { devSubscribeFixture, devSubscribeOverlay } from '@/components/subscribe/api';
import HeaderMenu from '@/components/subscribe/HeaderMenu';
import { AccountNudge, ListSubscribeFooter } from '@/components/subscribe/Nudges';
import SubscribeSheet from '@/components/subscribe/SubscribeSheet';
import Sheet from '@/components/ui/Sheet';
import { publicEnv, supabaseConfigured } from '@/config/public-env';
import {
  getRegionContext,
  listMapHouses,
  toDataError,
  userMessage,
  type DataError,
  type PinView,
  type PublicEvent,
  type RegionContext,
} from '@/lib/data';
import type { PickedPlace } from '@/lib/maps/types';
import { mapShareData, shareOrCopy, shareToast } from '@/lib/share/urls';
import { applySeason } from '@/lib/theme/applySeason';
import { notEnded } from '@/lib/time/pacific';
import { useClock } from '@/lib/time/useClock';

const localStore = () => window.localStorage; // may throw; layer.ts catches

export default function HomePage() {
  const [ctx, setCtx] = useState<RegionContext | null>(null);
  const [pins, setPins] = useState<PinView[]>([]);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'house' | 'add' | 'photos' | 'event' | 'chooser' | 'addEvent' | 'subscribe' | 'nudgePreview' | null>(null);
  const [subAccount, setSubAccount] = useState<boolean | undefined>(undefined); // Subscribe opened from the post-add nudge
  const [layer, setLayer] = useState<Layer>('houses');
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const eventsNow = useClock(); // advances ~every minute and on visibilitychange: grouping and expiry stay current
  const [eventId, setEventId] = useState<string | null>(null);
  const [fitEventsSeq, setFitEventsSeq] = useState(0); // bumped when the map should fit the events (F1)
  const [photosKey, setPhotosKey] = useState(0);
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
    u.searchParams.delete('event');
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
        // Dev mocks: null outside `next dev` with the events or votes mock.
        const efx = await devEventsFixture();
        const fx = efx ?? (await devVotesFixture()) ?? (await devSubscribeFixture());
        let c = fx?.ctx ?? (await getRegionContext());
        const sov = await devSubscribeOverlay(c); // dev mock only: subscribe capability + a sheet to open
        if (sov) c = sov.ctx;
        if (cancelled) return;
        applySeason(c.season);
        const p = fx?.pins ?? (await listMapHouses(c.region.id));
        if (cancelled) return;
        // A database without events (no `events` key) never gets an events call (A1).
        let evs: PublicEvent[] = [];
        let evError = false;
        if (c.events) {
          try {
            evs = await (await eventsApi()).listEvents(c.region.id);
          } catch {
            evError = true; // houses still work
          }
        }
        if (cancelled) return;
        setCtx(c);
        setPins(p);
        setEvents(evs);
        const q = new URLSearchParams(window.location.search);
        if (q.get('view') === 'list') setView('list');
        const startLayer = c.events ? readLayer(window.location.search, localStore) : 'houses';
        setLayer(startLayer);
        if (evError) showToast("Couldn't load events. Houses are still here.");
        const h = q.get('house');
        const e = q.get('event');
        if (startLayer === 'events' && !h && !e) setFitEventsSeq((n) => n + 1);
        if (e) {
          if (evs.some((x) => x.id === e && notEnded(x, Date.now()))) {
            setEventId(e);
            setSheet('event');
            if (startLayer === 'houses') setLayer('both'); // show the pin too; not saved as a preference
          } else {
            showToast("That event isn't on the map.");
          }
        } else if (sov?.open && c.subscribe?.open) {
          setSheet(sov.open === 'nudge' ? 'nudgePreview' : 'subscribe');
        } else if (efx?.open && c.events) {
          setSheet(efx.open === 'event-form' ? 'addEvent' : 'chooser');
        } else if (h) {
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
    setEventId(null);
    setSheet('house');
    const u = new URL(window.location.href);
    u.searchParams.set('house', id);
    u.searchParams.delete('event');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);

  // Opening an event closes the house sheet, and the reverse.
  const selectEvent = useCallback((id: string) => {
    setEventId(id);
    setSelectedId(null);
    setSheet('event');
    const u = new URL(window.location.href);
    u.searchParams.set('event', id);
    u.searchParams.delete('house');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }, []);

  const closeSheet = useCallback(() => {
    setSheet(null);
    setSelectedId(null);
    setEventId(null);
    setUrlHouse(null);
  }, []);

  const changeLayer = useCallback((l: Layer) => {
    setLayer(l);
    if (l === 'events') setFitEventsSeq((n) => n + 1); // Houses and Both keep the camera
    saveLayer(l, localStore);
    history.replaceState(null, '', layerUrl(window.location.href, l));
  }, []);

  const reload = async (thenSelect: string, then?: () => void) => {
    if (!ctx) return;
    try {
      setPins(await listMapHouses(ctx.region.id));
      select(thenSelect);
      then?.();
    } catch (e) {
      showToast(userMessage(toDataError(e)));
    }
  };

  const onVoted = useCallback((id: string, total: number) => {
    setPins((ps) => ps.map((p) => (p.id === id && p.votes !== total ? { ...p, votes: total } : p)));
  }, []);
  // The vote store (not a mounted panel) feeds the pins, so a vote that settles after the sheet closes still lands.
  useEffect(() => {
    setPinTotalListener(onVoted);
    return () => setPinTotalListener(null);
  }, [onVoted]);

  const selectedPin = useMemo(() => pins.find((p) => p.id === selectedId) ?? null, [pins, selectedId]);
  const liveEvents = useMemo(() => events.filter((e) => notEnded(e, eventsNow)), [events, eventsNow]);
  const selectedEvent = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId]);
  const eventIds = useMemo(() => new Set(liveEvents.map((e) => e.id)), [liveEvents]);
  const mapPins = useMemo(() => (showsHouses(layer) ? pins : []), [layer, pins]);
  const mapEvents = useMemo(() => (showsEvents(layer) ? liveEvents : []), [layer, liveEvents]);

  const subOpen = ctx?.subscribe?.open === true; // A missing or closed capability hides every Subscribe entry point.
  const openSubscribe = (account?: boolean) => {
    setSubAccount(account);
    setSelectedId(null);
    setEventId(null);
    setSheet('subscribe');
  };

  if (error) {
    return (
      <main className="err-page">
        <h1 className="wm disp">Truckee Lights</h1>
        <p role="status">{error === 'unconfigured' ? "Site isn't configured." : userMessage(error)}</p>
        <HomeIntro />
      </main>
    );
  }
  if (!ctx) {
    return (
      <main className="err-page">
        <h1 className="wm disp">Truckee Lights</h1>
        <p role="status">Loading the map…</p>
        <HomeIntro />
      </main>
    );
  }

  const inlineSwitch = ctx.events && <LayerSwitch variant="inline" layer={layer} onChange={changeLayer} houses={pins.length} events={liveEvents.length} />;
  return (
    <>
      <Header
        ctx={ctx}
        onAdd={() => {
          setAddAt(null);
          setSheet(ctx.events ? 'chooser' : 'add');
        }}
        addChooser={ctx.events ? { eventsOpen: ctx.events.open } : undefined}
        menu={subOpen ? <HeaderMenu onSubscribe={() => openSubscribe()} /> : undefined}
        layerSwitch={ctx.events && <LayerSwitch variant="bar" layer={layer} onChange={changeLayer} houses={pins.length} events={liveEvents.length} />}
      />
      <div className="pbody">
        <div className="views">
          {ctx.events && view === 'map' && (
            <LayerSwitch variant="float" layer={layer} onChange={changeLayer} houses={pins.length} events={liveEvents.length} />
          )}
          {view === 'map' ? (
            <MapView
              season={ctx.season}
              region={ctx.region}
              pins={mapPins}
              selectedId={sheet === 'event' ? eventId : selectedId}
              onSelect={select}
              events={mapEvents}
              onSelectEvent={selectEvent}
              fitEventsSeq={layer === 'events' ? fitEventsSeq : 0}
              eventsHint={ctx.events && showsEvents(layer) ? { houses: showsHouses(layer), count: liveEvents.length } : null}
              pickEnabled={ctx.submissionsOpen && showsHouses(layer)}
              onAddAt={(place) => {
                setAddAt((prev) => ({ place, n: (prev?.n ?? 0) + 1 }));
                setSelectedId(null);
                setUrlHouse(null);
                setSheet('add');
              }}
            />
          ) : ctx.events && layer === 'events' ? (
            <EventsView
              events={liveEvents}
              tz={ctx.region.timezone}
              region={ctx.region}
              now={eventsNow}
              season={ctx.season}
              year={ctx.year}
              onOpen={selectEvent}
              onAdd={ctx.events.open ? () => setSheet('addEvent') : undefined}
              layerSwitch={inlineSwitch}
            />
          ) : (
            <ListView
              season={ctx.season}
              year={ctx.year}
              pins={pins}
              onOpen={select}
              layerSwitch={inlineSwitch}
              after={subOpen ? <ListSubscribeFooter onSubscribe={() => openSubscribe()} /> : undefined}
              before={
                ctx.events && layer === 'both' ? (
                  <UpcomingEvents
                    events={liveEvents}
                    tz={ctx.region.timezone}
                    region={ctx.region}
                    now={eventsNow}
                    season={ctx.season}
                    onOpen={selectEvent}
                    onAdd={ctx.events.open ? () => setSheet('addEvent') : undefined}
                    onSeeAll={() => changeLayer('events')}
                  />
                ) : undefined
              }
            />
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
      <LoreBar
        season={ctx.season}
        onShare={async () => {
          const msg = shareToast(await shareOrCopy(mapShareData(ctx.season, publicEnv.siteUrl), navigator));
          if (msg) showToast(msg);
        }}
      />
      <footer id="site-footer" />
      {sheet === 'house' && selectedPin && (
        <HouseSheet
          pin={selectedPin}
          season={ctx.season}
          year={ctx.year}
          onClose={closeSheet}
          onToast={showToast}
          onAddPhotos={ctx.photosOpen ? () => setSheet('photos') : undefined}
          photosRefreshKey={photosKey}
          votesOpen={ctx.votesOpen}
        />
      )}
      {sheet === 'event' && selectedEvent && (
        <EventSheet event={selectedEvent} season={ctx.season} year={ctx.year} tz={ctx.region.timezone} region={ctx.region} onClose={closeSheet} onToast={showToast} />
      )}
      {sheet === 'chooser' && ctx.events && (
        <AddChooser
          season={ctx.season}
          housesOpen={ctx.submissionsOpen}
          eventsOpen={ctx.events.open}
          onHouse={() => setSheet('add')}
          onEvent={() => setSheet('addEvent')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'addEvent' && ctx.events?.open && (
        <AddEventSheet ctx={ctx} onClose={() => setSheet(null)} onBack={() => setSheet('chooser')} onOpenEvent={selectEvent} knownIds={eventIds} />
      )}
      {sheet === 'add' && (
        <AddHouseSheet
          key={addAt ? `at-${addAt.n}` : 'search'}
          ctx={ctx}
          initialPlace={addAt?.place}
          pins={pins}
          onClose={() => setSheet(null)}
          onCreated={(id) => void reload(id)}
          onCreateAccount={subOpen ? () => openSubscribe(true) : undefined}
          onOpenExisting={(id) => select(id)}
          onAddPhotos={
            ctx.photosOpen
              ? (id) => {
                  void reload(id, () => setSheet('photos'));
                }
              : undefined
          }
        />
      )}
      {sheet === 'photos' && selectedPin && (
        <AddPhotosSheet
          ctx={ctx}
          house={selectedPin}
          onClose={() => setSheet('house')}
          onDone={() => {
            setPhotosKey((k) => k + 1);
            setSheet('house');
          }}
        />
      )}
      {sheet === 'subscribe' && subOpen && <SubscribeSheet key={String(subAccount)} ctx={ctx} account={subAccount} onClose={() => setSheet(null)} />}
      {sheet === 'nudgePreview' && subOpen && (
        // Dev mock only (?subMock=nudge): the add-house success card's nudge, without running the add flow.
        <Sheet label="Add a house" onClose={() => setSheet(null)} tall>
          <div className="sheet-in">
            <div className="result">
              <p className="disp">{ctx.season === 'halloween' ? 'It’s alive!' : 'Added!'}</p>
              <p>
                <strong>88 Lantern Ct, Truckee, CA 96161</strong> is on the map.
              </p>
              <AccountNudge onCreate={() => openSubscribe(true)} onDismiss={() => setSheet(null)} />
            </div>
          </div>
        </Sheet>
      )}
      <Toast message={toast} />
    </>
  );
}
