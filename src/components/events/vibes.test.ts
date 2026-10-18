import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadVibesWidget, resetVibesLoader, VIBES_WIDGET } from './vibes';

// AC-L1-02: the pinned release and the memoized, SRI-checked loader (fake document and window; Lights has no DOM test env).

type Handler = () => void;
interface FakeScript {
  attrs: Record<string, string>;
  async: boolean;
  src: string;
  handlers: Record<string, Handler[]>;
  setAttribute(k: string, v: string): void;
  addEventListener(ev: string, fn: Handler): void;
}

function fakes(onAppend?: (s: FakeScript, win: Record<string, unknown>) => void) {
  const scripts: FakeScript[] = [];
  const win: Record<string, unknown> = {};
  const doc = {
    createElement(tag: string) {
      expect(tag).toBe('script');
      const s: FakeScript = {
        attrs: {},
        async: false,
        src: '',
        handlers: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        addEventListener(ev, fn) {
          (this.handlers[ev] ??= []).push(fn);
        },
      };
      return s;
    },
    head: {
      appendChild(s: FakeScript) {
        scripts.push(s);
        onAppend?.(s, win);
        return s;
      },
    },
  };
  const fire = (s: FakeScript, ev: string) => s.handlers[ev]?.forEach((fn) => fn());
  return { doc: doc as unknown as Document, win: win as unknown as Window, scripts, fire, rawWin: win };
}

const global1 = { version: '1.0.1', createController: () => ({}) };

beforeEach(() => resetVibesLoader());
afterEach(() => vi.useRealTimers());

describe('VIBES_WIDGET', () => {
  it('pins one versioned file on truckeevibes.com with a sha384 integrity', () => {
    expect(VIBES_WIDGET.src).toMatch(/^https:\/\/truckeevibes\.com\/widget\/v1\/tv-events\.\d+\.\d+\.\d+\.js$/);
    expect(VIBES_WIDGET.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
  });
});

describe('loadVibesWidget', () => {
  it('appends exactly one async, SRI-pinned, anonymous-CORS script and resolves with the global', async () => {
    const f = fakes();
    const p = loadVibesWidget(f.doc, f.win);
    expect(f.scripts).toHaveLength(1);
    const s = f.scripts[0];
    expect(s.src).toBe(VIBES_WIDGET.src);
    expect(s.async).toBe(true);
    expect(s.attrs.integrity).toBe(VIBES_WIDGET.integrity);
    expect(s.attrs.crossorigin).toBe('anonymous');
    expect(s.attrs.referrerpolicy).toBe('strict-origin-when-cross-origin');
    f.rawWin.TruckeeVibes = global1;
    f.fire(s, 'load');
    await expect(p).resolves.toBe(global1);
  });

  it('memoizes: a second call returns the same promise and adds no script', () => {
    const f = fakes();
    const a = loadVibesWidget(f.doc, f.win);
    const b = loadVibesWidget(f.doc, f.win);
    expect(b).toBe(a);
    expect(f.scripts).toHaveLength(1);
    a.catch(() => {});
  });

  it('rejects on the script error event (network failure or SRI mismatch)', async () => {
    const f = fakes();
    const p = loadVibesWidget(f.doc, f.win);
    f.fire(f.scripts[0], 'error');
    await expect(p).rejects.toThrow(/tv_load/);
  });

  it('rejects after 5,000 ms without a load event', async () => {
    vi.useFakeTimers();
    const f = fakes();
    const p = loadVibesWidget(f.doc, f.win);
    const seen = vi.fn();
    p.catch(seen);
    await vi.advanceTimersByTimeAsync(4999);
    expect(seen).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrow(/tv_timeout/);
  });

  it('rejects when the script loads but the global is missing', async () => {
    const f = fakes();
    const p = loadVibesWidget(f.doc, f.win);
    f.fire(f.scripts[0], 'load');
    await expect(p).rejects.toThrow(/tv_global/);
  });

  it('rejects a different major version', async () => {
    const f = fakes();
    const p = loadVibesWidget(f.doc, f.win);
    f.rawWin.TruckeeVibes = { ...global1, version: '2.0.0' };
    f.fire(f.scripts[0], 'load');
    await expect(p).rejects.toThrow(/tv_version/);
  });
});
