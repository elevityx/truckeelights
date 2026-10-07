import type { PinView, RegionContext } from './types';

// Owner: WP-B
export async function getRegionContext(slug?: string): Promise<RegionContext> {
  void slug;
  throw new Error('not implemented');
}
export async function listMapHouses(regionId: string): Promise<PinView[]> {
  void regionId;
  throw new Error('not implemented');
}
