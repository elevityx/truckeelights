// Owner: WP-B. Stubs only (WP-0); bodies per Spec_Photos_Release2 §1.3.
import type { AddPhotosProgress, AddPhotosResult, ConfirmResult, HousePhoto } from './types';

const nope = (): never => {
  throw new Error('not implemented');
};

export async function listHousePhotos(houseId: string): Promise<HousePhoto[]> {
  void houseId;
  return nope();
}
export async function reservePhoto(houseId: string): Promise<{ photoId: string; uploadPath: string }> {
  void houseId;
  return nope();
}
export async function uploadReserved(uploadPath: string, jpeg: Blob): Promise<void> {
  void uploadPath;
  void jpeg;
  return nope();
}
export async function confirmPhotoUpload(photoId: string): Promise<ConfirmResult> {
  void photoId;
  return nope();
}
export async function addPhotos(
  houseId: string,
  files: File[],
  onProgress: (p: AddPhotosProgress) => void,
): Promise<AddPhotosResult> {
  void houseId;
  void files;
  void onProgress;
  return nope();
}
