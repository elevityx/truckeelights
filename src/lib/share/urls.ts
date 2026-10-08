import type { Season } from '@/lib/data/types';

/** The canonical public site. The flyer QR always points here, even on preview builds. */
export const SITE_URL = 'https://truckeelights.com';

/** Normalize a site base to an origin plus path with no trailing slash. Falls back to SITE_URL on junk. */
export function siteBase(base: string | undefined): string {
  const raw = (base ?? '').trim();
  if (!raw) return SITE_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return SITE_URL;
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return SITE_URL;
  }
}

/** Link to the map itself. Trailing slash matches the static export (`trailingSlash: true`). */
export function mapShareUrl(base?: string): string {
  return `${siteBase(base)}/`;
}

/** Link that opens one house's sheet on the map (`/?house=<id>`). */
export function houseShareUrl(base: string | undefined, houseId: string): string {
  const u = new URL(mapShareUrl(base));
  u.searchParams.set('house', houseId);
  return u.toString();
}

/** Display form of a URL for print: no scheme, no trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

export function mapShareData(season: Season, base?: string): ShareData {
  return season === 'halloween'
    ? { title: 'Truckee Frights', text: 'The spooky house map of Truckee. Add yours!', url: mapShareUrl(base) }
    : { title: 'Truckee Lights', text: 'The holiday lights map of Truckee. Add yours!', url: mapShareUrl(base) };
}

export function houseShareData(season: Season, base: string | undefined, houseId: string, street: string): ShareData {
  return {
    title: season === 'halloween' ? 'Truckee Frights' : 'Truckee Lights',
    text: season === 'halloween' ? `A spooky house to visit: ${street}` : `A lit-up house to visit: ${street}`,
    url: houseShareUrl(base, houseId),
  };
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/** The bits of `navigator` we use, so tests can pass a fake. */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

/** Web Share API when there is one, else copy the link. A user cancel (AbortError) is not a failure. */
export async function shareOrCopy(data: ShareData, nav: ShareNavigator): Promise<ShareResult> {
  if (typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      // Some browsers expose share() but refuse it (NotAllowedError); fall through to copy.
    }
  }
  try {
    if (!nav.clipboard) return 'failed';
    await nav.clipboard.writeText(data.url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function shareToast(result: ShareResult): string | null {
  if (result === 'copied') return 'Link copied';
  if (result === 'failed') return "Couldn't share. Copy the link from the address bar.";
  return null;
}
