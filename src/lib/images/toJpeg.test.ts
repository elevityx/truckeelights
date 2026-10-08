import { describe, expect, it } from 'vitest';
import { fitWithin } from './toJpeg';

describe('fitWithin', () => {
  it('scales a landscape photo down', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
  });
  it('leaves a small photo unchanged', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });
  it('scales a portrait photo by its long side', () => {
    expect(fitWithin(1200, 4000, 1600)).toEqual({ w: 480, h: 1600 });
  });
});
