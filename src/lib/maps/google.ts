import type { PinView, PublicEvent } from '@/lib/data/types';
import { THEMES } from '@/lib/theme/themes';
import { firstSegment } from '@/lib/text/address';
import { reverseGeocode } from './geocode';
import { loadGoogle } from './loader';
import { dateBadge, formatRange } from '@/lib/time/pacific';
import { eventBoundsAdmin } from '@/lib/data/events';

import { fitEventsCamera, fitTargets, spreadOffsets, type Padding } from './eventLayout';
import { EVENT_GLYPHS, GLYPHS, PROBES, pickGlyph } from './glyphs';
import { buildMeter, updateMeter } from './meterEl';
import type { MapAdapter, MapMountOptions } from './types';

/** Amendment 3: the camera may pan over the admin box (Reno, Carson City), so "Worth the drive" pins can be seen. */
function eventLatLngBounds(r: Parameters<typeof eventBoundsAdmin>[0]) {
  const b = eventBoundsAdmin(r);
  return { north: b.maxLat, south: b.minLat, east: b.maxLng, west: b.minLng };
}
import { meterAriaText, powerKind } from '@/lib/votes/meter';

export function createGoogleAdapter(): MapAdapter {
  let map: google.maps.Map | null = null;
  let marker: google.maps.MarkerLibrary | null = null;
  let mounted = false;
  let season: 'halloween' | 'christmas' = 'halloween';
  const markers = new Map<
    string,
    { m: google.maps.marker.AdvancedMarkerElement; el: HTMLElement; meter: HTMLElement; pin: PinView }
  >();
  const listeners = new Set<(id: string) => void>();
  const emarkers = new Map<string, { m: google.maps.marker.AdvancedMarkerElement; el: HTMLElement; ev: PublicEvent }>();
  const eventListeners = new Set<(id: string) => void>();
  let pendingEvents: { events: PublicEvent[]; tz: string } | null = null;
  let region: MapMountOptions['region'] | null = null;
  let pendingFit: Padding | null = null;
  const clickListeners = new Set<(p: { lat: number; lng: number }) => void>();
  let lastPinClick = 0; // a pin tap must never also count as an empty-map tap
  let probe: google.maps.marker.AdvancedMarkerElement | null = null;
  let zoomToken = 0;
  let selected: string | null = null;
  let pending: PinView[] | null = null;
  let dead = false;
  let div: HTMLDivElement | null = null;

  const render = (pins: PinView[]) => {
    if (!map || !marker) return;
    const ids = new Set(pins.map((p) => p.id));
    for (const [id, rec] of markers) {
      if (!ids.has(id)) {
        rec.m.map = null;
        markers.delete(id);
      }
    }
    pins.forEach((pin, i) => {
      const glyphName = pickGlyph(pin.id, season);
      const kind = powerKind(season, glyphName);
      const ariaLabel = `${pin.address}. ${meterAriaText(kind, pin.votes, pin.photoCount)}`;
      const have = markers.get(pin.id);
      if (have) {
        // Update path: only the meter and its label change when a count does (a vote, or a reload).
        if (have.pin.votes !== pin.votes || have.pin.photoCount !== pin.photoCount) {
          updateMeter(have.meter, pin.votes, pin.photoCount);
          have.el.setAttribute('aria-label', ariaLabel);
        }
        have.pin = pin;
        return;
      }
      const alt = glyphName === THEMES[season].altGlyph;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin pin-adv';
      el.style.setProperty('--g', alt ? THEMES[season].altGlow : THEMES[season].glow);
      el.style.setProperty('--d', `${(-i * 0.73).toFixed(2)}s`);
      el.setAttribute('aria-label', ariaLabel);
      const g = document.createElement('span');
      g.className = 'glyph';
      g.innerHTML = GLYPHS[glyphName]; // constant string, never data
      const meter = buildMeter(kind);
      updateMeter(meter, pin.votes, pin.photoCount);
      const label = document.createElement('span');
      label.className = 'plabel';
      label.textContent = firstSegment(pin.address);
      el.append(g, meter, label);
      const m = new marker!.AdvancedMarkerElement({
        map,
        position: { lat: pin.lat, lng: pin.lng },
        content: el,
        title: pin.address,
      });
      m.addListener('click', () => {
        lastPinClick = Date.now();
        listeners.forEach((cb) => cb(pin.id));
      });
      markers.set(pin.id, { m, el, meter, pin });
    });
  };

  // Event pins: a theme glyph in a ringed disc with a short date badge, drawn above the houses.
  const renderEvents = (events: PublicEvent[], tz: string) => {
    if (!map || !marker) return;
    const ids = new Set(events.map((e) => e.id));
    for (const [id, rec] of emarkers) {
      if (!ids.has(id)) {
        rec.m.map = null;
        emarkers.delete(id);
      }
    }
    for (const ev of events) {
      if (emarkers.has(ev.id)) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'epin';
      el.setAttribute('aria-label', `Event: ${ev.title}, ${formatRange(ev.startsAt, ev.endsAt, tz)}`);
      const disc = document.createElement('span');
      disc.className = 'disc';
      disc.innerHTML = EVENT_GLYPHS[season]; // constant SVG string, never data
      const badge = document.createElement('span');
      badge.className = 'edate';
      badge.textContent = dateBadge(ev.startsAt, tz);
      el.append(disc, badge);
      const m = new marker!.AdvancedMarkerElement({
        map,
        position: { lat: ev.lat, lng: ev.lng },
        content: el,
        title: ev.title,
        zIndex: 500,
      });
      m.addListener('click', () => {
        lastPinClick = Date.now();
        eventListeners.forEach((cb) => cb(ev.id));
      });
      if (selected === ev.id) el.classList.add('sel');
      emarkers.set(ev.id, { m, el, ev });
    }
    spread();
  };

  // Fan out event pins at one venue, or whose pins overlap at this zoom, on a small ring. Houses never move.
  const spread = () => {
    if (!map) return;
    const z = map.getZoom();
    if (z == null) return;
    const offs = spreadOffsets(
      [...emarkers.values()].map(({ ev }) => ({ id: ev.id, lat: ev.lat, lng: ev.lng, startsAt: ev.startsAt })),
      z,
    );
    for (const [id, rec] of emarkers) {
      const o = offs.get(id);
      rec.el.style.setProperty('--dx', `${o?.dx ?? 0}px`);
      rec.el.style.setProperty('--dy', `${o?.dy ?? 0}px`);
      // In a ring, a higher pin draws over a lower one so its date badge (which hangs below the disc) stays readable.
      rec.m.zIndex = o ? 510 - Math.round(o.dy / 4) : 500;
    }
  };

  const fit = (pad: Padding) => {
    if (!map || !region || !div) return false;
    const evs = [...emarkers.values()].map(({ ev }) => ev);
    const cam = fitEventsCamera(fitTargets(evs, region), region, { width: div.clientWidth, height: div.clientHeight }, pad);
    if (!cam) return true; // nothing to fit: leave the camera alone
    zoomToken++; // cancel any running zoomTo
    map.moveCamera({ center: cam.center, zoom: cam.zoom });
    return true;
  };

  return {
    async mount(el, o) {
      if (mounted) return;
      mounted = true;
      season = o.season;
      const libs = await loadGoogle();
      if (dead) return;
      marker = libs.marker;
      const r = o.region;
      region = r;
      div = document.createElement('div');
      div.className = 'mapdiv';
      el.appendChild(div);
      map = new libs.maps.Map(div, {
        mapId: THEMES[o.season].mapId(),
        center: { lat: r.centerLat, lng: r.centerLng },
        zoom: r.defaultZoom,
        colorScheme: 'DARK' as google.maps.ColorScheme,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        restriction: { latLngBounds: eventLatLngBounds(r), strictBounds: false }, // admin event box; camera starts on the region
      });
      // 'click' fires only for a tap that was not a drag or pinch; pins are filtered by lastPinClick.
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        const ll = e.latLng;
        if (!ll || Date.now() - lastPinClick < 500) return;
        const p = { lat: ll.lat(), lng: ll.lng() };
        clickListeners.forEach((cb) => cb(p));
      });
      if (pending) render(pending);
      if (pendingEvents) renderEvents(pendingEvents.events, pendingEvents.tz);
      map.addListener('zoom_changed', spread);
      if (pendingFit && fit(pendingFit)) pendingFit = null;
    },
    fitEvents(pad) {
      pendingFit = fit(pad) ? null : pad;
    },
    onMapClick(cb) {
      clickListeners.add(cb);
      return () => {
        clickListeners.delete(cb);
      };
    },
    showProbe(p) {
      if (probe) probe.map = null;
      probe = null;
      if (!p || !map || !marker) return;
      const el = document.createElement('div');
      el.className = 'probe';
      el.innerHTML = PROBES[season]; // constant SVG string, never data
      probe = new marker.AdvancedMarkerElement({ map, position: p, content: el, zIndex: 1000 });
    },
    zoomTo(p, zoom) {
      if (!map) return;
      const m = map;
      const token = ++zoomToken;
      m.panTo(p);
      // Step the zoom two levels per idle so the camera eases in instead of jumping.
      const step = () => {
        if (token !== zoomToken || !map) return;
        const z = m.getZoom() ?? zoom;
        if (z >= zoom) return;
        google.maps.event.addListenerOnce(m, 'idle', step);
        m.setZoom(Math.min(zoom, z + 2));
        m.panTo(p);
      };
      google.maps.event.addListenerOnce(m, 'idle', step);
    },
    reverseGeocode(p) {
      return reverseGeocode(p, season);
    },
    setPins(pins) {
      pending = pins;
      render(pins);
    },
    setEvents(events, tz) {
      pendingEvents = { events, tz };
      renderEvents(events, tz);
    },
    focus(id) {
      if (selected) (markers.get(selected) ?? emarkers.get(selected))?.el.classList.remove('sel');
      selected = id;
      const rec = markers.get(id);
      const erec = emarkers.get(id);
      const at = rec ? { lat: rec.pin.lat, lng: rec.pin.lng } : erec ? { lat: erec.ev.lat, lng: erec.ev.lng } : null;
      if (!at || !map) return;
      (rec ?? erec)!.el.classList.add('sel');
      map.panTo(at);
    },
    onEventSelect(cb) {
      eventListeners.add(cb);
      return () => {
        eventListeners.delete(cb);
      };
    },
    onPinSelect(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy() {
      dead = true;
      for (const rec of markers.values()) rec.m.map = null;
      markers.clear();
      for (const rec of emarkers.values()) rec.m.map = null;
      emarkers.clear();
      eventListeners.clear();
      listeners.clear();
      clickListeners.clear();
      if (probe) probe.map = null;
      probe = null;
      pendingFit = null;
      zoomToken++;
      map = null;
      div?.remove();
      div = null;
    },
  };
}
