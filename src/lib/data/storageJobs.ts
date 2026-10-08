// Owner: WP-C. Browser-side fallback for the storage-job runner (Spec_Photos_Release2 §1.3, Amendment 1).
// Completion is always decided by the server (admin_complete_storage_job); the client never marks anything done.
import { getSupabase } from '@/lib/supabase/client';
import { toDataError } from './errors';
import type { StorageJob } from './types';

interface RawJob {
  id: number;
  kind: StorageJob['kind'];
  bucket: StorageJob['bucket'];
  object_name: string;
  new_object_name: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export async function adminStorageJobs(regionId: string): Promise<StorageJob[]> {
  try {
    const { data, error } = await getSupabase().rpc('admin_storage_jobs', { p_region_id: regionId });
    if (error) throw error;
    return ((data ?? []) as RawJob[]).map((j) => ({
      id: Number(j.id),
      kind: j.kind,
      bucket: j.bucket,
      objectName: j.object_name,
      newObjectName: j.new_object_name,
      attempts: j.attempts,
      lastError: j.last_error,
      createdAt: j.created_at,
    }));
  } catch (e) {
    throw toDataError(e);
  }
}

type StorageErr = { message?: string } | null | undefined;
const msg = (e: StorageErr) => (e?.message ?? '').toLowerCase();
const isNotFound = (e: StorageErr) => msg(e).includes('not found');
const isExists = (e: StorageErr) => msg(e).includes('already exists') || msg(e).includes('duplicate');

/**
 * Run every open job from the browser as the admin. Per-job storage failures leave that job open (it is retried
 * by the runner and shown by the banner). A "forbidden" from the jobs list or completion RPC is thrown.
 */
export async function runStorageJobsFallback(regionId: string): Promise<{ done: number; open: number }> {
  const sb = getSupabase();
  const jobs = await adminStorageJobs(regionId);
  let done = 0;
  let open = 0;
  for (const job of jobs) {
    try {
      const store = sb.storage.from(job.bucket);
      if (job.kind === 'rotate_public') {
        if (!job.newObjectName) {
          open++;
          continue;
        }
        const cp = await store.copy(job.objectName, job.newObjectName);
        if (cp.error && !isExists(cp.error) && !isNotFound(cp.error)) {
          open++;
          continue;
        }
      }
      const rm = await store.remove([job.objectName]);
      if (rm.error && !isNotFound(rm.error)) {
        open++;
        continue;
      }
      const { data, error } = await sb.rpc('admin_complete_storage_job', { p_job_id: job.id });
      if (error) throw error;
      if (data === true) done++;
      else open++;
    } catch (e) {
      const d = toDataError(e);
      if (d.code === 'forbidden') throw d;
      open++;
    }
  }
  return { done, open };
}
