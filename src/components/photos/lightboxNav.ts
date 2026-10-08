/** Wrap-around step through n photos. */
export function stepIndex(cur: number, d: number, n: number): number {
  if (n <= 0) return 0;
  return (((cur + d) % n) + n) % n;
}

/** Horizontal drag of at least 40 px: left swipe (negative dx) → next, right swipe → previous. */
export function swipeStep(dx: number, threshold = 40): -1 | 0 | 1 {
  if (dx <= -threshold) return 1;
  if (dx >= threshold) return -1;
  return 0;
}
