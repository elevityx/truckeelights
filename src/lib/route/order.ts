import { haversine, type Point } from './geo';

/**
 * Suggested stop order: nearest neighbor from `start` (or from the first stop when there is no start), then 2-opt on
 * the open path. Returns indexes into `stops`. Deterministic: ties go to the lower index, and 2-opt takes the first
 * improving move in a fixed scan order.
 */
export function orderStops(stops: readonly Point[], start?: Point | null): number[] {
  const n = stops.length;
  if (n <= 1) return stops.map((_, i) => i);

  // Nearest neighbor. With no start, the first stop stays first.
  const left = new Set(stops.map((_, i) => i));
  const order: number[] = [];
  let at: Point;
  if (start) {
    at = start;
  } else {
    order.push(0);
    left.delete(0);
    at = stops[0];
  }
  while (left.size > 0) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = haversine(at, stops[i]);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && i < best)) {
        best = i;
        bestD = d;
      }
    }
    order.push(best);
    left.delete(best);
    at = stops[best];
  }

  // 2-opt on the open path [start?, ...order]; node 0 of the path never moves.
  const path: Point[] = start ? [start, ...order.map((i) => stops[i])] : order.map((i) => stops[i]);
  const idx: number[] = start ? [-1, ...order] : [...order];
  const d = (a: number, b: number) => haversine(path[a], path[b]);
  const m = path.length;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 1; i < m - 1 && !improved; i++) {
      for (let k = i + 1; k < m; k++) {
        const before = d(i - 1, i) + (k + 1 < m ? d(k, k + 1) : 0);
        const after = d(i - 1, k) + (k + 1 < m ? d(i, k + 1) : 0);
        if (after < before - 1e-6) {
          reverse(path, i, k);
          reverse(idx, i, k);
          improved = true;
          break;
        }
      }
    }
  }
  return start ? idx.slice(1) : idx;
}

function reverse<T>(a: T[], i: number, k: number): void {
  while (i < k) {
    [a[i], a[k]] = [a[k], a[i]];
    i++;
    k--;
  }
}

/** Total straight-line length of a path, meters (from `start` when given). */
export function pathLength(stops: readonly Point[], start?: Point | null): number {
  const p = start ? [start, ...stops] : [...stops];
  let t = 0;
  for (let i = 1; i < p.length; i++) t += haversine(p[i - 1], p[i]);
  return t;
}
