import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['out/**', '.next/**', 'supabase/**', 'next-env.d.ts', 'out-lights/**', 'out-vibes/**', 'e2e/.cache/**', 'e2e-artifacts/**']),
]);
