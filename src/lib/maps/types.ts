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
  destroy(): void;
}
export interface PickedPlace {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  types: string[];
}
