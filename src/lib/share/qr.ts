import QRCode from 'qrcode';

export interface QrPath {
  /** Module count per side (the SVG viewBox is size + 2 * quiet). */
  size: number;
  quiet: number;
  /** One path of 1×1 squares, one subpath per dark run. */
  d: string;
}

/** Build-time QR as SVG path data. Used only from server components, so it runs during `next build` and ships no runtime code. */
export function qrPath(text: string, quiet = 4): QrPath {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  let d = '';
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!data[y * n + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < n && data[y * n + x]) x++;
      d += `M${start + quiet} ${y + quiet}h${x - start}v1h${start - x}z`;
    }
  }
  return { size: n, quiet, d };
}
