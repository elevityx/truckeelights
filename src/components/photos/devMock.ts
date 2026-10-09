// DEV ONLY. Loaded by api.ts only under `next dev` with NEXT_PUBLIC_PHOTOS_MOCK=1; dead code in production builds.
// Pick a scenario with ?photosMock=thanks|overcap|rate|closed|invalid|captcha|empty|loaderror (default thanks)
// and slow the fake network with ?photosMockSlow=1 to look at the progress state.
import { toJpeg } from '@/lib/images/toJpeg';
import { addPhotosWith } from '@/lib/data/photos';
import { DataError, type HousePhoto } from '@/lib/data/types';
import type { PhotosApi } from './api';

const q = () => new URLSearchParams(window.location.search);
const scenario = () => q().get('photosMock') ?? 'thanks';
const wait = () => new Promise((r) => setTimeout(r, q().get('photosMockSlow') ? 5000 : 600));

/** A night-time "photo" of a decorated house, drawn on a canvas so nothing external is fetched. */
async function fakePhoto(seed: number, halloween: boolean): Promise<string> {
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 600;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 600);
  sky.addColorStop(0, halloween ? '#1d0b33' : '#0b1a33');
  sky.addColorStop(1, halloween ? '#3a1550' : '#1d3557');
  g.fillStyle = sky;
  g.fillRect(0, 0, 800, 600);
  g.fillStyle = halloween ? '#ffd27a' : '#f2f5ff';
  g.beginPath();
  g.arc(120 + seed * 170, 110, halloween ? 46 : 3, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 40; i++) g.fillRect((i * 97 + seed * 31) % 800, (i * 53) % 260, 2, 2);
  // snow or lawn
  g.fillStyle = halloween ? '#0e0716' : '#dfe8f5';
  g.fillRect(0, 470, 800, 130);
  // house
  const x = 170 + seed * 30;
  g.fillStyle = halloween ? '#120a1c' : '#2a1f1a';
  g.fillRect(x, 300, 420, 180);
  g.beginPath();
  g.moveTo(x - 30, 310);
  g.lineTo(x + 210, 170);
  g.lineTo(x + 450, 310);
  g.fill();
  g.fillStyle = halloween ? '#ff9a3c' : '#ffd36b';
  [[x + 50, 340], [x + 300, 340]].forEach(([wx, wy]) => g.fillRect(wx, wy, 70, 60));
  g.fillRect(x + 185, 380, 50, 100);
  // lights along the roof / pumpkins on the steps
  const colors = halloween ? ['#ff7a1a', '#8ae234', '#b56cff'] : ['#ff4d4d', '#ffd84d', '#4dd2ff', '#6dff8a'];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const lx = x - 30 + t * 480;
    const ly = t < 0.5 ? 310 - t * 2 * 140 : 170 + (t - 0.5) * 2 * 140;
    g.fillStyle = colors[i % colors.length];
    g.shadowColor = g.fillStyle;
    g.shadowBlur = 14;
    g.beginPath();
    g.arc(lx, ly, 6, 0, Math.PI * 2);
    g.fill();
  }
  if (halloween) {
    g.fillStyle = '#ff7a1a';
    [x + 120, x + 260, x + 330].forEach((px, i) => {
      g.beginPath();
      g.ellipse(px, 470, 24 - i * 3, 18 - i * 2, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  g.shadowBlur = 0;
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return URL.createObjectURL(blob!);
}

export function devMockApi(): PhotosApi {
  return {
    async listHousePhotos(): Promise<HousePhoto[]> {
      await wait();
      const s = scenario();
      if (s === 'loaderror') throw new DataError('network');
      if (s === 'empty') return [];
      const halloween = document.documentElement.dataset.theme !== 'christmas';
      return Promise.all([0, 1, 2, 3].map(async (i) => ({ id: `mock-${i}`, url: await fakePhoto(i, halloween) })));
    },
    async hasSession() {
      return scenario() !== 'captcha';
    },
    async ensureAnonymousSession() {
      await wait();
      throw new DataError('captcha_failed');
    },
    addPhotos(houseId, files, onProgress) {
      const s = scenario();
      let n = 0;
      let resized = 0;
      return addPhotosWith(
        {
          async toJpeg(src) {
            await wait();
            if (s === 'invalid' && resized++ === 0) throw new DataError('invalid_image');
            return toJpeg(src);
          },
          async reservePhoto() {
            const i = n++;
            await wait();
            if (s === 'closed') throw new DataError('photos_closed');
            if (s === 'rate' && i === 1) throw new DataError('rate_limited');
            return { photoId: `mock-${i}`, uploadPath: `${houseId}/mock-${i}.jpg` };
          },
          async uploadReserved() {
            await wait();
          },
          async confirmPhotoUpload(id) {
            return s === 'overcap' && id !== 'mock-0' ? 'over_cap' : 'pending';
          },
        },
        houseId,
        files,
        onProgress,
      );
    },
  };
}
