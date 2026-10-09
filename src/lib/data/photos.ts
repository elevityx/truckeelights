// Owner: WP-B (Spec_Photos_Release2 §1.3, Amendment 1).
import { getSupabase } from '@/lib/supabase/client';
import { toJpeg } from '@/lib/images/toJpeg';
import { toDataError } from './errors';
import {
  DataError,
  type AddPhotosProgress,
  type AddPhotosResult,
  type ConfirmResult,
  type DataErrorCode,
  type HousePhoto,
} from './types';

/** Most photos a visitor can send in one go (the server caps outstanding reservations at 3, too). */
export const MAX_PHOTOS_PER_BATCH = 3;

const wrap = (e: unknown): DataError => (e instanceof DataError ? e : toDataError(e));

/** Only http(s) URLs from the signer reach an <img src>. */
export function isPhotoUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const p = new URL(u).protocol;
    return p === 'https:' || p === 'http:';
  } catch {
    return false;
  }
}

/** Approved photos of a public house, as 1 h signed URLs minted by the `photo-urls` signer. */
export async function listHousePhotos(houseId: string): Promise<HousePhoto[]> {
  try {
    const { data, error } = await getSupabase().functions.invoke('photo-urls', { body: { house_id: houseId } });
    if (error) throw error;
    const rows: unknown = (data as { photos?: unknown } | null)?.photos;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r): r is { id: string; url: string } => !!r && typeof r.id === 'string' && isPhotoUrl(r.url))
      .map((r) => ({ id: r.id, url: r.url }));
  } catch (e) {
    throw wrap(e);
  }
}

export async function reservePhoto(houseId: string): Promise<{ photoId: string; uploadPath: string }> {
  try {
    const { data, error } = await getSupabase().rpc('reserve_photo', { p_house_id: houseId });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as { photo_id?: string; upload_path?: string } | null;
    if (!row?.photo_id || !row.upload_path) throw new DataError('unknown');
    return { photoId: row.photo_id, uploadPath: row.upload_path };
  } catch (e) {
    throw wrap(e);
  }
}

export async function uploadReserved(uploadPath: string, jpeg: Blob): Promise<void> {
  try {
    const { error } = await getSupabase()
      .storage.from('photo-uploads')
      .upload(uploadPath, jpeg, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
  } catch (e) {
    throw wrap(e);
  }
}

export async function confirmPhotoUpload(photoId: string): Promise<ConfirmResult> {
  try {
    const { data, error } = await getSupabase().rpc('confirm_photo_upload', { p_photo_id: photoId });
    if (error) throw error;
    if (data === 'pending' || data === 'over_cap') return data;
    throw new DataError('unknown');
  } catch (e) {
    throw wrap(e);
  }
}

/** The calls addPhotos makes, injectable for tests and the dev mock. */
export interface AddPhotosDeps {
  toJpeg(src: Blob): Promise<Blob>;
  reservePhoto(houseId: string): Promise<{ photoId: string; uploadPath: string }>;
  uploadReserved(uploadPath: string, jpeg: Blob): Promise<void>;
  confirmPhotoUpload(photoId: string): Promise<ConfirmResult>;
}

/** Errors after which every later file would fail the same way: stop and mark the rest failed. */
const STOP_CODES: readonly DataErrorCode[] = ['rate_limited', 'photos_closed', 'not_signed_in', 'auth_failed', 'captcha_failed'];

/**
 * Sequential per file: resize, reserve, upload, confirm. Only the first MAX_PHOTOS_PER_BATCH files are sent.
 * A per-file failure (e.g. invalid_image) counts as failed and moves on; a STOP_CODES failure ends the batch.
 */
export async function addPhotosWith(
  deps: AddPhotosDeps,
  houseId: string,
  files: readonly Blob[],
  onProgress: (p: AddPhotosProgress) => void,
): Promise<AddPhotosResult> {
  const batch = files.slice(0, MAX_PHOTOS_PER_BATCH);
  const total = batch.length;
  const out: AddPhotosResult = { pending: 0, overCap: 0, failed: 0 };
  for (let index = 0; index < total; index++) {
    try {
      onProgress({ index, total, stage: 'resizing' });
      const jpeg = await deps.toJpeg(batch[index]);
      onProgress({ index, total, stage: 'uploading' });
      const { photoId, uploadPath } = await deps.reservePhoto(houseId);
      await deps.uploadReserved(uploadPath, jpeg);
      const r = await deps.confirmPhotoUpload(photoId);
      if (r === 'pending') out.pending++;
      else out.overCap++;
      onProgress({ index, total, stage: 'done' });
    } catch (e) {
      const code = wrap(e).code;
      out.failed++;
      onProgress({ index, total, stage: 'failed', error: code });
      if (STOP_CODES.includes(code)) {
        for (let rest = index + 1; rest < total; rest++) {
          out.failed++;
          onProgress({ index: rest, total, stage: 'failed', error: code });
        }
        break;
      }
    }
  }
  return out;
}

const realDeps: AddPhotosDeps = {
  toJpeg: (src) => toJpeg(src),
  reservePhoto,
  uploadReserved,
  confirmPhotoUpload,
};

export async function addPhotos(
  houseId: string,
  files: File[],
  onProgress: (p: AddPhotosProgress) => void,
): Promise<AddPhotosResult> {
  return addPhotosWith(realDeps, houseId, files, onProgress);
}
