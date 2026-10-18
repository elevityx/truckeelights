// Regression cases for the parity comparator itself (review P2): content the A/B rule skips must fail, not pass silently.
// Synthetic images only (no browser); scale 1, so CSS px = device px.
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import { MAX_DIFF, parity, type Shot } from './harness';

const W = 120;
type Block = [y0: number, y1: number, tone: number];
function img(h: number, blocks: Block[]): PNG {
  const p = new PNG({ width: W, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const b = blocks.find(([a, z]) => y >= a && y < z);
      const v = b ? ((x + y - b[0]) % 8 < 4 ? b[2] : 255 - b[2]) : 20; // content is striped diagonally (changes row to row); background is flat
      p.data[i] = p.data[i + 1] = p.data[i + 2] = v;
      p.data[i + 3] = 255;
    }
  return p;
}
const ROWS: Block[] = [[10, 30, 200], [40, 60, 150], [70, 90, 100]];
const native = (): Shot => ({ png: img(150, [...ROWS, [100, 110, 60]]), scale: 1 });
const widget = (rows: Block[], creditTop: number, extraTail = 0): Shot => {
  const anchor = creditTop + 20;
  return { png: img(anchor + 50 + extraTail, [...rows, [creditTop, creditTop + 10, 240], [anchor, anchor + 10, 60]]), credit: { top: creditTop, bottom: creditTop + 10 }, scale: 1 };
};
const fails = (n: Shot, w: Shot) => {
  try {
    return parity(n, w).ratio > MAX_DIFF;
  } catch {
    return true;
  }
};

test.describe('parity comparator', () => {
  test.skip(() => test.info().project.name !== 'desktop', 'pure function: run once');
  test('identical content around the credit passes', () => {
    expect(parity(native(), widget(ROWS, 100)).ratio).toBe(0);
  });
  test('a missing final row fails', () => {
    expect(fails(native(), widget(ROWS.slice(0, 2), 70))).toBe(true);
  });
  test('extra content fails', () => {
    expect(fails(native(), widget([...ROWS, [100, 120, 180]], 130))).toBe(true);
  });
  test('a displaced section fails', () => {
    expect(fails(native(), widget([ROWS[0], ROWS[1], [76, 96, 100]], 100))).toBe(true);
  });
  test('an unmatched tail fails', () => {
    expect(fails(native(), widget(ROWS, 100, 12))).toBe(true);
  });
  test('sheet (credit last): a missing row fails, identical passes', () => {
    const n: Shot = { png: img(120, [...ROWS]), scale: 1 };
    const ok: Shot = { png: img(130, [...ROWS, [100, 110, 240]]), credit: { top: 100, bottom: 110 }, scale: 1 };
    expect(parity(n, ok).ratio).toBe(0);
    const missing: Shot = { png: img(100, [ROWS[0], ROWS[1], [70, 80, 240]]), credit: { top: 70, bottom: 80 }, scale: 1 };
    expect(fails(n, missing)).toBe(true);
  });
  test('fixed-height box: the credit may only cover empty native rows', () => {
    const n: Shot = { png: img(150, [...ROWS]), scale: 1 };
    const ok: Shot = { png: img(150, [...ROWS, [100, 110, 240]]), credit: { top: 100, bottom: 110 }, scale: 1 };
    expect(parity(n, ok).ratio).toBe(0);
    const covering: Shot = { png: img(150, [ROWS[0], ROWS[1], [70, 80, 240]]), credit: { top: 70, bottom: 80 }, scale: 1 };
    expect(fails(n, covering)).toBe(true);
  });
});
