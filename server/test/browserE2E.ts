/**
 * Browser LAN test (npm run test:browser, needs "npm run build" first and Chrome or Edge).
 *
 * Ordinary browsers, no Electron: three isolated browser profiles play a race through real LAN
 * servers. The browser's DNS is cut off, so anything that needs the internet fails the test.
 *
 *   A  organizer, opened http://localhost:<port>
 *   B  player, opened http://<LAN IP>:<port>
 *   C  player on a SECOND LAN server: finds and joins A's room across servers
 *
 * All on one computer: this does not prove that a particular Wi-Fi / firewall lets devices talk.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { launchServer } from '../launch';
import { setLogLevel } from '../log';
import { primaryAddress } from '../netInfo';

setLogLevel((process.env.RMR_LOG as 'info') ?? 'error');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.join(root, 'dist');
const OUT = process.env.RMR_E2E_OUT;
const P1 = 47960;
const P2 = 47970;
const UDP = 47961;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${info ? ` — ${info}` : ''}`);
};

function findBrowser(): string | null {
  const env = process.env.CHROME_PATH;
  const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const list = [
    ...(env ? [env] : []),
    ...pf.map((p) => path.join(p, 'Google/Chrome/Application/chrome.exe')),
    ...pf.map((p) => path.join(p, 'Microsoft/Edge/Application/msedge.exe')),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return list.find((f) => fs.existsSync(f)) ?? null;
}

// ------------------------------------------------------------------------------------------ DevTools protocol
interface CdpMsg {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, never>;
  result?: Record<string, never>;
  error?: { message: string };
}
let cdp: WebSocket;
let nextId = 0;
const pending = new Map<number, (m: CdpMsg) => void>();
const listeners: ((m: CdpMsg) => void)[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    cdp.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const errors: string[] = [];
const outside: string[] = [];
const sockets: string[] = [];

class Page {
  constructor(
    readonly name: string,
    readonly session: string,
  ) {}
  static async open(name: string, url: string, prepare?: (p: Page) => Promise<void>): Promise<Page> {
    // own browser context = own storage, like another device
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true, width: 1280, height: 760 });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Page(name, sessionId);
    listeners.push((m) => {
      if (m.sessionId !== sessionId) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = m.params as any;
      if (m.method === 'Runtime.exceptionThrown') errors.push(`${name}: ${a.exceptionDetails.exception?.description ?? a.exceptionDetails.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && a.type === 'error') errors.push(`${name}: ${a.args.map((x: { value?: string; description?: string }) => x.value ?? x.description).join(' ')}`.slice(0, 300));
      if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(a.request.url)) {
        const h = new URL(a.request.url).hostname;
        if (h !== 'localhost' && !/^(127|10|192\.168|172|169\.254|100)\./.test(h) && h !== 'r-m-r-race.netlify.app') outside.push(a.request.url);
      }
      if (m.method === 'Network.webSocketCreated') sockets.push(`${name} ${a.url}`);
    });
    for (const d of ['Runtime', 'Page', 'Network']) await send(`${d}.enable`, {}, sessionId);
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
    if (prepare) await prepare(p);
    await p.goto(url);
    return p;
  }
  goto(url: string) {
    return send('Page.navigate', { url }, this.session);
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, this.session);
    if (r.exceptionDetails) throw new Error(`${this.name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }
  async waitFor(js: string, ms = 15000, what = js) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await this.eval(js)) return;
      } catch {
        /* page is loading */
      }
      await sleep(120);
    }
    throw new Error(`${this.name}: timeout waiting for ${what}`);
  }
  waitText(text: string, ms = 15000) {
    return this.waitFor(`!!document.body && document.body.textContent.includes(${JSON.stringify(text)})`, ms, `"${text}"`);
  }
  waitGone(text: string, ms = 15000) {
    return this.waitFor(`!!document.body && !document.body.textContent.includes(${JSON.stringify(text)})`, ms, `"${text}" to disappear`);
  }
  has(text: string) {
    return this.eval<boolean>(`document.body.textContent.includes(${JSON.stringify(text)})`);
  }
  hasButton(text: string) {
    return this.eval<boolean>(`[...document.querySelectorAll('button')].some(b => b.textContent.includes(${JSON.stringify(text)}))`);
  }
  async click(text: string, scope = 'document') {
    await this.waitFor(
      `(() => { const b = [...${scope}.querySelectorAll('button')].find(b => b.textContent.trim().includes(${JSON.stringify(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`,
      8000,
      `enabled button "${text}"`,
    );
  }
  type(selector: string, value: string) {
    return this.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
  }
  key(type: 'keyDown' | 'keyUp', code: string) {
    return send('Input.dispatchKeyEvent', { type, code, key: code, windowsVirtualKeyCode: code === 'ArrowUp' ? 38 : 0 }, this.session);
  }
  async shot(file: string) {
    if (!OUT) return;
    fs.mkdirSync(OUT, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' }, this.session);
    fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
  }
  racers() {
    return this.eval<{ id: number; remote: boolean; x: number; z: number; speed: number; offline: boolean }[]>(
      `window.__game.racers.map(r => ({ id: r.netId, remote: r.remote, x: r.x, z: r.z, speed: r.speed, offline: r.offline }))`,
    );
  }
  /** lighter graphics: three 3D windows share one computer */
  async lowGraphics() {
    await this.click('⚙️');
    await this.click('Low');
    await this.click('Close');
  }
}

async function main() {
  const exe = findBrowser();
  if (!exe) throw new Error('Chrome / Edge not found (set CHROME_PATH)');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error('run "npm run build" first');
  const ip = primaryAddress();
  if (!ip) throw new Error('no LAN interface: connect to a network');
  const open = async (port: number) => (await launchServer({ port, udpPort: UDP, distDir, fixedPort: true })).srv;

  let s1 = await open(P1);
  const s2 = await open(P2);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmr-browser-'));
  let chrome: ChildProcess | null = null;
  const pages: Page[] = [];
  try {
    chrome = spawn(exe, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--lang=en-US',
      '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--mute-audio', '--enable-unsafe-swiftshader',
      // no internet: nothing but this computer can be reached
      `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1 , EXCLUDE ${ip}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = '';
      chrome!.stderr!.on('data', (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) resolve(m[1]);
      });
      chrome!.on('exit', () => reject(new Error('browser exited')));
      setTimeout(() => reject(new Error('browser did not start')), 20000);
    });
    cdp = new WebSocket(wsUrl);
    await new Promise((r) => cdp.once('open', r));
    cdp.on('message', (d) => {
      const m = JSON.parse(d.toString()) as CdpMsg;
      if (m.id !== undefined) {
        pending.get(m.id)?.(m);
        pending.delete(m.id);
      } else for (const f of listeners) f(m);
    });

    console.log(`\n[1] Opening the game in browsers (${path.basename(exe)}, LAN IP ${ip}, no internet)`);
    const A = await Page.open('A', `http://localhost:${P1}/?debug`);
    pages.push(A);
    await A.waitText('Multiplayer (LAN)', 20000);
    check('organizer: game opens on localhost, main menu', true);
    check('no Electron bridge in the page', !(await A.eval<boolean>('!!window.rmrDesktop')));
    check('bundled fonts load without internet', await A.eval<boolean>(`Promise.all([document.fonts.load('16px "Russo One"'), document.fonts.load('900 16px Nunito')]).then(r => r.every(x => x.length > 0))`));
    await A.lowGraphics();
    await A.click('Multiplayer (LAN)');
    await A.waitText(`http://${ip}:${P1}`);
    const aText = await A.eval<string>('document.body.textContent');
    check('organizer sees the real LAN address (not localhost), status and counters', aText.includes('LAN server: running') && aText.includes('players: 0') && !aText.includes('http://localhost'));
    await A.click('QR code');
    check('QR code contains the LAN address', (await A.eval<string>(`document.querySelector('svg[role=img]').getAttribute('aria-label')`)) === `http://${ip}:${P1}/`);
    await A.click('Copy');
    await A.waitText('Copied', 3000);
    check('copy button works', true);
    await A.shot('01-organizer.png');

    const B = await Page.open('B', `http://${ip}:${P1}/?debug`);
    pages.push(B);
    await B.waitText('No LAN rooms found', 20000);
    check('player opening the LAN IP lands on the room list', true);
    const secure = await B.eval<boolean>('window.isSecureContext');
    await B.click('QR code');
    await B.click('Copy');
    await B.waitFor(`/Copied|Select the address/.test(document.body.textContent)`, 3000);
    check('copy works on plain http too', await B.has('Copied'), `secure context: ${secure}`);
    await B.click('Back');
    await B.waitText('Quick race');
    check('single player stays available on the LAN page', (await B.hasButton('Story')) && (await B.hasButton('Garage')));
    await B.lowGraphics();
    await B.click('Multiplayer (LAN)');
    await B.type('#mp-name', 'Bob');
    const C = await Page.open('C', `http://${ip}:${P2}/?debug`);
    pages.push(C);
    await C.waitText('No LAN rooms found', 20000);
    await C.click('Back');
    await C.lowGraphics();
    await C.click('Multiplayer (LAN)');
    await C.type('#mp-name', 'Cleo');

    console.log('\n[2] Rooms: automatic list, two servers, private room');
    await A.type('#mp-name', 'Alice');
    await A.click('Create room');
    await A.waitText('Room name');
    await A.eval(`(() => { const h = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Laps'); [...h.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === '1').click(); })()`);
    await A.click('Create room 🚀');
    await A.waitText("Alice's room");
    const t0 = Date.now();
    await B.waitText("Alice's room", 6000);
    check('room appears on the same server without refresh', true, `${Date.now() - t0} ms`);
    await C.waitText("Alice's room", 6000);
    check('room appears on the other server (UDP discovery), with the host\'s real address', await C.has(`${ip}:${P1}`), `${Date.now() - t0} ms`);
    await C.waitText('reachable');
    check('reachability / ping shown', true);
    check('organizer\'s lobby invites with the LAN address', await A.has(`http://${ip}:${P1}`));

    // a second room on the other server, private
    const D = await Page.open('D', `http://${ip}:${P2}/`);
    pages.push(D);
    await D.waitFor(`!!document.querySelector('#mp-name')`, 20000);
    await D.type('#mp-name', 'Dan');
    await D.click('Create room');
    await D.click('Private');
    await D.click('Create room 🚀');
    await D.waitText("Dan's room");
    const code = await D.eval<string>(`(document.body.textContent.match(/Code: ?(\\d{4})/) || [])[1] || ''`);
    await B.waitText("Dan's room", 6000);
    check('several rooms from several servers are listed together', (await B.has("Alice's room")) && (await B.has("Dan's room")) && (await B.has('LAN rooms (2)')));
    const pickDan = `[...document.querySelectorAll('.group.flex')].find(e => e.textContent.includes("Dan's room"))`;
    await B.click('Join', pickDan);
    await B.waitText('Room code');
    await B.type('input[inputmode=numeric]', code === '0000' ? '1111' : '0000');
    await B.click('Enter');
    await B.waitText('Wrong room code', 6000);
    check('private room: wrong code is refused with a message', true);
    await B.click('Close');
    await B.waitText("Dan's room");
    await B.click('Join', pickDan);
    await B.waitText('Room code');
    await B.type('input[inputmode=numeric]', code);
    await B.click('Enter');
    await B.waitText("I'm ready");
    check('private room: right code joins a room on ANOTHER server', (await B.has("Dan's room")) && sockets.some((s) => s === `B ws://${ip}:${P2}/play`));
    check('lobby of a remote room shows that room\'s address', await B.has(`http://${ip}:${P2}`));
    await B.click('Leave');
    await B.waitText("Alice's room");
    await D.click('Close room');
    await D.click('Close room', `document.querySelector('.fixed.inset-0.z-50')`);
    await B.waitGone("Dan's room", 6000);
    check('closed room disappears from the other server\'s list', true);
    await send('Page.close', {}, D.session);
    pages.splice(pages.indexOf(D), 1);

    console.log('\n[3] Lobby');
    await B.click('Join');
    await B.waitText("I'm ready");
    await C.click('Join');
    await C.waitText("I'm ready");
    await A.waitText('Cleo');
    check('both players joined; the second one across servers', (await A.has('Bob')) && sockets.some((s) => s === `C ws://${ip}:${P1}/play`));
    check('players do not see the Start button', !(await B.hasButton('Start 🏁')) && !(await C.hasButton('Start 🏁')));
    check('organizer cannot start before everybody is ready', await A.eval<boolean>(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Start 🏁')).disabled`));
    await B.click("I'm ready");
    await C.click("I'm ready");
    await A.waitText('Everybody is ready', 10000);
    check('start unlocks when everybody is ready', true);
    await A.shot('02-lobby.png');

    console.log('\n[4] Race');
    await A.click('Start 🏁');
    for (const p of [A, B, C]) await p.waitFor(`window.__game && window.__game.phase === 'racing'`, 45000, 'green light');
    const times = await Promise.all([A, B, C].map((p) => p.eval<number>('window.__game.raceTime')));
    check('shared countdown and race clock on all three', Math.max(...times) - Math.min(...times) < 0.4, times.map((x) => x.toFixed(2)).join(' / '));
    check('every browser shows 3 cars, 2 of them remote', (await Promise.all([A, B, C].map((p) => p.racers()))).every((r) => r.length === 3 && r.filter((x) => x.remote).length === 2));
    await B.key('keyDown', 'ArrowUp');
    await sleep(3500);
    const [ra, rb, rc] = await Promise.all([A.racers(), B.racers(), C.racers()]);
    const me = rb.find((r) => !r.remote)!;
    const dist = (list: typeof ra) => {
      const o = list.find((r) => r.id === me.id)!;
      return Math.hypot(o.x - me.x, o.z - me.z);
    };
    check('B drives with the keyboard', me.speed > 12, `${me.speed.toFixed(1)} m/s`);
    check('A and C see B where B is (± interpolation delay)', dist(ra) < me.speed * 0.45 + 3 && dist(rc) < me.speed * 0.45 + 3, `${dist(ra).toFixed(1)} m / ${dist(rc).toFixed(1)} m`);
    // every frame: how far did B's car move on A's screen, compared with the render clock?
    const steps = await A.eval<{ step: number; ms: number }[]>(
      `new Promise(res => { const g = window.__game, r = g.racers.find(x => x.netId === ${me.id}); const out = []; let px = r.x, pz = r.z, pt = g.net.now(); const f = () => { const t = g.net.now(); const step = Math.hypot(r.x - px, r.z - pz); if (step > 0) { out.push({ step, ms: t - pt }); px = r.x; pz = r.z; pt = t; } if (out.length < 120) requestAnimationFrame(f); else res(out); }; requestAnimationFrame(f); })`,
    );
    const speed = steps.reduce((x, s) => x + s.step, 0) / (steps.reduce((x, s) => x + s.ms, 0) / 1000);
    const off = steps.map((s) => Math.abs(s.step - (speed * s.ms) / 1000)).sort((x, y) => x - y);
    const pct = (k: number) => off[Math.min(off.length - 1, Math.floor(off.length * k))];
    check(
      'remote car moves smoothly on the other screen',
      pct(0.5) < 0.25 && pct(0.95) < 1 && off[off.length - 1] < 4,
      `at ${speed.toFixed(0)} m/s the step differs from ideal by ${pct(0.5).toFixed(2)} m (median), ${pct(0.95).toFixed(2)} m (95 %), ${off[off.length - 1].toFixed(2)} m (max); longest frame ${Math.max(...steps.map((s) => s.ms)).toFixed(0)} ms`,
    );
    await A.shot('03-race.png');

    console.log('\n[5] Connection loss, page reload');
    const room = [...s1.manager.rooms.values()][0];
    const bob = [...room.players.values()].find((p) => p.profile.name === 'Bob')!;
    const gameBefore = await B.eval<number>(`(window.__tag = Math.random())`);
    bob.peer!.ws.terminate();
    await sleep(150);
    const dropped = bob.status === 'reconnecting';
    const t1 = Date.now();
    while (bob.status !== 'online' && Date.now() - t1 < 8000) await sleep(50);
    check('dropped connection is re-established automatically during the race', dropped && bob.status === 'online', `${Date.now() - t1} ms`);
    check('the running race is kept (no reload)', (await B.eval<number>('window.__tag')) === gameBefore && (await B.eval<boolean>(`window.__game.phase === 'racing'`)));
    const cleo = [...room.players.values()].find((p) => p.profile.name === 'Cleo')!;
    const carX = (await A.racers()).find((r) => r.id === cleo.id)!.x;
    await send('Page.reload', {}, C.session);
    await C.waitFor(`window.__game && window.__game.phase === 'racing'`, 30000, 'rejoined race');
    const cx = (await C.racers()).find((r) => !r.remote)!.x;
    check('page reload rejoins the running race at the same place', cleo.status === 'online' && Math.abs(cx - carX) < 12, `${Math.abs(cx - carX).toFixed(1)} m`);

    console.log('\n[6] Finish and results');
    await B.key('keyUp', 'ArrowUp');
    for (const p of [A, B, C]) await p.eval('window.__game.autopilot = true');
    for (const p of [A, B, C]) await p.waitText('Back to lobby', 200000);
    await A.shot('04-results.png');
    const order = (p: Page) => p.eval<string>(`[...document.querySelectorAll('span.block.truncate')].map(e => e.textContent).filter(x => ['Alice','Bob','Cleo'].includes(x)).join(',')`);
    const orders = await Promise.all([A, B, C].map(order));
    check('all three see the same host-decided order', orders[0].split(',').length === 3 && orders.every((o) => o === orders[0]), orders[0]);
    for (const p of [A, B, C]) await p.click('Back to lobby');
    await B.waitText("I'm ready");
    check('everybody is back in the same lobby', (await A.has('Bob')) && (await A.has('Cleo')));

    console.log('\n[7] Leaving, room close, server stop and restart');
    await C.click('Leave');
    await A.waitGone('Cleo', 6000);
    check('leaving player disappears from the lobby', true);
    await A.click('Close room');
    await A.click('Close room', `document.querySelector('.fixed.inset-0.z-50')`);
    await B.waitText('The host closed the room', 6000);
    check('players are told when the room is closed', true);
    await B.click('Close');
    await A.click('Create room');
    await A.click('Create room 🚀');
    await B.waitText("Alice's room", 6000);
    await B.click('Join');
    await B.waitText("I'm ready");
    await s1.close();
    await B.waitText('was shut down', 6000);
    check('players in a lobby are told when the server stops', true);
    await B.click('Close');
    await B.waitText('no connection', 12000);
    check('the menu reports the lost server honestly (nothing pretends to be connected)', !(await B.has('LAN server: running')));
    await B.shot('05-server-stopped.png');
    s1 = await open(P1);
    await B.waitText('LAN server: running', 12000);
    check('the page recovers by itself when the server is back', true);

    console.log('\n[8] Address entry and the HTTPS website');
    await B.type('input[inputmode=url]', `127.0.0.1:47999`);
    await B.click('Search');
    await B.waitText('No RMR_race host answered', 8000);
    check('closed port / wrong address gives an error', true);
    const prepare = async (p: Page) => {
      listeners.push((m) => {
        if (m.sessionId !== p.session || m.method !== 'Fetch.requestPaused') return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = m.params as any;
        const name = decodeURIComponent(new URL(a.request.url).pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.join(distDir, name);
        const ok = fs.existsSync(file) && fs.statSync(file).isFile();
        const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html';
        void send('Fetch.fulfillRequest', {
          requestId: a.requestId, responseCode: ok ? 200 : 404, responseHeaders: [{ name: 'content-type', value: type }],
          body: ok ? fs.readFileSync(file).toString('base64') : '',
        }, p.session);
      });
      await send('Fetch.enable', { patterns: [{ urlPattern: 'https://r-m-r-race.netlify.app/*' }] }, p.session);
    };
    const W = await Page.open('W', 'https://r-m-r-race.netlify.app/', prepare);
    pages.push(W);
    await W.waitText('Multiplayer (LAN)', 20000);
    await W.click('Multiplayer (LAN)');
    await W.waitText("Organizer's address");
    const wt = await W.eval<string>('document.body.textContent');
    check('HTTPS site: LAN guide, no installer, no fake search', wt.includes('nothing to install') && !/Setup\.exe|Desktop|rmrrace/i.test(wt));
    await sleep(1500);
    check('HTTPS site makes no WebSocket attempts', !sockets.some((s) => s.startsWith('W ')));
    await W.type('#lan-address', '8.8.8.8');
    await W.click('Open');
    await W.waitText('A local network address is needed', 3000);
    check('public addresses are rejected', true);
    await W.shot('06-website.png');
    await W.type('#lan-address', `${ip}:${P1}`);
    await W.click('Open');
    await W.waitFor(`location.href.startsWith('http://${ip}:${P1}/') && document.body.textContent.includes('LAN server: running')`, 15000, 'LAN page');
    check('entered address opens the organizer\'s game from the HTTPS site', true);
    // phone layout
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, W.session);
    await sleep(400);
    check('phone layout has no horizontal scrolling', await W.eval<boolean>('document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll("section,code,button")].every(e => e.getBoundingClientRect().right <= innerWidth + 1)'));
    await W.shot('07-phone.png');
  } catch (e) {
    check('scenario completed', false, String((e as Error).message ?? e));
    for (const p of pages) {
      try {
        await p.shot(`fail-${p.name}.png`);
        console.log(`    ${p.name}: ${(await p.eval<string>('document.body.textContent')).replace(/\s+/g, ' ').slice(0, 260)}`);
      } catch {
        /* page gone */
      }
    }
  } finally {
    // expected: the browser itself logs failed sockets while the server is down / for the closed port
    const real = errors.filter((x) => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/.test(x));
    check('no JavaScript errors in any page', real.length === 0, real.slice(0, 4).join(' | '));
    check('nothing was requested from the internet', outside.length === 0, [...new Set(outside)].slice(0, 4).join(' '));
    try {
      await Promise.race([send('Browser.close'), sleep(2000)]);
    } catch {
      /* already closed */
    }
    cdp?.terminate();
    chrome?.kill();
    await Promise.all([s1.close().catch(() => {}), s2.close().catch(() => {})]);
    await sleep(500);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* the OS still holds a file of the temporary profile */
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
