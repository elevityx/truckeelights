// Houses · Events · Both. One state drives the map and the list. Deep link ?layer=, remembered in localStorage.
export type Layer = 'houses' | 'events' | 'both';
export const LAYERS: readonly Layer[] = ['houses', 'events', 'both'];
export const LAYER_KEY = 'tl:layer';
/** Events first while few houses are in (owner, 2026-10-12). */
export const DEFAULT_LAYER: Layer = 'events';
/** Set once the visitor has tried the switch; stops the Houses hint. */
export const HOUSE_HINT_KEY = 'tl:houseHintSeen';

export function parseLayer(v: string | null | undefined): Layer | null {
  return v === 'houses' || v === 'events' || v === 'both' ? v : null;
}

/** Storage can be missing or throw (private mode, blocked site data), even on access. */
export type StorageGetter = () => Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** The URL wins, then the saved choice, then the default (Events). */
export function readLayer(search: string, storage: StorageGetter): Layer {
  const fromUrl = parseLayer(new URLSearchParams(search).get('layer'));
  if (fromUrl) return fromUrl;
  try {
    return parseLayer(storage()?.getItem(LAYER_KEY)) ?? DEFAULT_LAYER;
  } catch {
    return DEFAULT_LAYER;
  }
}

export function saveLayer(layer: Layer, storage: StorageGetter): void {
  try {
    storage()?.setItem(LAYER_KEY, layer);
  } catch {
    /* not remembered; the switch still works */
  }
}

/** The page URL with ?layer= set (or removed for the default). */
export function layerUrl(href: string, layer: Layer): string {
  const u = new URL(href);
  if (layer === DEFAULT_LAYER) u.searchParams.delete('layer');
  else u.searchParams.set('layer', layer);
  return u.pathname + u.search + u.hash;
}

/** Show the Houses hint until the visitor has used the switch once. */
export function readHouseHint(storage: StorageGetter): boolean {
  try {
    return !storage()?.getItem(HOUSE_HINT_KEY);
  } catch {
    return true;
  }
}

export function saveHouseHintSeen(storage: StorageGetter): void {
  try {
    storage()?.setItem(HOUSE_HINT_KEY, '1');
  } catch {
    /* the hint just shows again next visit */
  }
}

export const showsHouses = (l: Layer) => l !== 'events';
export const showsEvents = (l: Layer) => l !== 'houses';
