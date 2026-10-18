import { defineConfig } from '@playwright/test';

// L1.4 parity harness (SD8): native (out-lights, :4181) vs widget (out-vibes, :4182) on synthetic fixtures; every API is route-mocked.
// phone = 390x844 via CDP Emulation.setDeviceMetricsOverride (mobile: true), applied in the e2e/harness.ts fixture; desktop = 1440x900.
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './e2e/global-setup.mjs',
  outputDir: 'e2e-artifacts',
  reporter: [['list']],
  workers: process.env.CI ? 2 : 4,
  use: { trace: 'retain-on-failure', permissions: ['clipboard-read', 'clipboard-write'] },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: 'node e2e/serve.mjs out-lights 4181', url: 'http://127.0.0.1:4181/', reuseExistingServer: !process.env.CI },
    { command: 'node e2e/serve.mjs out-vibes 4182', url: 'http://127.0.0.1:4182/', reuseExistingServer: !process.env.CI },
  ],
});
