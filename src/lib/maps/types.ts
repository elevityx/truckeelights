import type { PinView, Region, Season } from '@/lib/data/types';

export interface MapMountOptions {
  season: Season;
  region: Region;
}
export interface MapAdapter {
  mount(el: HTMLElement, o: MapMountOptions): Promise<void>; // builds the map ONCE; call again only after destroy()
  setPins(pins: PinView[]): void; // diff by id; never rebuilds the map
  focus(id: string): void; // pan to the pin, mark it selected
  onPinSelect(cb: (id: string) => void): () => void; // returns an unsubscribe function
  /** Taps on empty map only: never for a pin, a drag, or a pinch. Returns an unsubscribe function. */
  onMapClick(cb: (p: LatLng) => void): () => void;
  /** Temporary seasonal marker at a tapped spot while it is looked up; null removes it. */
  showProbe(p: LatLng | null): void;
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
