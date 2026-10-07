'use client';

import { Turnstile as TurnstileWidget } from '@marsidev/react-turnstile';
import { publicEnv } from '@/config/public-env';

// Cloudflare's documented always-pass TEST site key (not a secret). Used only when the env key is absent.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

interface Props {
  onToken(t: string): void;
  onExpire(): void;
  resetKey: number;
}

/** Lazy Turnstile for the add flow: mounted only on step 3, only when no session exists. */
export default function BotCheck({ onToken, onExpire, resetKey }: Props) {
  return (
    <TurnstileWidget
      key={resetKey}
      siteKey={publicEnv.turnstileSiteKey || TURNSTILE_TEST_SITE_KEY}
      options={{ theme: 'dark', size: 'flexible' }}
      onSuccess={onToken}
      onExpire={onExpire}
      onError={onExpire}
    />
  );
}
