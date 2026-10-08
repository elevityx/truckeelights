// Owner: WP-C. Admin photo moderation (Spec_Photos_Release2 §1.3). The database enforces admin + aal2 on
// every RPC; nothing here is a security boundary. Fail closed: any error leaves the photo not public.
import { toJpeg } from '@/lib/images/toJpeg';
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import { DataError, type AdminPhoto } from './types';

interface RawAdminPhoto {
  id: string;
  house_id: string;
  address: string;
  status: 'pending' | 'approved';
  upload_path: string | null;
  public_path: string | null;
  created_at: string;
}

/** Pending: oldest first (fair review order). Approved: newest first. Pure and stable. */
export function orderQueue(rows: AdminPhoto[], status: 'pending' | 'approved'): AdminPhoto[] {
  const dir = status === 'pending' ? 1 : -1;
  return [...rows].sort((a, b) => dir * (Date.parse(a.createdAt) - Date.parse(b.createdAt)));
}

/** The public object name for an approved photo: a fresh random name inside the house folder. */
export function publicPathFor(houseId: string, uuid: string): string {
  return `${houseId}/${uuid}.jpg`;
}

export async function adminPhotoQueue(regionId: string, status: 'pending' | 'approved'): Promise<AdminPhoto[]> {
  try {
    const { data, error } = await getSupabase().rpc('admin_photo_queue', { p_region_id: regionId, p_status: status });
    if (error) throw error;
    const rows = ((data ?? []) as RawAdminPhoto[]).map((r) => ({
      id: r.id,
      houseId: r.house_id,
      address: r.address,
      status: r.status,
      uploadPath: r.upload_path,
      publicPath: r.public_path,
      createdAt: r.created_at,
    }));
    return orderQueue(rows, status);
  } catch (e) {
    throw toDataError(e);
  }
}

export async function adminPhotoPreviewUrl(p: AdminPhoto): Promise<string> {
  try {
    const bucket = p.status === 'pending' ? 'photo-uploads' : 'photos';
    const path = p.status === 'pending' ? p.uploadPath : p.publicPath;
    if (!path) throw new DataError('not_found');
    const { data, error } = await getSupabase().storage.from(bucket).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) throw error ?? new DataError('not_found');
    return data.signedUrl;
  } catch (e) {
    throw toDataError(e);
  }
}

/** Re-encode the pending upload to a fresh random JPEG name, then flip the row. On any failure nothing is public. */
export async function adminApprovePhoto(p: AdminPhoto): Promise<void> {
  let uploaded: string | null = null;
  try {
    const url = await adminPhotoPreviewUrl(p);
    const res = await fetch(url);
    if (!res.ok) throw new DataError('upload_missing');
    const jpeg = await toJpeg(await res.blob(), 1600, 0.85);
    const path = publicPathFor(p.houseId, crypto.randomUUID());
    const sb = getSupabase();
    const up = await sb.storage.from('photos').upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw up.error;
    uploaded = path;
    const { error } = await sb.rpc('admin_approve_photo', { p_photo_id: p.id, p_public_path: path });
    if (error) throw error;
  } catch (e) {
    if (uploaded) {
      // Best effort; the reconciler is the backstop for an orphan.
      await getSupabase().storage.from('photos').remove([uploaded]).catch(() => undefined);
    }
    throw toDataError(e);
  }
}

async function simple(fn: string, args: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await getSupabase().rpc(fn, args);
    if (error) throw error;
  } catch (e) {
    throw toDataError(e);
  }
}

export const adminRejectPhoto = (id: string): Promise<void> => simple('admin_reject_photo', { p_photo_id: id });
export const adminRevokePhoto = (id: string): Promise<void> => simple('admin_revoke_photo', { p_photo_id: id });
export const adminSetPhotosOpen = (regionId: string, open: boolean): Promise<void> =>
  simple('admin_set_photos_open', { p_region_id: regionId, p_open: open });
