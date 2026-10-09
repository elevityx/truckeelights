import { describe, expect, it } from 'vitest';
import { captureFocus } from './focusRestore';

const el = (connected = true) => {
  const e = { isConnected: connected, focused: 0, focus() { e.focused += 1; } };
  return e;
};

describe('captureFocus', () => {
  it('returns focus to the element that opened the sheet', () => {
    const pill = el();
    const doc = { activeElement: pill as unknown, body: {} };
    const restore = captureFocus(doc);
    doc.activeElement = { heading: true }; // the sheet took focus
    restore();
    expect(pill.focused).toBe(1);
  });
  it('does nothing when the opener left the page (the pill hides at zero stops)', () => {
    const pill = el();
    const doc = { activeElement: pill as unknown, body: {} };
    const restore = captureFocus(doc);
    pill.isConnected = false;
    restore();
    expect(pill.focused).toBe(0);
  });
  it('does nothing when nothing meaningful had focus', () => {
    const body = el();
    const restore = captureFocus({ activeElement: body, body });
    restore();
    expect(body.focused).toBe(0);
    expect(() => captureFocus({ activeElement: null, body: {} })()).not.toThrow();
  });
});
