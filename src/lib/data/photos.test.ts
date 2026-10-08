import { describe, expect, it } from 'vitest';
import { addPhotosWith, isPhotoUrl, type AddPhotosDeps } from './photos';
import { DataError, type AddPhotosProgress, type DataErrorCode } from './types';

const blob = (name: string) => new Blob([name], { type: 'image/png' });

function fake(opts: { failResizeAt?: number; failReserveAt?: { n: number; code: DataErrorCode }; overCapAt?: number } = {}) {
  const calls: string[] = [];
  let reserves = 0;
  let resizes = 0;
  const deps: AddPhotosDeps = {
    async toJpeg(src) {
      const i = resizes++;
      calls.push(`resize:${i}`);
      if (opts.failResizeAt === i) throw new DataError('invalid_image');
      return src;
    },
    async reservePhoto(houseId) {
      const i = reserves++;
      calls.push(`reserve:${houseId}:${i}`);
      if (opts.failReserveAt?.n === i) throw new DataError(opts.failReserveAt.code);
      return { photoId: `p${i}`, uploadPath: `${houseId}/p${i}.jpg` };
    },
    async uploadReserved(path) {
      calls.push(`upload:${path}`);
    },
    async confirmPhotoUpload(id) {
      calls.push(`confirm:${id}`);
      return opts.overCapAt !== undefined && id === `p${opts.overCapAt}` ? 'over_cap' : 'pending';
    },
  };
  return { deps, calls };
}

describe('addPhotosWith', () => {
  it('runs reserve, upload, confirm in order for 3 files', async () => {
    const { deps, calls } = fake();
    const progress: AddPhotosProgress[] = [];
    const r = await addPhotosWith(deps, 'h1', [blob('a'), blob('b'), blob('c')], (p) => progress.push(p));
    expect(r).toEqual({ pending: 3, overCap: 0, failed: 0 });
    expect(calls).toEqual([
      'resize:0', 'reserve:h1:0', 'upload:h1/p0.jpg', 'confirm:p0',
      'resize:1', 'reserve:h1:1', 'upload:h1/p1.jpg', 'confirm:p1',
      'resize:2', 'reserve:h1:2', 'upload:h1/p2.jpg', 'confirm:p2',
    ]);
    expect(progress.filter((p) => p.stage === 'done').map((p) => p.index)).toEqual([0, 1, 2]);
    expect(progress.every((p) => p.total === 3)).toBe(true);
  });

  it('sends only the first 3 files', async () => {
    const { deps, calls } = fake();
    const r = await addPhotosWith(deps, 'h1', [blob('a'), blob('b'), blob('c'), blob('d'), blob('e')], () => {});
    expect(r.pending).toBe(3);
    expect(calls.filter((c) => c.startsWith('reserve'))).toHaveLength(3);
  });

  it('stops on rate_limited from the 2nd file: 1 pending + 2 failed', async () => {
    const { deps, calls } = fake({ failReserveAt: { n: 1, code: 'rate_limited' } });
    const progress: AddPhotosProgress[] = [];
    const r = await addPhotosWith(deps, 'h1', [blob('a'), blob('b'), blob('c')], (p) => progress.push(p));
    expect(r).toEqual({ pending: 1, overCap: 0, failed: 2 });
    expect(calls.filter((c) => c.startsWith('reserve'))).toHaveLength(2);
    expect(progress.filter((p) => p.stage === 'failed')).toEqual([
      { index: 1, total: 3, stage: 'failed', error: 'rate_limited' },
      { index: 2, total: 3, stage: 'failed', error: 'rate_limited' },
    ]);
  });

  it('stops on photos_closed too', async () => {
    const { deps } = fake({ failReserveAt: { n: 0, code: 'photos_closed' } });
    const r = await addPhotosWith(deps, 'h1', [blob('a'), blob('b')], () => {});
    expect(r).toEqual({ pending: 0, overCap: 0, failed: 2 });
  });

  it('counts over_cap', async () => {
    const { deps } = fake({ overCapAt: 1 });
    const r = await addPhotosWith(deps, 'h1', [blob('a'), blob('b'), blob('c')], () => {});
    expect(r).toEqual({ pending: 2, overCap: 1, failed: 0 });
  });

  it('counts invalid_image on resize as failed and continues without reserving', async () => {
    const { deps, calls } = fake({ failResizeAt: 0 });
    const progress: AddPhotosProgress[] = [];
    const r = await addPhotosWith(deps, 'h1', [blob('a'), blob('b')], (p) => progress.push(p));
    expect(r).toEqual({ pending: 1, overCap: 0, failed: 1 });
    expect(calls.filter((c) => c.startsWith('reserve'))).toHaveLength(1);
    expect(progress[1]).toEqual({ index: 0, total: 2, stage: 'failed', error: 'invalid_image' });
  });

  it('maps a raw error to a DataError code', async () => {
    const { deps } = fake();
    deps.uploadReserved = async () => {
      throw new TypeError('Failed to fetch');
    };
    const progress: AddPhotosProgress[] = [];
    const r = await addPhotosWith(deps, 'h1', [blob('a')], (p) => progress.push(p));
    expect(r.failed).toBe(1);
    expect(progress.at(-1)?.error).toBe('network');
  });
});

describe('isPhotoUrl', () => {
  it('accepts http(s) only', () => {
    expect(isPhotoUrl('https://x.supabase.co/storage/v1/object/sign/photos/a.jpg?token=t')).toBe(true);
    expect(isPhotoUrl('http://127.0.0.1:54321/storage/v1/object/sign/photos/a.jpg')).toBe(true);
    expect(isPhotoUrl('javascript:alert(1)')).toBe(false);
    expect(isPhotoUrl('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isPhotoUrl(42)).toBe(false);
    expect(isPhotoUrl('not a url')).toBe(false);
  });
});
