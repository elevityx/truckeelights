// Shared harness: the phone project's CDP mobile metrics, booting a build on a fixture, shadow-aware DOM probes, and the A/B pixel diff.
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { installRoutes, LIGHTS, NOW, VIBES, type RouteOptions, type Routes, type Season } from './routes';

export const test = base.extend<{ phone: boolean }>({
  phone: [
    async ({ page }, use, info) => {
      const phone = info.project.name === 'phone';
      if (phone) {
        // Real 390 px layout (headless --window-size clamps near 500 px): CDP device metrics with mobile=true.
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
      }
      await use(phone);
    },
    { auto: true },
  ],
});
export { expect };

export type Build = 'lights' | 'vibes';
export const origin = (b: Build) => (b === 'lights' ? LIGHTS : VIBES);
export const SEASONS: Season[] = ['halloween', 'christmas'];

export interface Boot extends Routes {
  consoleErrors: string[];
}

/** Routes + fixture clock, then load `path` on `build`. Waits for the app shell (the region context has loaded). */
export async function boot(page: Page, build: Build, path: string, o: RouteOptions): Promise<Boot> {
  const r = await installRoutes(page, o);
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.clock.install({ time: NOW(o.season) });
  await page.goto(`${origin(build)}${path}`);
  await expect(page.locator('.pbody')).toBeVisible();
  return Object.assign(r, { consoleErrors });
}

/** Widget list/upcoming rendered (rows or the empty state) inside its shadow root. */
export async function widgetReady(page: Page, host: '[data-tv-list]' | '[data-tv-upcoming]') {
  await expect(page.locator(`${host} .erow, ${host} .eempty`).first()).toBeVisible();
}

/** The open event sheet: the native Sheet (light DOM) or the widget panel (overlay shadow root). */
export const nativeSheet = (page: Page) => page.locator('aside[role=dialog][aria-label="Event details"]:not([data-tv-overlay] *)');
export const widgetSheet = (page: Page) => page.locator('[data-tv-overlay] aside[role=dialog]');

/** Counts [role=dialog] across the document and every open shadow root. */
export const dialogCount = (page: Page) =>
  page.evaluate(() => {
    let n = 0;
    const walk = (root: Document | ShadowRoot) => {
      n += root.querySelectorAll('[role=dialog]').length;
      root.querySelectorAll('*').forEach((el) => el.shadowRoot && walk(el.shadowRoot));
    };
    walk(document);
    return n;
  });

/** The deepest focused element's aria-label / data-id / tag. */
export const deepFocus = (page: Page) =>
  page.evaluate(() => {
    let a: Element | null = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return { tag: a?.tagName.toLowerCase() ?? null, label: a?.getAttribute('aria-label') ?? null, id: a?.getAttribute('data-id') ?? null, text: a?.textContent ?? null };
  });

export const noHorizontalScroll = async (page: Page) => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `scrollWidth ${w.sw} vs innerWidth ${w.iw}`).toBe(w.iw);
};

// ---- pixel parity --------------------------------------------------------------------------------------

/** Lets a list grow to its content so the whole `.list` element can be captured (same CSS in both builds), and hides floating chrome. */
export async function unclipList(page: Page) {
  await page.addStyleTag({
    content:
      'html,body,.pbody,.views{height:auto!important;min-height:0!important;overflow:visible!important}' +
      '.pbody,.views{display:block!important}' +
      '.list{position:relative!important;inset:auto!important;overflow:visible!important}' +
      '.viewtoggle,.routepill,.toast,.lorebar,#site-footer{visibility:hidden!important}',
  });
}

export interface Shot {
  png: PNG;
  /** Top/bottom of the uncompared credit row, in CSS px relative to the shot's top (widget build only). */
  credit?: { top: number; bottom: number };
  scale: number;
}

/** Screenshot `target`; `credit` (widget build) gives the credit row's box relative to it. */
export async function shoot(page: Page, target: Locator, credit?: Locator): Promise<Shot> {
  await page.evaluate(() => document.fonts.ready);
  const box = await target.boundingBox();
  if (!box) throw new Error('shoot: target has no box');
  const buf = await target.screenshot({ animations: 'disabled', caret: 'hide' });
  const png = PNG.sync.read(buf);
  const scale = png.width / box.width;
  let c: Shot['credit'];
  if (credit) {
    const cb = await credit.boundingBox();
    if (!cb) throw new Error('shoot: credit has no box');
    c = { top: cb.y - box.y, bottom: cb.y + cb.height - box.y };
  }
  return { png, credit: c, scale };
}

function diffRows(a: PNG, ay: number, b: PNG, by: number, h: number, w: number): { diff: number; area: number; img: PNG } {
  const img = new PNG({ width: w, height: Math.max(h, 1) });
  if (h <= 0) return { diff: 0, area: 0, img };
  const crop = (p: PNG, y: number) => {
    const out = Buffer.alloc(w * h * 4);
    for (let r = 0; r < h; r++) p.data.copy(out, r * w * 4, ((y + r) * p.width) * 4, ((y + r) * p.width + w) * 4);
    return out;
  };
  const diff = pixelmatch(crop(a, ay), crop(b, by), img.data, w, h, { threshold: 0.1 });
  return { diff, area: w * h, img };
}

export interface Parity {
  ratio: number;
  diff: number;
  area: number;
  regions: string;
  diffImage: Buffer;
}

/**
 * AC-L1-06..09 A/B rule. Region A = from the top to the credit's top edge, compared at equal offsets; region B = from the credit's
 * bottom edge (widget) to the bottom, compared bottom-aligned with the native shot (so content displaced by the credit, such as the
 * land acknowledgement, is still compared). Only the credit row itself is uncompared. Without a credit (native vs native) the whole
 * shot is compared top-aligned.
 */
export function parity(native: Shot, widget: Shot): Parity {
  const n = native.png;
  const w = widget.png;
  expect(w.width, 'shot widths differ').toBe(n.width);
  const width = n.width;
  const s = widget.scale;
  let a: ReturnType<typeof diffRows>;
  let b: ReturnType<typeof diffRows>;
  if (!widget.credit) {
    a = diffRows(n, 0, w, 0, Math.min(n.height, w.height), width);
    b = diffRows(n, 0, w, 0, 0, width);
  } else {
    const ct = Math.max(0, Math.round(widget.credit.top * s));
    const cb = Math.min(w.height, Math.round(widget.credit.bottom * s));
    const hA = Math.min(ct, n.height);
    a = diffRows(n, 0, w, 0, hA, width);
    const hB = Math.min(w.height - cb, n.height - hA);
    b = diffRows(n, n.height - hB, w, w.height - hB, hB, width);
  }
  const diff = a.diff + b.diff;
  const area = a.area + b.area;
  const out = new PNG({ width, height: a.img.height + b.img.height });
  a.img.data.copy(out.data, 0);
  b.img.data.copy(out.data, a.img.data.length);
  return {
    ratio: area === 0 ? 1 : diff / area,
    diff,
    area,
    regions: `A=${a.area / width}px B=${b.area / width}px native=${n.height} widget=${w.height} (device px)`,
    diffImage: PNG.sync.write(out),
  };
}

export const MAX_DIFF = 0.005;

/** Records [role=dialog] counts after every mutation batch and animation frame, through every shadow root (AC-L1-17b/c). */
export const DIALOG_PROBE = () => {
  const w = window as unknown as {
    __tvDialogs: { max: number; log: string[]; onNativeRemoved?: () => void };
  };
  w.__tvDialogs = { max: 0, log: [] };
  const roots = new Set<Document | ShadowRoot>([document]);
  const count = () => {
    let n = 0;
    roots.forEach((r) => (n += r.querySelectorAll('[role=dialog]').length));
    w.__tvDialogs.max = Math.max(w.__tvDialogs.max, n);
    return n;
  };
  const watch = (root: Document | ShadowRoot) => {
    roots.add(root);
    new MutationObserver((recs) => {
      for (const r of recs) {
        r.removedNodes.forEach((n) => {
          if (n instanceof Element && n.matches('aside[role=dialog]') && root === document) {
            w.__tvDialogs.log.push('remove-native');
            w.__tvDialogs.onNativeRemoved?.();
          }
        });
        r.addedNodes.forEach((n) => {
          if (n instanceof Element && n.matches('aside[role=dialog]')) w.__tvDialogs.log.push(root === document ? 'add-native' : 'add-widget');
        });
      }
      count();
    }).observe(root, { childList: true, subtree: true });
  };
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const sr = attach.call(this, init);
    watch(sr);
    return sr;
  };
  const frame = () => {
    count();
    requestAnimationFrame(frame);
  };
  document.addEventListener('DOMContentLoaded', () => frame());
  watch(document);
};

export const dialogLog = (page: Page) => page.evaluate(() => (window as unknown as { __tvDialogs: { max: number; log: string[] } }).__tvDialogs);
