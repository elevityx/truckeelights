// Obtains the pinned TruckeeVibes widget file for the route mocks: VIBES_WIDGET_FILE (a local path, e.g. a TruckeeVibes checkout)
// or a download of VIBES_WIDGET.src. Fails unless its sha384 equals VIBES_WIDGET.integrity (the same SRI the browser enforces).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export function pinnedWidget() {
  const ts = readFileSync('src/components/events/vibes.ts', 'utf8');
  const src = /src:\s*'([^']+)'/.exec(ts)?.[1];
  const integrity = /integrity:\s*'([^']+)'/.exec(ts)?.[1];
  if (!src || !integrity) throw new Error('global-setup: VIBES_WIDGET not found in src/components/events/vibes.ts');
  return { src, integrity };
}

export const sri = (buf) => `sha384-${createHash('sha384').update(buf).digest('base64')}`;

export default async function globalSetup() {
  for (const d of ['out-lights', 'out-vibes']) {
    if (!existsSync(`${d}/index.html`)) throw new Error(`global-setup: ${d}/ is missing; run node e2e/build-variants.mjs first`);
  }
  const { src, integrity } = pinnedWidget();
  let buf;
  if (process.env.VIBES_WIDGET_FILE) {
    buf = readFileSync(process.env.VIBES_WIDGET_FILE);
  } else {
    const res = await fetch(src, { redirect: 'error' });
    if (!res.ok) throw new Error(`global-setup: GET ${src} -> ${res.status} (set VIBES_WIDGET_FILE to a local copy)`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const got = sri(buf);
  if (got !== integrity) throw new Error(`global-setup: widget integrity ${got} != pinned ${integrity}`);
  mkdirSync('e2e/.cache', { recursive: true });
  writeFileSync('e2e/.cache/widget.js', buf);
  console.log(`global-setup: widget ${src} ok (${buf.length} bytes, ${integrity})`);
}
