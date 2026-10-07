import type { SubmitInput, SubmitResult } from './types';

// Owner: WP-C
export async function hasSession(): Promise<boolean> {
  throw new Error('not implemented');
}
export async function ensureAnonymousSession(captchaToken: string): Promise<void> {
  void captchaToken;
  throw new Error('not implemented');
}
export async function submitHouse(i: SubmitInput): Promise<SubmitResult> {
  void i;
  throw new Error('not implemented');
}
