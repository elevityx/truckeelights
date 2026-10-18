// Route mocks for the parity harness: the fixture Supabase (http://127.0.0.1:54399) and truckeevibes.com (widget file + events API).
// Nothing here reaches a live API. `routes.api` / `routes.widget` can be changed mid-test (the next request sees the new value).
import { readFileSync } from 'node:fs';
import type { Page, Request, Route } from '@playwright/test';

export type Season = 'halloween' | 'christmas';
export type Api = 'ok' | '503' | 'held' | 'stale' | 'old' | 'xss';
export type WidgetFile = 'ok' | 'abort' | 'tamper';

interface Fixture {
  now: string;
  ctx: Record<string, unknown> & { events?: { open: boolean } };
  houses: unknown[];
  lightsRows: { id: string }[];
  envelope: { events: Record<string, unknown>[] } & Record<string, unknown>;
}

const load = (f: string) => JSON.parse(readFileSync(`e2e/fixtures/${f}`, 'utf8'));
export const FIXTURES: Record<Season, Fixture> = { halloween: load('halloween.json'), christmas: load('christmas.json') };
const XSS: Record<string, unknown>[] = load('xss.json').events;

export const SUPABASE = 'http://127.0.0.1:54399';
export const LIGHTS = 'http://127.0.0.1:4181';
export const VIBES = 'http://127.0.0.1:4182';
export const NOW = (s: Season) => new Date(FIXTURES[s].now);

/** A Vibes-only event (not in the Lights REST rows): the handoff case where the open id has no native copy. */
export const VIBES_ONLY_ID = '00000000-0000-4000-8000-0f0000000001';

export interface RouteOptions {
  season: Season;
  /** The region context has no `events` key (a database without events). */
  noEvents?: boolean;
  /** 0 events in both the Lights rows and the envelope. */
  empty?: boolean;
  api?: Api;
  widget?: WidgetFile;
  /** Adds VIBES_ONLY_ID to the envelope only. */
  vibesOnly?: boolean;
}

export interface Routes {
  api: Api;
  widget: WidgetFile;
  /** Every request to truckeevibes.com, in order. */
  vibesRequests: string[];
  apiCalls: number;
}

const iso = (t: number) => new Date(t).toISOString();
/** The hostile rows are dated for the Halloween clock; Christmas moves them by the clock difference (Oct 15 -> Dec 10). */
const XSS_SHIFT_DAYS = 56;
function shiftDays(e: Record<string, unknown>, days: number): Record<string, unknown> {
  const mv = (v: unknown) => (typeof v === 'string' ? iso(Date.parse(v) + days * 86_400_000).replace('.000Z', 'Z') : v);
  return { ...e, startsAt: mv(e.startsAt), endsAt: mv(e.endsAt) };
}

function envelope(o: RouteOptions, api: Api): Record<string, unknown> {
  const fx = FIXTURES[o.season];
  const now = Date.parse(fx.now);
  const base = fx.envelope;
  let events = o.empty ? [] : base.events.slice();
  if (api === 'xss') events = o.season === 'halloween' ? XSS : XSS.map((e) => shiftDays(e, XSS_SHIFT_DAYS));
  if (o.vibesOnly && !o.empty) {
    const first = base.events[1];
    events = [...events, { ...first, id: VIBES_ONLY_ID, origin: 'vibes', title: 'Vibes Only Lantern Night' }];
  }
  const dataAt = api === 'old' ? now - 7 * 3600_000 : now - 10 * 60_000;
  const confirmedAt = api === 'old' ? now - 7 * 3600_000 : now - 12 * 60_000;
  return {
    ...base,
    dataAt: iso(dataAt),
    stale: api === 'stale',
    mirror:
      api === 'held'
        ? { state: 'held', confirmedAt: iso(confirmedAt), heldSince: iso(now - 20 * 60_000), heldCount: 1 }
        : { state: 'confirmed', confirmedAt: iso(confirmedAt), heldSince: null, heldCount: 0 },
    count: events.length,
    nextCursor: null,
    events,
  };
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers()['origin'];
  return {
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS, PATCH, DELETE',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? 'apikey, authorization, content-type, x-client-info, prefer',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

export async function installRoutes(page: Page, o: RouteOptions): Promise<Routes> {
  const fx = FIXTURES[o.season];
  const state: Routes = { api: o.api ?? 'ok', widget: o.widget ?? 'ok', vibesRequests: [], apiCalls: 0 };
  const widgetJs = readFileSync('e2e/.cache/widget.js');

  await page.route(`${SUPABASE}/**`, async (route: Route) => {
    const req = route.request();
    const h = cors(req);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    const path = new URL(req.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (path === '/rest/v1/rpc/get_region_context') {
      const ctx = { ...fx.ctx };
      if (o.noEvents) delete ctx.events;
      return json(ctx);
    }
    if (path === '/rest/v1/rpc/get_house_photo_counts') return json([]);
    if (path === '/rest/v1/houses') return json(fx.houses);
    if (path === '/rest/v1/events') return json(o.empty ? [] : fx.lightsRows);
    return json({ message: 'not mocked', path }, 404);
  });

  await page.route('https://truckeevibes.com/**', async (route: Route) => {
    const req = route.request();
    state.vibesRequests.push(req.url());
    const url = new URL(req.url());
    if (url.pathname.startsWith('/widget/v1/')) {
      if (state.widget === 'abort') return route.abort('failed');
      let body = widgetJs;
      if (state.widget === 'tamper') {
        body = Buffer.from(widgetJs);
        body[body.length - 2] = body[body.length - 2] === 0x20 ? 0x0a : 0x20; // one byte changed: the SRI check must fail
      }
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' },
        body,
      });
    }
    if (url.pathname === '/api/v1/events') {
      state.apiCalls++;
      const h = { ...cors(req), 'content-type': 'application/json; charset=utf-8' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
      if (state.api === '503') return route.fulfill({ status: 503, headers: { ...h, 'retry-after': '60', 'cache-control': 'no-store' }, body: '{"error":"unavailable"}' });
      return route.fulfill({ status: 200, headers: { ...h, 'cache-control': 'no-store' }, body: JSON.stringify(envelope(o, state.api)) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return state;
}
