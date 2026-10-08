// Owner: WP-C. Stubs only (WP-0); bodies per Spec_Photos_Release2 §1.3.
import type { AdminPhoto } from './types';

const nope = (): never => {
  throw new Error('not implemented');
};

export async function adminPhotoQueue(regionId: string, status: 'pending' | 'approved'): Promise<AdminPhoto[]> {
  void regionId;
  void status;
  return nope();
}
export async function adminPhotoPreviewUrl(p: AdminPhoto): Promise<string> {
  void p;
  return nope();
}
export async function adminApprovePhoto(p: AdminPhoto): Promise<void> {
  void p;
  return nope();
}
export async function adminRejectPhoto(id: string): Promise<void> {
  void id;
  return nope();
}
export async function adminRevokePhoto(id: string): Promise<void> {
  void id;
  return nope();
}
export async function adminSetPhotosOpen(regionId: string, open: boolean): Promise<void> {
  void regionId;
  void open;
  return nope();
}
