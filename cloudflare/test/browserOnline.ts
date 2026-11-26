/**
 * Browser test of the online mode (npm run test:online:browser): the real site in Chrome / Edge against
 * the real Worker in the local workerd runtime. Three isolated browser profiles = three players.
 *
 * Between the browsers and the Worker sits a proxy that behaves like an internet connection (delay,
 * jitter, outages). Everything runs on one computer: this is not a test of a real deployment.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Page, errors, launchBrowser, outside, send, sleep, sockets } from '../../server/test/cdp';
import { startWorker, type LocalWorker } from './worker';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 5173;
const PROXY = 8818;
const WORKER = 8828;
/** one-way delay of the simulated internet connection */
const DELAY = 45;
const JITTER = 30;

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
};

/** delays every chunk (order is kept, like TCP); can be cut */
class Proxy {
  private conns = new Set<net.Socket>();
  down = false;
  server = net.createServer((a) => {
    if (this.down) {
      a.destroy();
      return;
    }
    const b = net.connect(WORKER, '127.0.0.1');
    this.conns.add(a);
    const end = () => {
      a.destroy();
      b.destroy();
      this.conns.delete(a);
    };
    const pipe = (from: net.Socket, to: net.Socket) => {
      // one queue per direction: like TCP, the order never changes
      const queue: { at: number; d: Buffer | null }[] = [];
      let busy = false;
      const next = () => {
        const q = queue[0];
        busy = !!q;
        if (!q) return;
        setTimeout(() => {
          queue.shift();
          if (!q.d) return end();
          if (!to.destroyed) to.write(q.d);
          next();
        }, Math.max(0, q.at - Date.now()));
      };
      const push = (d: Buffer | null) => {
        queue.push({ at: Date.now() + DELAY + Math.random() * JITTER, d });
        if (!busy) next();
      };
      from.on('data', push);
      from.on('close', () => push(null));
      from.on('error', end);
    };
    a.setNoDelay(true);
    b.setNoDelay(true);
    pipe(a, b);
    pipe(b, a);
  });
  async cut(ms: number) {
    this.down = true;
    for (const c of this.conns) c.destroy();
    await sleep(ms);
    this.down = false;
  }
}

function serve(dir: string) {
  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
  return http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, name);
    if (!file.startsWith(dir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
}

const roomOf = (p: Page) => p.eval<string>(`JSON.parse(sessionStorage.getItem('rmr-lan-session') || '{}').roomId || ''`);
const name = (p: Page, n: string) => p.type('#mp-name', n);

async function main() {
  // the site is built like on Netlify, only with the local backend address
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'rmr-site-'));
  console.log('building the site with VITE_MULTIPLAYER_URL …');
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const built = spawnSync(process.execPath, [vite, 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    env: { ...process.env, VITE_MULTIPLAYER_URL: `http://localhost:${PROXY}` },
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(built.stderr);
  const site = serve(dist);
  await new Promise<void>((r, e) => site.once('error', e).listen(SITE, () => r()));
  const proxy = new Proxy();
  await new Promise<void>((r) => proxy.server.listen(PROXY, () => r()));
  let worker: LocalWorker | null = null;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  const pages: Page[] = [];
  const url = `http://localhost:${SITE}/?debug`;
  const open = async (n: string, u = url) => {
    const p = await Page.open(n, u);
    pages.push(p);
    return p;
  };
  try {
    worker = await startWorker(WORKER, { LOBBY_COUNTDOWN: '15' });
    browser = await launchBrowser(['localhost', '127.0.0.1']);
    console.log(`\n[1] Menu (${path.basename(browser.exe)}; simulated internet: ${DELAY}–${DELAY + JITTER} ms each way)`);
    const A = await open('A');
    await A.waitText('Quick race', 20000);
    check('main menu and single player are unchanged', (await A.hasButton('Story')) && (await A.hasButton('Garage')) && (await A.hasButton('Multiplayer')));
    await A.lowGraphics();
    await A.click('Multiplayer');
    await A.waitText('Online: 1', 15000);
    check('online menu: Quick Play, private room, join, real online counter', (await A.hasButton('Quick Play')) && (await A.hasButton('Private room')) && (await A.hasButton('Join with a code')));
    const text = await A.eval<string>('document.body.textContent');
    check('no IP addresses, no LAN search, no installer in the online menu', !/\d+\.\d+\.\d+\.\d+|npm start|Setup\.exe|LAN server/i.test(text));
    check('the page only talks to the online service', sockets.every((s) => s.includes(`:${PROXY}/`)), sockets.join(' '));
    await name(A, 'Alice');
    await A.shot('o1-menu.png');

    console.log('\n[2] Quick Play');
    await A.click('Quick Play');
    await A.waitText('Searching for players');
    await A.waitText('Players found: 1 of 2');
    await A.shot('o2-search.png');
    await A.click('Cancel search');
    await A.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Quick Play') && !b.disabled)`);
    check('search can be cancelled', true);
    await A.click('Quick Play');
    const B = await open('B');
    await B.waitText('Quick race', 20000);
    await B.lowGraphics();
    await B.click('Multiplayer');
    await B.waitText('Online: 2', 15000);
    check('the second player is counted', true);
    await name(B, 'Bob');
    const t0 = Date.now();
    await B.click('Quick Play');
    await B.waitText('Starts in', 15000);
    await A.waitText('Starts in', 15000);
    check('both players are matched automatically into one lobby', (await roomOf(A)) === (await roomOf(B)) && (await roomOf(A)).length === 32 && (await A.has('Bob')) && (await B.has('Alice')), `${Date.now() - t0} ms`);
    const C = await open('C');
    await C.waitText('Quick race', 20000);
    await C.lowGraphics();
    await C.click('Multiplayer');
    await C.waitFor(`!!document.querySelector('#mp-name')`);
    await name(C, 'Cleo');
    await C.waitText('Online:', 15000);
    await C.click('Quick Play');
    await C.waitText('Starts in', 15000);
    await A.waitText('Cleo', 6000);
    check('a third player joins the waiting lobby', (await roomOf(C)) === (await roomOf(A)));
    check('lobby: ready buttons, no host rights, settings chosen by the server', (await A.hasButton("I'm ready")) && !(await A.hasButton('Start 🏁')) && !(await A.hasButton('Kick')) && (await A.has('Chosen by the server')));
    await A.shot('o3-lobby.png');
    for (const p of [A, B, C]) await p.click("I'm ready");

    console.log('\n[3] Race');
    for (const p of [A, B, C]) await p.waitFor(`window.__game && window.__game.phase === 'racing'`, 60000, 'green light');
    const times = await Promise.all([A, B, C].map((p) => p.eval<number>('window.__game.raceTime')));
    check('shared countdown and race clock', Math.max(...times) - Math.min(...times) < 0.5, times.map((x) => x.toFixed(2)).join(' / '));
    check('every browser shows 3 cars, 2 of them remote', (await Promise.all([A, B, C].map((p) => p.racers()))).every((r) => r.length === 3 && r.filter((x) => x.remote).length === 2));
    await B.key('keyDown', 'ArrowUp');
    await sleep(4000);
    const [ra, rb] = await Promise.all([A.racers(), B.racers()]);
    const me = rb.find((r) => !r.remote)!;
    const other = ra.find((r) => r.id === me.id)!;
    const delay = await A.eval<number>('window.__game.net.interpDelay');
    const gap = Math.hypot(other.x - me.x, other.z - me.z);
    check('A sees B drive where B is (± network delay)', me.speed > 12 && gap < me.speed * (delay / 1000 + 0.35) + 3, `B ${me.speed.toFixed(0)} m/s, seen ${gap.toFixed(1)} m behind, interpolation delay ${delay} ms`);
    check('the delay adapted to the connection', delay > 150 && delay < 450, `${delay} ms`);
    const steps = await A.eval<{ step: number; ms: number }[]>(
      `new Promise(res => { const g = window.__game, r = g.racers.find(x => x.netId === ${me.id}); const out = []; let px = r.x, pz = r.z, pt = g.net.now(); const f = () => { const t = g.net.now(); const step = Math.hypot(r.x - px, r.z - pz); if (step > 0) { out.push({ step, ms: t - pt }); px = r.x; pz = r.z; pt = t; } if (out.length < 150) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })`,
    );
    const speed = steps.reduce((x, s) => x + s.step, 0) / (steps.reduce((x, s) => x + s.ms, 0) / 1000);
    const off = steps.map((s) => Math.abs(s.step - (speed * s.ms) / 1000)).sort((x, y) => x - y);
    const pct = (k: number) => off[Math.min(off.length - 1, Math.floor(off.length * k))];
    check('remote car moves smoothly over a jittery connection', pct(0.5) < 0.35 && pct(0.95) < 1.3, `at ${speed.toFixed(0)} m/s the step differs from ideal by ${pct(0.5).toFixed(2)} m (median), ${pct(0.95).toFixed(2)} m (95 %), ${off[off.length - 1].toFixed(2)} m (max)`);
    const hz = await B.eval<{ tx: number; rx: number }>('({ tx: window.__game.net.txHz, rx: window.__game.net.rxHz })');
    check('at most ~10 messages per second leave a browser (free quota)', hz.tx <= 12, `sent ${hz.tx}/s, received ${hz.rx}/s`);
    await A.shot('o4-race.png');

    console.log('\n[4] Outage, page reload');
    const tag = await B.eval<number>('(window.__tag = Math.random())');
    const cut = proxy.cut(2500);
    await B.waitText('Connection lost', 8000);
    check('CONNECTION LOST is shown', true);
    await B.shot('o5-lost.png');
    await cut;
    for (const p of [A, B, C]) await p.waitFor(`window.__game.net.connState === 'open'`, 15000, 'reconnected');
    check('everybody reconnects into the running race without a reload', (await B.eval<number>('window.__tag')) === tag && (await B.eval<boolean>(`window.__game.phase === 'racing'`)));
    await sleep(2500);
    const rc = (await A.racers()).find((r) => r.id === me.id)!;
    check('cars keep moving after the outage', Math.hypot(rc.x - other.x, rc.z - other.z) > 30, `moved ${Math.hypot(rc.x - other.x, rc.z - other.z).toFixed(0)} m`);
    await B.key('keyUp', 'ArrowUp');
    await send('Page.reload', {}, C.session);
    await C.waitFor(`window.__game && window.__game.phase === 'racing'`, 30000, 'rejoined race');
    check('page reload rejoins the running race, no duplicate cars', (await C.racers()).length === 3 && (await A.racers()).length === 3);

    console.log('\n[5] Finish and results');
    for (const p of [A, B, C]) await p.eval('window.__game.autopilot = true');
    for (const p of [A, B, C]) await p.waitText('Back to lobby', 280000);
    await A.shot('o6-results.png');
    const order = (p: Page) => p.eval<string>(`[...document.querySelectorAll('span.block.truncate')].map(e => e.textContent).filter(x => ['Alice','Bob','Cleo'].includes(x)).join(',')`);
    const orders = await Promise.all([A, B, C].map(order));
    check('all three see the same server-decided results', orders[0].split(',').length === 3 && orders.every((o) => o === orders[0]), orders[0]);
    for (const p of [A, B]) await p.click('Back to lobby');
    await A.waitText('Starts in', 8000);
    check('back in the lobby; the next race is scheduled', true);
    for (const p of [A, B]) await p.click('Leave');
    await A.waitText('Quick Play');
    await C.click('Back to lobby');
    await C.waitText('Waiting for players', 8000);
    check('a lonely lobby waits instead of starting', true);
    await C.click('Leave');

    console.log('\n[6] Private room');
    await A.click('Private room');
    await A.waitText('Room name');
    check('online rooms have no public / LAN access switch', !(await A.has('Access')));
    await A.click('Create room 🚀');
    await A.waitFor(`/[A-Z2-9]{6}/.test(document.querySelector('code')?.textContent || '')`, 10000, 'room code');
    const code = await A.eval<string>(`document.querySelector('code').textContent`);
    check('private room shows its code', /^[A-Z2-9]{6}$/.test(code), code);
    await A.shot('o7-private.png');
    await B.click('Join with a code');
    await B.waitFor(`!!document.querySelector('#room-code')`);
    await B.type('#room-code', 'ZZZZZZ');
    await B.click('Join', `document.querySelector('form')`);
    await B.waitText('no room with this code', 6000);
    check('wrong code is explained', true);
    await B.click('Close');
    await B.type('#room-code', code.toLowerCase());
    await B.click('Join', `document.querySelector('form')`);
    await B.waitText("I'm ready", 10000);
    await A.waitText('Bob');
    check('friend joins with the code', (await roomOf(A)) === (await roomOf(B)));
    // invite link in a fresh browser
    const D = await open('D', `http://localhost:${SITE}/?room=${code}`);
    await D.waitFor(`document.querySelector('#room-code')?.value === '${code}'`, 20000, 'code from the link');
    check('an invite link opens the join form with the code', !(await D.eval<string>('location.search')).includes('room='));
    await D.waitText('Online:', 10000);
    await name(D, 'Dina');
    await D.click('Join', `document.querySelector('form')`);
    await D.waitText("I'm ready", 10000);
    await A.click('Candy', `document.querySelector('fieldset')`).catch(() => A.click('Battle'));
    await B.click("I'm ready");
    await D.click("I'm ready");
    await A.waitText('Everybody is ready', 8000);
    await A.click('Start 🏁');
    for (const p of [A, B]) await p.waitFor(`window.__game && window.__game.phase === 'racing' && window.__game.racers.length === 3`, 60000, 'private race');
    check('the host starts a race with friends', true);
    await A.click('⏸').catch(async () => A.key('keyDown', 'Escape'));
    await A.waitText('Leave', 8000).catch(() => {});
    // host closes the tab: the race continues for the others
    await send('Page.close', {}, A.session);
    pages.splice(pages.indexOf(A), 1);
    await B.waitFor(`window.__game.racers.some(r => r.offline)`, 12000, 'host offline');
    check('the host closing the tab does not end the race', await B.eval<boolean>(`window.__game.phase === 'racing'`));

    console.log('\n[7] Failures');
    await C.waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Quick Play') && !b.disabled)`, 15000, 'menu online');
    worker.stop();
    await C.waitText('cannot be reached', 15000);
    check('the menu says when the service is gone; buttons are off', await C.eval<boolean>(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Quick Play')).disabled`));
    await B.waitText('could not be restored', 50000);
    check('a race that cannot be resumed ends with an explanation', true);
    await B.click('Close');
    await B.waitText('Quick Play', 6000);
    check('…and leads back to the multiplayer menu', true);
    await C.shot('o8-offline.png');
    worker = await startWorker(WORKER);
    await C.waitText('Online:', 30000);
    check('the menu recovers by itself', true);
    worker.stop();
    // the daily quota is used up: Cloudflare answers with an error page without CORS headers
    const limit = http.createServer((_q, r) => void r.writeHead(429).end('error code: 1027')).listen(WORKER, '127.0.0.1');
    await C.waitText('Service limit reached', 45000);
    check('a used-up daily limit is named, not hidden', await C.has('00:00 UTC'));
    await C.shot('o9-limit.png');
    limit.closeAllConnections();
    limit.close();
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, C.session);
    await sleep(400);
    check('phone layout has no horizontal scrolling', await C.eval<boolean>('document.documentElement.scrollWidth <= innerWidth + 1'));
    await C.shot('o10-phone.png');
  } catch (e) {
    check('scenario completed', false, String((e as Error).message ?? e));
    for (const p of pages) {
      try {
        await p.shot(`fail-${p.name}.png`);
        console.log(`    ${p.name}: ${(await p.eval<string>('document.body.textContent')).replace(/\s+/g, ' ').slice(0, 300)}`);
      } catch {
        /* page gone */
      }
    }
  } finally {
    const real = errors.filter((x) => !/WebSocket connection|ERR_|Failed to load resource|CORS policy/.test(x));
    check('no JavaScript errors in any page', real.length === 0, real.slice(0, 4).join(' | '));
    check('nothing else was requested from the internet', outside.length === 0, [...new Set(outside)].slice(0, 4).join(' '));
    await browser?.stop();
    worker?.stop();
    proxy.server.close();
    site.closeAllConnections();
    site.close();
    fs.rmSync(dist, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
