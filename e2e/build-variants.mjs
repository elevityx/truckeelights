// L1.4 (SD8): builds the two static exports the parity harness compares, against a fixture-only Supabase URL (every request is
// answered by Playwright route mocks in e2e/routes.ts) and no Maps key (keyless stub map). NEXT_PUBLIC_* is inlined at build, so
// .next is removed between builds. NEXT_PUBLIC_E2E=1 exposes the stub map's pin-tap hooks; production never sets it.
import { execSync } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';

const BASE = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54399',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'e2e-fixture-key',
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '',
  NEXT_PUBLIC_MAP_ID_HALLOWEEN: '',
  NEXT_PUBLIC_MAP_ID_CHRISTMAS: '',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  NEXT_PUBLIC_E2E: '1',
};
const VARIANTS = [
  { provider: 'lights', dir: 'out-lights' },
  { provider: 'vibes', dir: 'out-vibes' },
];

if (process.env.E2E_SKIP_BUILD === '1') {
  console.log('build-variants: E2E_SKIP_BUILD=1, reusing out-lights/ and out-vibes/');
  process.exit(0);
}
for (const v of VARIANTS) {
  rmSync('.next', { recursive: true, force: true });
  rmSync('out', { recursive: true, force: true });
  rmSync(v.dir, { recursive: true, force: true });
  execSync('npx next build', { stdio: 'inherit', env: { ...process.env, ...BASE, NEXT_PUBLIC_EVENTS_PROVIDER: v.provider } });
  renameSync('out', v.dir);
  console.log(`build-variants: ${v.dir} (NEXT_PUBLIC_EVENTS_PROVIDER=${v.provider})`);
}
rmSync('.next', { recursive: true, force: true });
