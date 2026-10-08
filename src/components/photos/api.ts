// The photo calls the public UI makes. Production always uses the real data layer.
// `next dev` with NEXT_PUBLIC_PHOTOS_MOCK=1 swaps in devMock.ts (an in-memory fake, for screenshots
// before the photos database exists). The NODE_ENV check is inlined at build, so the mock is
// dead code in `next build` and never ships.
import { addPhotos, listHousePhotos, type AddPhotosProgress, type AddPhotosResult, type HousePhoto } from '@/lib/data';
import { ensureAnonymousSession, hasSession } from '@/lib/data/submit';

export interface PhotosApi {
  listHousePhotos(houseId: string): Promise<HousePhoto[]>;
  addPhotos(houseId: string, files: File[], onProgress: (p: AddPhotosProgress) => void): Promise<AddPhotosResult>;
  hasSession(): Promise<boolean>;
  ensureAnonymousSession(token: string): Promise<void>;
}

const real: PhotosApi = { listHousePhotos, addPhotos, hasSession, ensureAnonymousSession };

export async function photosApi(): Promise<PhotosApi> {
  if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_PHOTOS_MOCK === '1') {
    return (await import('./devMock')).devMockApi();
  }
  return real;
}
