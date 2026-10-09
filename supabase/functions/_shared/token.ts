// Link tokens (Amendment 1, B8): `public_id.version.purpose.exp.HMAC(secret)`. The token never contains the uid.
// `unsub` tokens carry exp = 0 (no expiry); they die when the subscription's token_version is bumped.
// `prefs` tokens expire after 30 days. The HMAC covers the first four parts. SHA-256, base64url.
import { UUID } from './http.ts';

export type Purpose = 'unsub' | 'prefs';
export const PREFS_TTL_SECONDS = 30 * 24 * 3600;

export interface TokenClaims { publicId: string; version: number; purpose: Purpose; exp: number }
export type VerifyResult =
  | ({ ok: true } & TokenClaims)
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

function key(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signToken(secret: string, c: TokenClaims): Promise<string> {
  const body = `${c.publicId}.${c.version}.${c.purpose}.${c.exp}`;
  const sig = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), enc.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyToken(secret: string, token: string, nowSeconds: number): Promise<VerifyResult> {
  if (typeof token !== 'string' || token.length > 300) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'malformed' };
  const [publicId, versionS, purpose, expS, sigS] = parts;
  if (!UUID.test(publicId)) return { ok: false, reason: 'malformed' };
  if (!/^[1-9]\d{0,8}$/.test(versionS)) return { ok: false, reason: 'malformed' };
  if (purpose !== 'unsub' && purpose !== 'prefs') return { ok: false, reason: 'malformed' };
  if (!/^(0|[1-9]\d{0,11})$/.test(expS)) return { ok: false, reason: 'malformed' };
  const sig = b64urlDecode(sigS);
  if (!sig) return { ok: false, reason: 'malformed' };
  const exp = Number(expS);
  // Shape rules first: unsub never expires, prefs always does.
  if ((purpose === 'unsub') !== (exp === 0)) return { ok: false, reason: 'malformed' };
  const body = `${publicId}.${versionS}.${purpose}.${expS}`;
  const good = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), sig, enc.encode(body));
  if (!good) return { ok: false, reason: 'bad_signature' };
  if (purpose === 'prefs' && exp <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, publicId, version: Number(versionS), purpose, exp };
}
