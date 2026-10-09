// DEV ONLY. Loaded by api.ts only under `next dev` with NEXT_PUBLIC_SUBSCRIBE_MOCK=1; dead code in production builds.
// Every name, address, email and count is sample data. Query options: ?subMock= a comma list of
//   session:  anon (this device has an anonymous session) · user (signed in) · out (signed out; default: none)
//   home:     added (this device added a house) · sheet (open Subscribe) · nudge (the post-add nudge)
//             code | done (open Subscribe at that step) · closed (subscribe_open=false) · nodb (no subscribe key)
//   sign-in:  badcode (every code fails) · expired (links/codes expired) · slowsend · nochoices (link opened in another browser)
//   account:  nohouse · hidden (owner-hidden) · adminhidden · removal (removal pending) · claim (claim pending)
//             nosub · stopped · reauth (delete asks for a fresh code)
//   unsub:    stopped · badlink
// The mock session lives in sessionStorage, so a flow can be clicked through across pages.
import { DataError, type MyAccount, type PinView, type RegionContext, type Subscription, type SubscriptionPrefs } from '@/lib/data/types';
import type { SessionKind } from '@/lib/data/auth';
import type { LinkPrefs } from '@/lib/data/emailLinks';
import type { SubscribeApi } from './api';
import type { SheetState } from './flow';

const SAMPLE_EMAIL = 'sam.rivera@example.com';
const KEY = 'tl:mock-sub';
const q = () => new URLSearchParams(window.location.search);
const has = (opt: string) => (q().get('subMock') ?? '').split(',').includes(opt);
const wait = (ms = 600) => new Promise((r) => setTimeout(r, ms));

interface MockState {
  session: SessionKind;
  email: string | null;
  sub: Subscription | null;
  hidden: boolean;
  removal: boolean;
  claim: { id: string; houseId: string; address: string } | null;
  deleted: boolean;
  fresh: boolean;
}

function initial(): MockState {
  const session: SessionKind = has('user') ? 'user' : has('anon') ? 'anonymous' : 'none';
  return {
    session,
    email: has('user') ? SAMPLE_EMAIL : null,
    sub: has('nosub')
      ? null
      : { regionSlug: 'truckee', houses: true, events: true, cadence: 'daily', status: has('stopped') ? 'stopped' : 'active', confirmedAt: '2026-10-09T01:07:00Z' },
    hidden: has('hidden') || has('adminhidden'),
    removal: has('removal'),
    claim: has('claim') ? { id: 'c-1', houseId: '05c30000-0000-4000-8000-000000000000', address: '1730 Old Signal Rd, Truckee, CA 96161' } : null,
    deleted: false,
    fresh: !has('reauth'),
  };
}

function load(): MockState {
  // Any ?subMock= option resets the mock, so screenshots are deterministic.
  if (q().get('subMock') !== null) return save(initial());
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* ignore */
  }
  return save(initial());
}
function save(s: MockState): MockState {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  return s;
}
let S: MockState | null = null;
const st = () => (S ??= load());
const set = (p: Partial<MockState>) => {
  S = save({ ...st(), ...p });
};

const HOUSES: [id: string, address: string, lat: number, lng: number, votes: number][] = [
  ['01a1', '412 Snowshed Ln, Truckee, CA 96161', 39.3312, -120.1905, 150],
  ['00b2', '88 Lantern Ct, Truckee, CA 96161', 39.3338, -120.1802, 100],
  ['05c3', '1730 Old Signal Rd, Truckee, CA 96161', 39.3268, -120.1738, 75],
  ['02d4', '9 Hollow Pine Ct, Truckee, CA 96161', 39.3241, -120.1931, 50],
  ['04e5', '2205 Ember Hill Dr, Truckee, CA 96161', 39.3289, -120.184, 25],
  ['03f6', '640 Pinecone Way, Truckee, CA 96161', 39.3209, -120.1858, 12],
  ['06a7', '15 Ridge Lamp Rd, Truckee, CA 96161', 39.3222, -120.1765, 0],
  ['07b8', '301 Snowshed Ln, Truckee, CA 96161', 39.3301, -120.1962, 33],
];
const pins = (): PinView[] =>
  HOUSES.map(([prefix, address, lat, lng, votes]) => ({ id: `${prefix}0000-0000-4000-8000-000000000000`, address, lat, lng, photoCount: 0, votes, badges: [] }));

function ctxFor(season: 'halloween' | 'christmas'): RegionContext {
  return {
    region: {
      id: 'dev-region',
      slug: 'truckee',
      name: 'Truckee',
      minLat: 39.15,
      maxLat: 39.45,
      minLng: -120.42,
      maxLng: -119.98,
      centerLat: 39.29,
      centerLng: -120.1,
      defaultZoom: 11,
      timezone: 'America/Los_Angeles',
      countryCode: 'US',
    },
    season,
    year: 2026,
    submissionsOpen: true,
    wordmark: season === 'halloween' ? 'Truckee Frights' : 'Truckee Lights',
    photosOpen: false,
    votesOpen: true,
    subscribe: { open: true },
  };
}

export function fixture(): { ctx: RegionContext; pins: PinView[] } {
  return { ctx: ctxFor(q().get('season') === 'christmas' ? 'christmas' : 'halloween'), pins: pins() };
}

export function overlay(ctx: RegionContext): { ctx: RegionContext; open?: 'subscribe' | 'nudge' } {
  st();
  if (has('added')) window.localStorage.setItem('tl:added-house', '1');
  const subscribe = has('nodb') ? undefined : { open: !has('closed') };
  const open = has('nudge') ? 'nudge' : has('sheet') || has('code') || has('done') ? 'subscribe' : undefined;
  return { ctx: { ...ctx, subscribe }, open };
}

/** Dev only: start the Subscribe sheet at a later step, for screenshots. */
export function sheetPreset(): Partial<SheetState> | null {
  if (has('code')) return { step: 'code', email: SAMPLE_EMAIL, sentAt: Date.now() - 20_000 };
  if (has('done')) return { step: 'done', email: SAMPLE_EMAIL, linked: has('added') ? 1 : 0 };
  return null;
}

function account(): MyAccount {
  const s = st();
  const own = !has('nohouse');
  return {
    email: s.email ?? SAMPLE_EMAIL,
    subscription: s.sub,
    houses: own
      ? [
          {
            id: '00b20000-0000-4000-8000-000000000000',
            address: '88 Lantern Ct, Truckee, CA 96161',
            status: s.hidden ? 'hidden' : 'visible',
            hiddenByOwner: s.hidden && !has('adminhidden'),
            votes: 100,
            approvedPhotos: 4,
            removalPending: s.removal,
          },
        ]
      : [],
    claims: [
      ...(s.claim ? [{ id: s.claim.id, kind: 'claim' as const, houseId: s.claim.houseId, address: s.claim.address, status: 'pending' as const, createdAt: new Date().toISOString() }] : []),
      ...(s.removal && own
        ? [{ id: 'r-1', kind: 'removal' as const, houseId: '00b20000-0000-4000-8000-000000000000', address: '88 Lantern Ct, Truckee, CA 96161', status: 'pending' as const, createdAt: new Date().toISOString() }]
        : []),
    ],
  };
}

const needUser = () => {
  if (st().session !== 'user') throw new DataError('not_signed_in');
};

export function devSubscribeApi(): SubscribeApi {
  return {
    mock: true,
    async sessionKind() {
      return st().session;
    },
    async sessionEmail() {
      return st().session === 'user' ? st().email : null;
    },
    async beginHouseLink() {
      if (st().session !== 'anonymous') throw new DataError('forbidden');
      await wait(200);
    },
    async sendEmailCode(email: string) {
      await wait(has('slowsend') ? 3000 : 700);
      set({ email });
    },
    async verifyEmailCode(email: string, code: string) {
      await wait();
      if (has('expired')) throw new DataError('token_expired');
      if (has('badcode') || code === '000000') throw new DataError('token_invalid');
      set({ session: 'user', email, fresh: true });
    },
    async verifyLinkToken() {
      await wait(900);
      if (has('expired')) throw new DataError('token_expired');
      set({ session: 'user', email: st().email ?? SAMPLE_EMAIL, fresh: true });
    },
    async setSubscription(regionSlug: string, prefs: SubscriptionPrefs) {
      await wait(400);
      needUser();
      const sub: Subscription = { regionSlug, ...prefs, status: 'active', confirmedAt: new Date().toISOString() };
      set({ sub });
      return sub;
    },
    async stopSubscription() {
      await wait(400);
      needUser();
      const s = st().sub;
      if (s) set({ sub: { ...s, status: 'stopped' } });
    },
    async completeHouseLink() {
      await wait(200);
      return window.localStorage.getItem('tl:added-house') === '1' ? 1 : 0;
    },
    async signOutLocal() {
      await wait(150);
      set({ session: 'none' });
    },
    async getMyAccount() {
      await wait(400);
      needUser();
      return account();
    },
    async setHouseVisibility(_id: string, visible: boolean) {
      await wait(500);
      needUser();
      if (has('adminhidden')) throw new DataError('forbidden');
      set({ hidden: !visible });
    },
    async requestHouseRemoval() {
      await wait(500);
      needUser();
      set({ removal: true });
      return 'r-1';
    },
    async requestHouseClaim(houseId: string) {
      await wait(500);
      needUser();
      if (st().claim) throw new DataError('claim_pending');
      const p = pins().find((x) => x.id === houseId);
      set({ claim: { id: 'c-1', houseId, address: p?.address ?? '' } });
      return 'c-1';
    },
    async withdrawHouseClaim(id: string) {
      await wait(400);
      if (id === 'r-1') set({ removal: false });
      else set({ claim: null });
    },
    async deleteMyAccount() {
      await wait(700);
      needUser();
      if (!st().fresh) {
        set({ fresh: true }); // the next try, after a fresh code, goes through
        return 'reauth';
      }
      set({ session: 'none', sub: null, claim: null, removal: false, deleted: true });
      return 'ok';
    },
    async regionContext() {
      await wait(150);
      return fixture().ctx;
    },
    async listHouses() {
      await wait(250);
      return pins();
    },
    async readLinkPrefs(t: string): Promise<LinkPrefs> {
      await wait(400);
      if (has('badlink')) throw new DataError('token_invalid');
      if (t.split('.')[2] !== 'prefs') throw new DataError('forbidden');
      return { status: has('stopped') ? 'stopped' : 'active', houses: true, events: true, cadence: 'daily' };
    },
    async stopByLink() {
      await wait(600);
    },
    async savePrefsByLink(_t: string, prefs: SubscriptionPrefs): Promise<LinkPrefs> {
      await wait(500);
      return { status: 'active', ...prefs };
    },
  };
}
