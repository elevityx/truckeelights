// Renders scripts/og/card.html to public/og/{halloween,christmas}.png at 1200x630 with headless Chrome (CDP).
// Manual design tool, not part of the build: `CHROME=/path/to/chrome node scripts/og/render.mjs`.
// Needs network once for Google Fonts (Creepster, Fraunces, Atkinson Hyperlegible Next).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9341;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let tabs;
  for (let tries = 0; !tabs; tries++) {
    await sleep(500);
    tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch((e) => { if (tries > 30) throw e; });
  }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) pending[m.id](m.result);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  for (const season of ['halloween', 'christmas']) {
    const url = `${pathToFileURL(path.join(here, 'card.html')).href}?season=${season}`;
    await send('Page.navigate', { url });
    await sleep(4000);
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
    const out = path.join(here, '..', '..', 'public', 'og', `${season}.png`);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('wrote', out);
  }
  ws.close();
} finally {
  proc.kill();
  await sleep(500); // let Chrome release the profile before removing it
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
