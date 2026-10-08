import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { qrPath } from './qr';

describe('qrPath', () => {
  it('draws exactly the dark modules of the QR code', () => {
    const { size, quiet, d } = qrPath('https://truckeelights.com/');
    const qr = QRCode.create('https://truckeelights.com/', { errorCorrectionLevel: 'M' });
    expect(size).toBe(qr.modules.size);
    expect(quiet).toBe(4);
    let dark = 0;
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) dark += Number(m[3]);
    expect(dark).toBe(Array.from(qr.modules.data).filter(Boolean).length);
    expect(d).toMatch(/^M4 4h7v1h-7z/); // top-left finder pattern starts at the quiet zone
  });
});
