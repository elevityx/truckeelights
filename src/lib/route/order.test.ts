import { describe, expect, it } from 'vitest';
import { orderStops, pathLength } from './order';

// A small grid near downtown Truckee: roughly 100 m steps.
const P = (x: number, y: number) => ({ lat: 39.32 + y * 0.0009, lng: -120.19 + x * 0.00116 });

describe('orderStops', () => {
  it('handles zero and one stop', () => {
    expect(orderStops([])).toEqual([]);
    expect(orderStops([P(0, 0)])).toEqual([0]);
    expect(orderStops([P(0, 0)], P(5, 5))).toEqual([0]);
  });

  it('keeps the first stop first when there is no start', () => {
    const stops = [P(3, 0), P(0, 0), P(1, 0), P(2, 0)];
    const o = orderStops(stops);
    expect(o[0]).toBe(0);
    expect(o).toEqual([0, 3, 2, 1]);
  });

  it('starts nearest to the start point', () => {
    const stops = [P(3, 0), P(0, 0), P(1, 0), P(2, 0)];
    expect(orderStops(stops, P(-1, 0))).toEqual([1, 2, 3, 0]);
  });

  it('is deterministic', () => {
    const stops = [P(0, 0), P(4, 1), P(2, 3), P(1, 1), P(3, 3), P(0, 4), P(4, 4)];
    const a = orderStops(stops, P(2, 2));
    for (let i = 0; i < 5; i++) expect(orderStops(stops, P(2, 2))).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('2-opt removes a crossing that nearest neighbor leaves', () => {
    // Nearest neighbor from the first stop crosses itself on this set (about 990 m); 2-opt untangles it (about 875 m).
    const stops = [P(0, 1.6), P(1.1, 1.5), P(2.4, 2.6), P(0.6, 0.1), P(0.2, 3.2), P(0.6, 2.2), P(2, 0.4)];
    const nn = nearestNeighborOnly(stops);
    const o = orderStops(stops);
    const len = (ix: number[]) => pathLength(ix.map((i) => stops[i]));
    expect(nn).toEqual([0, 5, 1, 6, 3, 2, 4]);
    expect(o).toEqual([0, 5, 4, 2, 1, 6, 3]);
    expect(len(o)).toBeLessThan(len(nn) - 100);
    expect(hasCrossing(o.map((i) => stops[i]))).toBe(false);
    expect(hasCrossing(nn.map((i) => stops[i]))).toBe(true);
  });

  it('never makes a route longer than nearest neighbor', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 20; t++) {
      const stops = Array.from({ length: 12 }, () => P(rnd() * 10, rnd() * 10));
      const len = (ix: number[]) => pathLength(ix.map((i) => stops[i]));
      expect(len(orderStops(stops))).toBeLessThanOrEqual(len(nearestNeighborOnly(stops)) + 1e-6);
    }
  });
});

function nearestNeighborOnly(stops: { lat: number; lng: number }[]): number[] {
  const left = new Set(stops.map((_, i) => i));
  const out = [0];
  left.delete(0);
  while (left.size) {
    const at = stops[out[out.length - 1]];
    let best = -1;
    let bd = Infinity;
    for (const i of left) {
      const d = pathLength([at, stops[i]]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    out.push(best);
    left.delete(best);
  }
  return out;
}

function hasCrossing(p: { lat: number; lng: number }[]): boolean {
  const ccw = (a: typeof p[0], b: typeof p[0], c: typeof p[0]) => (c.lat - a.lat) * (b.lng - a.lng) > (b.lat - a.lat) * (c.lng - a.lng);
  for (let i = 0; i < p.length - 1; i++)
    for (let j = i + 2; j < p.length - 1; j++) {
      const [a, b, c, d] = [p[i], p[i + 1], p[j], p[j + 1]];
      if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) return true;
    }
  return false;
}
