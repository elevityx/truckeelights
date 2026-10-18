// Static server for a Next static export with trailingSlash semantics: /x/ -> x/index.html, /x -> 308 /x/ when x/ is a folder.
// Usage: node e2e/serve.mjs <dir> <port>. Binds 127.0.0.1 only.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

export function createStaticServer(dir) {
  const root = resolve(dir);
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel;
    try {
      rel = normalize(decodeURIComponent(url.pathname));
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = join(root, rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(308, { location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      file = join(file, 'index.html');
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      const nf = join(root, '404.html');
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      if (existsSync(nf)) createReadStream(nf).pipe(res);
      else res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [dir, port] = process.argv.slice(2);
  if (!dir || !port) {
    console.error('usage: node e2e/serve.mjs <dir> <port>');
    process.exit(2);
  }
  createStaticServer(dir).listen(Number(port), '127.0.0.1', () => console.log(`serve: ${dir} on http://127.0.0.1:${port}`));
}
