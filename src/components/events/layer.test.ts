import { describe, expect, it } from 'vitest';
import { HOUSE_HINT_KEY, LAYER_KEY, layerUrl, readHouseHint, readLayer, saveHouseHintSeen, saveLayer } from './layer';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
const throwing = {
  getItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

describe('layer switch state', () => {
  it('defaults to events', () => {
    expect(readLayer('', () => memory())).toBe('events');
    expect(readLayer('', () => null)).toBe('events');
  });
  it('remembers the choice', () => {
    const s = memory();
    saveLayer('both', () => s);
    expect(s.m.get(LAYER_KEY)).toBe('both');
    expect(readLayer('', () => s)).toBe('both');
  });
  it('lets the URL win, and ignores junk', () => {
    const s = memory();
    saveLayer('both', () => s);
    expect(readLayer('?layer=events', () => s)).toBe('events');
    expect(readLayer('?layer=nope', () => s)).toBe('both');
    s.m.set(LAYER_KEY, 'garbage');
    expect(readLayer('', () => s)).toBe('events');
  });
  it('survives a throwing localStorage', () => {
    expect(readLayer('', () => throwing)).toBe('events');
    expect(readLayer('?layer=both', () => throwing)).toBe('both');
    expect(() => saveLayer('events', () => throwing)).not.toThrow();
  });
  it('survives a getter that throws on access', () => {
    const boom = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(readLayer('', boom)).toBe('events');
    expect(() => saveLayer('events', boom)).not.toThrow();
  });
  it('writes the layer into the URL, keeping other params', () => {
    expect(layerUrl('https://x.test/?view=list', 'houses')).toBe('/?view=list&layer=houses');
    expect(layerUrl('https://x.test/?layer=both&event=abc', 'events')).toBe('/?event=abc');
  });
  it('shows the Houses hint until the switch is used', () => {
    const s = memory();
    expect(readHouseHint(() => s)).toBe(true);
    saveHouseHintSeen(() => s);
    expect(s.m.get(HOUSE_HINT_KEY)).toBe('1');
    expect(readHouseHint(() => s)).toBe(false);
    expect(readHouseHint(() => throwing)).toBe(true);
    expect(() => saveHouseHintSeen(() => throwing)).not.toThrow();
  });
});
