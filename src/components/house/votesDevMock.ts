// DEV ONLY. Loaded by votesApi.ts only under `next dev` with NEXT_PUBLIC_VOTES_MOCK=1; dead code in production builds.
// Query options: ?season=christmas (theme), ?votesMock=session|closed|daily|house|network|breaker|nophotos|left0|slow.
// Default: no session yet (the first vote shows the bot check), voting open, photo uploads open.
import { DataError, type PinView, type RegionContext } from '@/lib/data/types';
import type { VotesApi } from './votesApi';

const q = () => new URLSearchParams(window.location.search);
const has = (opt: string) => (q().get('votesMock') ?? '').split(',').includes(opt);
const wait = (ms = 450) => new Promise((r) => setTimeout(r, has('slow') ? 4000 : ms));

// Fake streets and fake counts in the spec's AC23 ladder (0/12/25/50/75/100/150) plus in-between values.
// Ids starting 00/04 get the alternate glyph (ghost / wreath).
const HOUSES: [id: string, address: string, lat: number, lng: number, votes: number, photos: number][] = [
  ['01a1', '412 Snowshed Ln, Truckee, CA 96161', 39.3312, -120.1905, 150, 3],
  ['00b2', '88 Lantern Ct, Truckee, CA 96161', 39.3338, -120.1802, 100, 0],
  ['05c3', '1730 Old Signal Rd, Truckee, CA 96161', 39.3268, -120.1738, 75, 1],
  ['02d4', '9 Hollow Pine Ct, Truckee, CA 96161', 39.3241, -120.1931, 50, 0],
  ['04e5', '2205 Ember Hill Dr, Truckee, CA 96161', 39.3289, -120.1840, 25, 2],
  ['03f6', '640 Pinecone Way, Truckee, CA 96161', 39.3209, -120.1858, 12, 0],
  ['06a7', '15 Ridge Lamp Rd, Truckee, CA 96161', 39.3222, -120.1765, 0, 0],
  ['07b8', '301 Snowshed Ln, Truckee, CA 96161', 39.3301, -120.1962, 33, 1],
  ['09c9', '77 Ridge Lamp Rd, Truckee, CA 96161', 39.3329, -120.1712, 3, 0],
  ['0ad0', '120 Frost Hollow Rd, Truckee, CA 96161', 39.3195, -120.1990, 120, 0],
  ['00e1', '5 Lantern Ct, Truckee, CA 96161', 39.3355, -120.1875, 0, 0],
];
const totals = new Map<string, number>();
const used = new Map<string, number>();
let session = false;

export function fixture(): { ctx: RegionContext; pins: PinView[] } {
  session = has('session') || has('left0');
  const season = q().get('season') === 'christmas' ? 'christmas' : 'halloween';
  const pins: PinView[] = HOUSES.map(([prefix, address, lat, lng, votes, photos]) => {
    const id = `${prefix}0000-0000-4000-8000-000000000000`;
    totals.set(id, votes);
    if (has('left0')) used.set(id, 5);
    return { id, address, lat, lng, votes, photoCount: has('nophotos') ? 0 : photos, badges: [] };
  });
  const ctx: RegionContext = {
    region: {
      id: 'dev-region',
      slug: 'truckee',
      name: 'Truckee',
      minLat: 39.28,
      maxLat: 39.37,
      minLng: -120.26,
      maxLng: -120.1,
      centerLat: 39.3275,
      centerLng: -120.185,
      defaultZoom: 15,
      timezone: 'America/Los_Angeles',
      countryCode: 'US',
    },
    season,
    year: 2026,
    submissionsOpen: true,
    wordmark: 'Truckee Lights',
    photosOpen: true,
    votesOpen: !has('closed'),
  };
  return { ctx, pins };
}

export function devVotesApi(): VotesApi {
  return {
    async hasSession() {
      return session;
    },
    async ensureAnonymousSession() {
      await wait(900);
      session = true;
    },
    async getMyVoteStatus(houseId) {
      await wait(200);
      if (!session) throw new DataError('not_signed_in');
      return { totalVotes: totals.get(houseId) ?? 0, leftToday: 5 - (used.get(houseId) ?? 0) };
    },
    async voteHouse(houseId) {
      await wait();
      if (!session) throw new DataError('not_signed_in');
      if (has('closed')) throw new DataError('votes_closed');
      if (has('daily')) throw new DataError('rate_limited', 'uid_daily');
      if (has('network')) throw new DataError('rate_limited', 'network_daily');
      if (has('breaker')) throw new DataError('rate_limited', 'house_breaker');
      const u = used.get(houseId) ?? 0;
      if (u >= 5 || (has('house') && u >= 1)) throw new DataError('rate_limited', 'house_daily');
      used.set(houseId, u + 1);
      const t = (totals.get(houseId) ?? 0) + 1;
      totals.set(houseId, t);
      return { totalVotes: t, leftToday: 4 - u };
    },
  };
}
