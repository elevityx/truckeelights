import { beforeEach, describe, expect, it, vi } from 'vitest';

type Res = { data: unknown; error: unknown };
const state: { selects: string[]; houses: (cols: string) => Res; counts: () => Res } = {
  selects: [],
  houses: () => ({ data: [], error: null }),
  counts: () => ({ data: [], error: null }),
};

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    from: () => ({
      select: (cols: string) => {
        state.selects.push(cols);
        const chain = { eq: () => chain, limit: async () => state.houses(cols) };
        return chain;
      },
    }),
    rpc: async () => state.counts(),
  }),
}));

const { listMapHouses, subscribeCapability } = await import('./public');

const H = { id: 'h1', address: '1 A St, Truckee', lat: 39.3, lng: -120.2 };

beforeEach(() => {
  state.selects = [];
  state.counts = () => ({ data: [], error: null });
});

describe('listMapHouses (AC22)', () => {
  it('reads votes from the totals embed and maps a null embed to 0', async () => {
    state.houses = () => ({
      data: [
        { ...H, house_vote_totals: { votes: 52 } },
        { ...H, id: 'h2', house_vote_totals: null },
      ],
      error: null,
    });
    const pins = await listMapHouses('r1');
    expect(state.selects).toEqual(['id,address,lat,lng,house_vote_totals(votes)']);
    expect(pins.map((p) => p.votes)).toEqual([52, 0]);
  });

  it('falls back to a select without the embed on PGRST200', async () => {
    state.houses = (cols) =>
      cols.includes('house_vote_totals')
        ? { data: null, error: { code: 'PGRST200', message: 'Could not find a relationship' } }
        : { data: [H], error: null };
    const pins = await listMapHouses('r1');
    expect(state.selects).toEqual(['id,address,lat,lng,house_vote_totals(votes)', 'id,address,lat,lng']);
    expect(pins).toEqual([{ ...H, photoCount: 0, votes: 0, badges: [] }]);
  });

  it('fills photoCount from get_house_photo_counts, and 0 (capped) when that RPC fails', async () => {
    state.houses = () => ({ data: [{ ...H, house_vote_totals: { votes: 3 } }, { ...H, id: 'h2' }], error: null });
    state.counts = () => ({ data: [{ house_id: 'h1', approved: 2 }], error: null });
    expect((await listMapHouses('r1')).map((p) => p.photoCount)).toEqual([2, 0]);
    state.counts = () => ({ data: null, error: { message: 'boom' } });
    expect((await listMapHouses('r1')).map((p) => p.photoCount)).toEqual([0, 0]);
  });

  it('still throws other errors', async () => {
    state.houses = () => ({ data: null, error: { message: 'forbidden' } });
    await expect(listMapHouses('r1')).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('subscribeCapability', () => {
  it('is undefined when the key is missing (DB without subscriptions) and strict about open', () => {
    expect(subscribeCapability(undefined)).toBeUndefined();
    expect(subscribeCapability(null)).toBeUndefined();
    expect(subscribeCapability([])).toBeUndefined();
    expect(subscribeCapability({})).toEqual({ open: false });
    expect(subscribeCapability({ open: 'true' })).toEqual({ open: false });
    expect(subscribeCapability({ open: 'yes' })).toEqual({ open: false });
    expect(subscribeCapability({ open: true })).toEqual({ open: true });
  });
});
