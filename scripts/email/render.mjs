// Renders scripts/email/wordmark.html to public/email/{halloween,christmas}-{band,badge}.png with headless Chrome
// (CDP): the digest email's only images, served from SITE_URL (supabase/functions/_shared/digestEmail.ts).
// band: 1200x300 (shown 600x150, season openers); badge: 440x104 (shown 150x35, every other digest).
// Manual design tool, not part of the build: `CHROME=/path/to/chrome node scripts/email/render.mjs`.
// Needs network once for Google Fonts (Creepster, Fraunces).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', '..', 'public', 'email');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9342;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'email-'));
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
  await send('Page.navigate', { url: pathToFileURL(path.join(here, 'wordmark.html')).href });
  await sleep(4000);
  const res = await send('Runtime.evaluate', { expression: 'window.renderWordmarks()', awaitPromise: true, returnByValue: true });
  const imgs = res?.result?.value;
  if (!imgs || typeof imgs !== 'object') throw new Error('render failed');
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, url] of Object.entries(imgs)) {
    const out = path.join(outDir, `${name}.png`);
    fs.writeFileSync(out, Buffer.from(String(url).replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('wrote', out);
  }
  ws.close();
} finally {
  proc.kill();
  await sleep(500); // let Chrome release the profile before removing it
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
