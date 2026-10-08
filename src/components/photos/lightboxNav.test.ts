import { describe, expect, it } from 'vitest';
import { stepIndex, swipeStep } from './lightboxNav';

describe('lightbox navigation', () => {
  it('wraps both ways', () => {
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(1, 1, 3)).toBe(2);
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
  it('turns a swipe into a step only past the threshold', () => {
    expect(swipeStep(-80)).toBe(1);
    expect(swipeStep(80)).toBe(-1);
    expect(swipeStep(20)).toBe(0);
    expect(swipeStep(-39)).toBe(0);
  });
});
