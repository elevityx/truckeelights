import { describe, expect, it, vi } from 'vitest';
import {
  SITE_URL,
  displayUrl,
  houseShareData,
  houseShareUrl,
  mapShareData,
  mapShareUrl,
  shareOrCopy,
  shareToast,
  siteBase,
} from './urls';

describe('siteBase', () => {
  it('falls back to the public site for empty or bad input', () => {
    expect(siteBase(undefined)).toBe(SITE_URL);
    expect(siteBase('')).toBe(SITE_URL);
    expect(siteBase('not a url')).toBe(SITE_URL);
    expect(siteBase('javascript:alert(1)')).toBe(SITE_URL);
  });
  it('strips trailing slashes and keeps a path prefix', () => {
    expect(siteBase('https://truckeelights.com/')).toBe('https://truckeelights.com');
    expect(siteBase('http://localhost:3000')).toBe('http://localhost:3000');
    expect(siteBase('https://x.pages.dev/sub//')).toBe('https://x.pages.dev/sub');
  });
  it('drops query and hash', () => {
    expect(siteBase('https://truckeelights.com/?a=1#b')).toBe('https://truckeelights.com');
  });
});

describe('mapShareUrl', () => {
  it('ends in a slash for the static export', () => {
    expect(mapShareUrl()).toBe('https://truckeelights.com/');
    expect(mapShareUrl('http://localhost:3000/')).toBe('http://localhost:3000/');
  });
});

describe('houseShareUrl', () => {
  it('adds ?house=<id>', () => {
    expect(houseShareUrl(undefined, 'abc-123')).toBe('https://truckeelights.com/?house=abc-123');
    expect(houseShareUrl('https://truckeelights.com/', 'abc')).toBe('https://truckeelights.com/?house=abc');
  });
  it('encodes odd ids', () => {
    expect(houseShareUrl(undefined, 'a b&c=d')).toBe('https://truckeelights.com/?house=a+b%26c%3Dd');
  });
});

describe('displayUrl', () => {
  it('drops the scheme and trailing slash', () => {
    expect(displayUrl('https://truckeelights.com/')).toBe('truckeelights.com');
  });
});

describe('share data', () => {
  it('is seasonal', () => {
    expect(mapShareData('halloween').title).toBe('Truckee Frights');
    expect(mapShareData('christmas').title).toBe('Truckee Lights');
    const h = houseShareData('halloween', undefined, 'id1', '10 Elm St');
    expect(h.url).toBe('https://truckeelights.com/?house=id1');
    expect(h.text).toContain('10 Elm St');
  });
});

describe('shareOrCopy', () => {
  const data = mapShareData('halloween');
  it('uses the Web Share API when present', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share, clipboard: { writeText } })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(writeText).not.toHaveBeenCalled();
  });
  it('treats a user cancel as cancelled, not copied', async () => {
    const err = Object.assign(new Error('cancel'), { name: 'AbortError' });
    const writeText = vi.fn();
    expect(await shareOrCopy(data, { share: vi.fn().mockRejectedValue(err), clipboard: { writeText } })).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('falls back to copy when share is refused or missing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const refused = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    expect(await shareOrCopy(data, { share: vi.fn().mockRejectedValue(refused), clipboard: { writeText } })).toBe('copied');
    expect(await shareOrCopy(data, { clipboard: { writeText } })).toBe('copied');
    expect(await shareOrCopy(data, { share: vi.fn(), canShare: () => false, clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(data.url);
  });
  it('reports failure when nothing works', async () => {
    expect(await shareOrCopy(data, {})).toBe('failed');
    expect(await shareOrCopy(data, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('x')) } })).toBe('failed');
  });
  it('maps results to toasts', () => {
    expect(shareToast('copied')).toBe('Link copied');
    expect(shareToast('shared')).toBeNull();
    expect(shareToast('cancelled')).toBeNull();
    expect(shareToast('failed')).toMatch(/Couldn't share/);
  });
});
