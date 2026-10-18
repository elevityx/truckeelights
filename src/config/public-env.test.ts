import { describe, expect, it } from 'vitest';
import { parseProvider } from './public-env';

// AC-L1-01: only the exact strings 'shadow' and 'vibes' turn the TruckeeVibes widget on; everything else is the native UI.
describe('parseProvider', () => {
  it('defaults to lights', () => {
    for (const v of [undefined, '', 'lights', 'Vibes', 'vibes ', ' shadow', 'SHADOW', 'true', '1']) expect(parseProvider(v)).toBe('lights');
  });
  it('accepts shadow and vibes exactly', () => {
    expect(parseProvider('shadow')).toBe('shadow');
    expect(parseProvider('vibes')).toBe('vibes');
  });
});
