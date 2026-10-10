// The calls the Subscribe + Account UI makes. Production always uses the real data layer.
// `next dev` with NEXT_PUBLIC_SUBSCRIBE_MOCK=1 swaps in subscribeDevMock.ts (an in-memory fake, for screenshots
// before the database and email exist). The NODE_ENV check is inlined at build, so the mock is dead code in
// `next build` and never ships.
import {
  beginHouseLink,
  completeHouseLink,
  getMyAccount,
  requestHouseClaim,
  requestHouseRemoval,
  setHouseVisibility,
  setSubscription,
  stopSubscription,
  withdrawHouseClaim,
} from '@/lib/data/account';
import {
  deleteMyAccount,
  sendEmailCode,
  sessionEmail,
  sessionKind,
  signOutLocal,
  verifyEmailCode,
  verifyLinkToken,
  type LinkOtpType,
  type SessionKind,
} from '@/lib/data/auth';
import { readLinkPrefs, savePrefsByLink, stopByLink, type LinkPrefs } from '@/lib/data/emailLinks';
import { getRegionContext, listMapHouses } from '@/lib/data/public';
import type { MyAccount, PinView, RegionContext, Subscription, SubscriptionPrefs } from '@/lib/data/types';
import type { FlowApi, SheetState } from './flow';

export interface SubscribeApi extends FlowApi {
  /** True only in the dev mock: the UI shows a stand-in for Turnstile. */
  mock: boolean;
  sessionKind(): Promise<SessionKind>;
  sessionEmail(): Promise<string | null>;
  verifyEmailCode(email: string, code: string): Promise<void>;
  verifyLinkToken(tokenHash: string, type: LinkOtpType): Promise<void>;
  setSubscription(regionSlug: string, prefs: SubscriptionPrefs): Promise<Subscription>;
  stopSubscription(): Promise<void>;
  getMyAccount(): Promise<MyAccount>;
  setHouseVisibility(houseId: string, visible: boolean): Promise<void>;
  requestHouseRemoval(houseId: string, note: string | null): Promise<string>;
  requestHouseClaim(houseId: string, note: string | null): Promise<string>;
  withdrawHouseClaim(claimId: string): Promise<void>;
  deleteMyAccount(): Promise<'ok' | 'reauth'>;
  regionContext(): Promise<RegionContext>;
  /** This season's houses, for "Is another house yours?". */
  listHouses(regionId: string): Promise<PinView[]>;
  readLinkPrefs(t: string): Promise<LinkPrefs>;
  stopByLink(t: string): Promise<void>;
  savePrefsByLink(t: string, prefs: SubscriptionPrefs): Promise<LinkPrefs>;
}

const real: SubscribeApi = {
  mock: false,
  sessionKind,
  sessionEmail,
  beginHouseLink,
  sendEmailCode,
  verifyEmailCode,
  verifyLinkToken,
  setSubscription,
  stopSubscription,
  completeHouseLink,
  signOutLocal,
  getMyAccount,
  setHouseVisibility,
  requestHouseRemoval,
  requestHouseClaim,
  withdrawHouseClaim,
  deleteMyAccount,
  regionContext: () => getRegionContext(),
  listHouses: listMapHouses,
  readLinkPrefs,
  stopByLink,
  savePrefsByLink,
};

const mocked = () => process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SUBSCRIBE_MOCK === '1';

export async function subscribeApi(): Promise<SubscribeApi> {
  if (mocked()) return (await import('./subscribeDevMock')).devSubscribeApi();
  return real;
}

/** Dev only: forces `subscribe: { open: true }` (or a closed/missing key with ?subMock=closed|nodb) and may open a sheet. */
export async function devSubscribeOverlay(ctx: RegionContext): Promise<{ ctx: RegionContext; open?: 'subscribe' | 'nudge' } | null> {
  if (mocked()) return (await import('./subscribeDevMock')).overlay(ctx);
  return null;
}

/** Dev only: start the Subscribe sheet at a later step (?subMock=code|done). */
export async function devSheetPreset(): Promise<Partial<SheetState> | null> {
  if (mocked()) return (await import('./subscribeDevMock')).sheetPreset();
  return null;
}

/** Dev only: a region context and houses when no other mock supplies them. */
export async function devSubscribeFixture(): Promise<{ ctx: RegionContext; pins: PinView[] } | null> {
  if (mocked()) return (await import('./subscribeDevMock')).fixture();
  return null;
}
