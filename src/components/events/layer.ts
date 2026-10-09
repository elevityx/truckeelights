// Houses · Events · Both. One state drives the map and the list. Deep link ?layer=, remembered in localStorage.
export type Layer = 'houses' | 'events' | 'both';
export const LAYERS: readonly Layer[] = ['houses', 'events', 'both'];
export const LAYER_KEY = 'tl:layer';

export function parseLayer(v: string | null | undefined): Layer | null {
  return v === 'houses' || v === 'events' || v === 'both' ? v : null;
}

/** Storage can be missing or throw (private mode, blocked site data), even on access. */
export type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** The URL wins, then the saved choice, then Houses. */
export function readLayer(search: string, storage: StorageGetter): Layer {
  const fromUrl = parseLayer(new URLSearchParams(search).get('layer'));
  if (fromUrl) return fromUrl;
  try {
    return parseLayer(storage()?.getItem(LAYER_KEY)) ?? 'houses';
  } catch {
    return 'houses';
  }
}

export function saveLayer(layer: Layer, storage: StorageGetter): void {
  try {
    storage()?.setItem(LAYER_KEY, layer);
  } catch {
    /* not remembered; the switch still works */
  }
}

/** The page URL with ?layer= set (or removed for the default, Houses). */
export function layerUrl(href: string, layer: Layer): string {
  const u = new URL(href);
  if (layer === 'houses') u.searchParams.delete('layer');
  else u.searchParams.set('layer', layer);
  return u.pathname + u.search + u.hash;
}

export const showsHouses = (l: Layer) => l !== 'events';
export const showsEvents = (l: Layer) => l !== 'houses';
