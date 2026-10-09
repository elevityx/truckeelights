import { DataError } from '@/lib/data/types';

const MAX_BYTES = 4_900_000;

/** Scale (w, h) down so the longer side is at most `max`. Never upscales. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function encode(canvas: HTMLCanvasElement | OffscreenCanvas, q: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: q }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
}

/** Decode, orient, resize and re-encode as JPEG (drops all metadata). Throws invalid_image on any failure. */
export async function toJpeg(src: Blob, maxSide = 1600, quality = 0.82): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
  } catch {
    throw new DataError('invalid_image');
  }
  try {
    const { w, h } = fitWithin(bmp.width, bmp.height, maxSide);
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new DataError('invalid_image');
    ctx.drawImage(bmp, 0, 0, w, h);
    for (const q of [quality, 0.7, 0.6]) {
      const blob = await encode(canvas, q);
      if (!blob) throw new DataError('invalid_image');
      if (blob.size <= MAX_BYTES) return blob;
    }
    throw new DataError('invalid_image');
  } finally {
    bmp.close();
  }
}
