// C1 live check (not run in CI): loads a deployed origin in real Chromium with no route mocks and checks the provider wiring.
// Usage: node e2e/live-check.mjs <origin> --expect shadow|vibes|lights
// Prints: live-check: provider=<p> script=<ok|missing> integrity=<ok|bad> api=<status> rows=<n> credit=<ok|missing> shadow=<dataset>
import { chromium } from '@playwright/test';
import { pinnedWidget } from './global-setup.mjs';

const [origin, flag, expectArg] = process.argv.slice(2);
if (!origin || flag !== '--expect' || !['shadow', 'vibes', 'lights'].includes(expectArg)) {
  console.error('usage: node e2e/live-check.mjs <origin> --expect shadow|vibes|lights');
  process.exit(2);
}
const { src, integrity } = pinnedWidget();
const browser = await chromium.launch();
let failed = false;
try {
  const page = await browser.newPage();
  let apiStatus = 'none';
  let scriptStatus = 0;
  page.on('response', (r) => {
    if (r.url().startsWith('https://truckeevibes.com/api/v1/events')) apiStatus = String(r.status());
    if (r.url() === src) scriptStatus = r.status();
  });
  await page.goto(new URL('/?layer=events&view=list', origin).toString(), { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  const s = await page.evaluate((want) => {
    const el = document.querySelector(`script[src="${want}"]`);
    const list = document.querySelector('[data-tv-list]');
    return {
      script: el ? 'ok' : 'missing',
      integrity: el?.getAttribute('integrity') ?? null,
      crossorigin: el?.getAttribute('crossorigin') ?? null,
      version: (window).TruckeeVibes?.version ?? null,
      rows: list?.shadowRoot?.querySelectorAll('.erow').length ?? 0,
      credit: list?.shadowRoot?.querySelector('.tv-credit a[href="https://truckeevibes.com/"]') ? 'ok' : 'missing',
      shadow: document.documentElement.dataset.tvShadow ?? '',
    };
  }, src);
  const integrityOk = s.integrity === integrity && s.crossorigin === 'anonymous';
  const provider = s.script === 'missing' ? 'lights' : s.rows > 0 || s.credit === 'ok' ? 'vibes' : 'shadow';
  console.log(
    `live-check: provider=${provider} script=${s.script} integrity=${s.script === 'missing' ? '-' : integrityOk ? 'ok' : 'bad'} api=${apiStatus} rows=${s.rows} credit=${s.credit} shadow=${s.shadow || '-'}`,
  );
  if (provider !== expectArg) failed = true;
  if (expectArg !== 'lights' && (!integrityOk || scriptStatus !== 200 || apiStatus !== '200')) failed = true;
  if (expectArg === 'vibes' && (s.rows === 0 || s.credit !== 'ok' || !String(s.version).startsWith('1.'))) failed = true;
  if (expectArg === 'shadow' && (!/^missing=\d+ extra=\d+ state=\w+$/.test(s.shadow) || s.credit === 'ok')) failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
