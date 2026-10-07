import type { PinView } from '@/lib/data/types';
import { THEMES } from '@/lib/theme/themes';
import { firstSegment } from '@/lib/text/address';
import { loadGoogle } from './loader';
import { GLYPHS, pickGlyph } from './glyphs';
import type { MapAdapter } from './types';

export function createGoogleAdapter(): MapAdapter {
  let map: google.maps.Map | null = null;
  let marker: google.maps.MarkerLibrary | null = null;
  let mounted = false;
  let season: 'halloween' | 'christmas' = 'halloween';
  const markers = new Map<string, { m: google.maps.marker.AdvancedMarkerElement; el: HTMLElement; pin: PinView }>();
  const listeners = new Set<(id: string) => void>();
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
      m.addListener('click', () => listeners.forEach((cb) => cb(pin.id)));
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
      if (pending) render(pending);
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
      map = null;
      div?.remove();
      div = null;
    },
  };
}
