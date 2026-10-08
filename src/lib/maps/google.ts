import type { PinView } from '@/lib/data/types';
import { THEMES } from '@/lib/theme/themes';
import { firstSegment } from '@/lib/text/address';
import { loadGeocoder, loadGoogle } from './loader';
import { GLYPHS, PROBES, pickGlyph } from './glyphs';
import type { GeocodeCandidate, MapAdapter } from './types';

export function createGoogleAdapter(): MapAdapter {
  let map: google.maps.Map | null = null;
  let marker: google.maps.MarkerLibrary | null = null;
  let mounted = false;
  let season: 'halloween' | 'christmas' = 'halloween';
  const markers = new Map<string, { m: google.maps.marker.AdvancedMarkerElement; el: HTMLElement; pin: PinView }>();
  const listeners = new Set<(id: string) => void>();
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
      if (markers.has(pin.id)) return;
      const glyphName = pickGlyph(pin.id, season);
      const alt = glyphName === THEMES[season].altGlyph;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pin pin-adv';
      el.style.setProperty('--g', alt ? THEMES[season].altGlow : THEMES[season].glow);
      el.style.setProperty('--d', `${(-i * 0.73).toFixed(2)}s`);
      el.setAttribute('aria-label', pin.address);
      const g = document.createElement('span');
      g.className = 'glyph';
      g.innerHTML = GLYPHS[glyphName]; // constant string, never data
      const label = document.createElement('span');
      label.className = 'plabel';
      label.textContent = firstSegment(pin.address);
      el.append(g, label);
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
      markers.set(pin.id, { m, el, pin });
    });
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
        restriction: {
          latLngBounds: { north: r.maxLat + 0.05, south: r.minLat - 0.05, east: r.maxLng + 0.05, west: r.minLng - 0.05 },
          strictBounds: false,
        },
      });
      // 'click' fires only for a tap that was not a drag or pinch; pins are filtered by lastPinClick.
      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        const ll = e.latLng;
        if (!ll || Date.now() - lastPinClick < 500) return;
        const p = { lat: ll.lat(), lng: ll.lng() };
        clickListeners.forEach((cb) => cb(p));
      });
      if (pending) render(pending);
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
    async reverseGeocode(p) {
      const g = await loadGeocoder();
      try {
        const { results } = await g.geocode({ location: p });
        return results.map(
          (r): GeocodeCandidate => ({
            placeId: r.place_id,
            address: r.formatted_address,
            lat: r.geometry.location.lat(),
            lng: r.geometry.location.lng(),
            types: r.types ?? [],
          }),
        );
      } catch (e) {
        if ((e as { code?: string }).code === 'ZERO_RESULTS') return [];
        throw e;
      }
    },
    setPins(pins) {
      pending = pins;
      render(pins);
    },
    focus(id) {
      if (selected) markers.get(selected)?.el.classList.remove('sel');
      selected = id;
      const rec = markers.get(id);
      if (!rec || !map) return;
      rec.el.classList.add('sel');
      map.panTo({ lat: rec.pin.lat, lng: rec.pin.lng });
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
      listeners.clear();
      clickListeners.clear();
      if (probe) probe.map = null;
      probe = null;
      zoomToken++;
      map = null;
      div?.remove();
      div = null;
    },
  };
}
