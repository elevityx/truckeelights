import type { PinView, PublicEvent, Region, Season } from '@/lib/data/types';
import type { Padding } from './eventLayout';

export interface MapMountOptions {
  season: Season;
  region: Region;
}
export interface MapAdapter {
  mount(el: HTMLElement, o: MapMountOptions): Promise<void>; // builds the map ONCE; call again only after destroy()
  setPins(pins: PinView[]): void; // diff by id; never rebuilds the map
  focus(id: string): void; // pan to the pin (house or event), mark it selected
  /** Event pins, diffed by id like houses. Dates show in `tz`. Labels are set with textContent only. */
  setEvents(events: PublicEvent[], tz: string): void;
  onEventSelect(cb: (id: string) => void): () => void; // returns an unsubscribe function
  onPinSelect(cb: (id: string) => void): () => void; // returns an unsubscribe function
  /** Taps on empty map only: never for a pin, a drag, or a pinch. Returns an unsubscribe function. */
  onMapClick(cb: (p: LatLng) => void): () => void;
  /** Temporary seasonal marker at a tapped spot while it is looked up; null removes it. */
  showProbe(p: LatLng | null): void;
  /**
   * Fit the camera to the shown events (local ones only, unless there are none), keeping `pad` pixels clear for the
   * controls over the map. If the map isn't built yet, it runs once the map and its events are there.
   */
  fitEvents(pad: Padding): void;
  /** Smoothly center on a point and zoom in to `zoom`. */
  zoomTo(p: LatLng, zoom: number): void;
  /** Reverse-geocode a point. [] when nothing is there; rejects when the lookup itself fails. */
  reverseGeocode(p: LatLng): Promise<GeocodeCandidate[]>;
  destroy(): void;
}
export interface LatLng {
  lat: number;
  lng: number;
}
export interface GeocodeCandidate {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  types: string[];
}
export interface PickedPlace {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  types: string[];
}
