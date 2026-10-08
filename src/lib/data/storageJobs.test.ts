import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let jobs: unknown[] = [];
let completeResult: boolean | { message: string } = true;
let removeErr: { message: string } | null = null;
let copyErr: { message: string } | null = null;

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'admin_storage_jobs') return { data: jobs, error: null };
      calls.push(`complete:${args.p_job_id}`);
      return typeof completeResult === 'boolean' ? { data: completeResult, error: null } : { data: null, error: completeResult };
    },
    storage: {
      from: (b: string) => ({
        remove: async (n: string[]) => (calls.push(`remove:${b}:${n[0]}`), { error: removeErr }),
        copy: async (a: string, c: string) => (calls.push(`copy:${a}>${c}`), { error: copyErr }),
      }),
    },
  }),
}));

import { runStorageJobsFallback } from './storageJobs';

const raw = (id: number, kind: string, bucket: string, o: string, n: string | null = null) => ({
  id, kind, bucket, object_name: o, new_object_name: n, attempts: 0, last_error: null, created_at: '2026-10-10T00:00:00Z',
});

beforeEach(() => {
  calls.length = 0;
  completeResult = true;
  removeErr = null;
  copyErr = null;
});

describe('runStorageJobsFallback', () => {
  it('delete: remove then complete', async () => {
    jobs = [raw(1, 'delete_public', 'photos', 'h/a.jpg')];
    expect(await runStorageJobsFallback('r')).toEqual({ done: 1, open: 0 });
    expect(calls).toEqual(['remove:photos:h/a.jpg', 'complete:1']);
  });
  it('rotate: copy, remove old, complete', async () => {
    jobs = [raw(2, 'rotate_public', 'photos', 'h/a.jpg', 'h/b.jpg')];
    copyErr = { message: 'The resource already exists' };
    expect((await runStorageJobsFallback('r')).done).toBe(1);
    expect(calls).toEqual(['copy:h/a.jpg>h/b.jpg', 'remove:photos:h/a.jpg', 'complete:2']);
  });
  it('a false completion counts as open', async () => {
    jobs = [raw(3, 'delete_upload', 'photo-uploads', 'u')];
    completeResult = false;
    expect(await runStorageJobsFallback('r')).toEqual({ done: 0, open: 1 });
  });
  it('not found still completes', async () => {
    jobs = [raw(4, 'delete_public', 'photos', 'gone')];
    removeErr = { message: 'Object not found' };
    expect((await runStorageJobsFallback('r')).done).toBe(1);
    expect(calls).toContain('complete:4');
  });
  it('other storage errors leave the job open and never complete it', async () => {
    jobs = [raw(5, 'delete_public', 'photos', 'x')];
    removeErr = { message: 'boom' };
    expect(await runStorageJobsFallback('r')).toEqual({ done: 0, open: 1 });
    expect(calls).not.toContain('complete:5');
  });
  it('forbidden from completion is thrown', async () => {
    jobs = [raw(6, 'delete_public', 'photos', 'x')];
    completeResult = { message: 'forbidden' };
    await expect(runStorageJobsFallback('r')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
