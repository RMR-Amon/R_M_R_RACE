import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/** serves the production build (dist/) so phones and other PCs can open the game from the host */
export function serveStatic(root: string, req: IncomingMessage, res: ServerResponse) {
  const index = path.join(root, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('RMR_race LAN host is running, but the game is not built yet.\nRun "npm run build" (or "npm start") on the host computer.');
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = path.normalize(path.join(root, rel));
  // never leave the build folder (path traversal)
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  let target = file;
  try {
    if (!fs.statSync(target).isFile()) target = index;
  } catch {
    target = index; // single-page app
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // hashed bundles can be cached forever, the page itself never
    'cache-control': target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(target).pipe(res);
}
