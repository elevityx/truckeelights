import { mapsConfigured, publicEnv } from '@/config/public-env';
import type { Region, Season } from '@/lib/data/types';
import { THEMES } from '@/lib/theme/themes';
import { createGeneration } from './generation';
import { GLYPHS } from './glyphs';
import { loadGoogle } from './loader';
import type { PickedPlace } from './types';

// Owner: WP-C. Address autocomplete and the draggable pin-confirm map, each with a keyless stub.

function randomId(n: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join('');
}

export interface PickerOptions {
  /** Move focus into the search box once it exists, unless the user already moved focus elsewhere. */
  focus?: boolean;
  /**
   * Accept only places with at least one of these Google place types (events: venues, parks, plazas, street
   * addresses). A pick with none of them calls `onReject` instead of `onPick`. Houses leave this unset and keep
   * their own street-level check.
   */
  allowTypes?: readonly string[];
  onReject?: (p: PickedPlace) => void;
  /** Shared with other async location work (a pin drop's reverse geocode): a newer token there retires a pending selection here. */
  generation?: ReturnType<typeof createGeneration>;
}

/** Spec_Events A3: what the event autocomplete accepts (a town or a bare route is not a place to go). */
export const EVENT_PLACE_TYPES: readonly string[] = ['street_address', 'premise', 'subpremise', 'establishment', 'park', 'point_of_interest', 'tourist_attraction'];

export function placeTypeAllowed(types: readonly string[], allow: readonly string[] | undefined): boolean {
  return allow === undefined || types.some((t) => allow.includes(t));
}

function focusIfIdle(target: HTMLElement, host: HTMLElement) {
  // Wait a frame: a just-appended Google element ignores focus() until it has rendered its input.
  setTimeout(() => {
    if (!target.isConnected) return;
    focusNow(target, host);
  }, 120);
}

function focusNow(target: HTMLElement, host: HTMLElement) {
  const a = document.activeElement;
  const sheet = host.closest('[role="dialog"]');
  if (!a || a === document.body || (sheet && sheet.contains(a) && /^H[1-3]$/.test(a.tagName))) target.focus();
}

function mountStubPicker(el: HTMLElement, region: Region, onPick: (p: PickedPlace) => void, o: PickerOptions = {}): () => void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn alt';
  btn.textContent = 'Use a test address';
  btn.addEventListener('click', () =>
    onPick({
      placeId: 'stub_' + randomId(10),
      address: `1 Test Rd, ${region.name}`,
      lat: region.centerLat,
      lng: region.centerLng,
      types: ['street_address'],
    }),
  );
  el.appendChild(btn);
  if (o.focus) focusIfIdle(btn, el);
  return () => btn.remove();
}

/** Google Places autocomplete limited to the region; falls back to the stub without a Maps key. */
export function createAddressPicker(
  el: HTMLElement,
  region: Region,
  onPick: (p: PickedPlace) => void,
  o: PickerOptions = {},
): () => void {
  if (publicEnv.mapsKey === '') return mountStubPicker(el, region, onPick, o);

  let dead = false;
  let node: HTMLElement | null = null;
  let stubCleanup: (() => void) | null = null;
  const selections = o.generation ?? createGeneration(); // a slower earlier gmp-select must not land after a newer one

  void (async () => {
    try {
      const { places } = await loadGoogle();
      if (dead) return;
      const pac = new places.PlaceAutocompleteElement({
        includedRegionCodes: [region.countryCode.toLowerCase()],
        locationRestriction: { north: region.maxLat, south: region.minLat, east: region.maxLng, west: region.minLng },
      });
      pac.addEventListener('gmp-select', (async (e: Event) => {
        const mine = selections.begin();
        try {
          const prediction = (e as unknown as { placePrediction: google.maps.places.PlacePrediction }).placePrediction;
          const place = prediction.toPlace();
          await place.fetchFields({ fields: ['id', 'formattedAddress', 'location', 'types'] });
          if (dead || !selections.isCurrent(mine) || !place.id || !place.formattedAddress || !place.location) return;
          const picked: PickedPlace = {
            placeId: place.id,
            address: place.formattedAddress,
            lat: place.location.lat(),
            lng: place.location.lng(),
            types: place.types ?? [],
          };
          if (placeTypeAllowed(picked.types, o.allowTypes)) onPick(picked);
          else o.onReject?.(picked);
        } catch {
          /* a failed place lookup leaves the user on the search step */
        }
      }) as EventListener);
      node = pac as unknown as HTMLElement;
      el.appendChild(node);
      if (o.focus) focusIfIdle(node, el);
    } catch {
      if (!dead) stubCleanup = mountStubPicker(el, region, onPick, o);
    }
  })();

  return () => {
    dead = true;
    selections.invalidate();
    node?.remove();
    stubCleanup?.();
  };
}

type Box = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/** The box the pin-confirm map may show. Houses: region + 0.05 deg all round. Events pass eventBounds(region) as is. */
export function pinBox(region: Region, bounds?: Box): Box {
  return bounds ?? { minLat: region.minLat - 0.05, maxLat: region.maxLat + 0.05, minLng: region.minLng - 0.05, maxLng: region.maxLng + 0.05 };
}

/** The google.maps.MapOptions for the pin-confirm map (exported so a test can pin the restriction). */
export function pinMapOptions(region: Region, season: Season, start: { lat: number; lng: number }, bounds?: Box) {
  const b = pinBox(region, bounds);
  return {
    mapId: THEMES[season].mapId(),
    center: start,
    zoom: 18,
    colorScheme: 'DARK' as google.maps.ColorScheme,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy' as const,
    clickableIcons: false,
    restriction: { latLngBounds: { north: b.maxLat, south: b.minLat, east: b.maxLng, west: b.minLng }, strictBounds: false },
  };
}

/** Small draggable-pin map for the confirm step; coordinate text only when Maps is not configured. */
export function createPinConfirm(
  el: HTMLElement,
  region: Region,
  season: Season,
  start: { lat: number; lng: number },
  onMove: (lat: number, lng: number) => void,
  bounds?: Box,
): () => void {
  if (!mapsConfigured(season)) return () => {};

  let dead = false;
  let div: HTMLElement | null = null;

  void (async () => {
    try {
      const { maps, marker } = await loadGoogle();
      if (dead) return;
      div = document.createElement('div');
      div.style.cssText = 'position:absolute;inset:0';
      el.appendChild(div);
      const map = new maps.Map(div, pinMapOptions(region, season, start, bounds));
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'minipin';
      pin.setAttribute('aria-label', 'House pin. Drag it onto the house.');
      pin.style.cssText = 'position:static;transform:none;cursor:grab';
      pin.innerHTML = GLYPHS[THEMES[season].glyph]; // constant SVG string, never data
      const m = new marker.AdvancedMarkerElement({ map, position: start, gmpDraggable: true, content: pin });
      m.addListener('dragend', () => {
        const p = m.position;
        if (!p) return;
        const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
        const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
        onMove(lat, lng);
      });
    } catch {
      /* map unavailable: the coordinate text and editable address still work */
    }
  })();

  return () => {
    dead = true;
    div?.remove();
  };
}
