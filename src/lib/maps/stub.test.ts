import { afterEach, describe, expect, it } from 'vitest';
import type { PublicEvent, Region } from '@/lib/data/types';
import { createStubAdapter } from './stub';

// AC-L1-05: the keyless stub records the event ids it was given (a test/CI aid; nothing visible changes).
interface FakeEl {
  className: string;
  dataset: Record<string, string>;
  textContent: string;
  children: FakeEl[];
  appendChild(c: FakeEl): FakeEl;
  remove(): void;
}
function fakeEl(): FakeEl {
  return {
    className: '',
    dataset: {},
    textContent: '',
    children: [],
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {},
  };
}

const g = globalThis as unknown as { document?: unknown };
const saved = g.document;
afterEach(() => {
  g.document = saved;
});

const ev = (id: string) => ({ id }) as PublicEvent;

describe('stub adapter', () => {
  it('writes the sorted event ids to the panel dataset', async () => {
    g.document = { createElement: () => fakeEl() };
    const host = fakeEl();
    const a = createStubAdapter();
    await a.mount(host as unknown as HTMLElement, { season: 'halloween', region: {} as Region });
    const panel = host.children[0];
    expect(panel.className).toBe('empty');
    a.setEvents([ev('c'), ev('a'), ev('b')], 'America/Los_Angeles');
    expect(panel.dataset.eventIds).toBe('a,b,c');
    a.setEvents([], 'America/Los_Angeles');
    expect(panel.dataset.eventIds).toBe('');
  });

  it('keeps ids given before mount', async () => {
    g.document = { createElement: () => fakeEl() };
    const host = fakeEl();
    const a = createStubAdapter();
    a.setEvents([ev('z'), ev('y')], 'America/Los_Angeles');
    await a.mount(host as unknown as HTMLElement, { season: 'christmas', region: {} as Region });
    expect(host.children[0].dataset.eventIds).toBe('y,z');
  });
});
