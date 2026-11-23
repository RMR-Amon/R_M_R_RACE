/**
 * Desktop end-to-end test (npm run desktop:e2e): two real game windows (separate storage, real
 * WebGL engine) play a LAN race through this app's LAN server: create room → find it in the LAN
 * list → join → ready → start → drive → the other player sees the car → finish → results → lobby.
 * Screenshots go to RMR_E2E_OUT (if set).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, session } from 'electron';
import { hardenWindow, registerAppProtocolFor, webPreferences } from './main';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean }[] = [];
const log = (s: string) => console.log(`[e2e] ${s}`);
const check = (name: string, ok: boolean, info = '') => {
  results.push({ name, ok });
  log(`${ok ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

interface Page {
  name: string;
  win: BrowserWindow;
  eval<T = unknown>(js: string): Promise<T>;
  waitFor(js: string, ms?: number, what?: string): Promise<void>;
  click(text: string, scope?: string): Promise<void>;
  type(selector: string, value: string): Promise<void>;
  key(type: 'keydown' | 'keyup', code: string): Promise<void>;
  shot(file: string): Promise<void>;
  text(): Promise<string>;
}

const errors: string[] = [];

async function openPage(name: string, origin: string): Promise<Page> {
  const partition = `e2e-${name}`;
  registerAppProtocolFor(session.fromPartition(partition));
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: { ...webPreferences(partition), offscreen: true },
  });
  hardenWindow(win);
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`${name}: ${message.slice(0, 300)}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`${name}: renderer gone (${d.reason})`));
  await win.loadURL(`${origin}/?debug`);
  const p: Page = {
    name,
    win,
    eval: (js) => win.webContents.executeJavaScript(js, true),
    async waitFor(js, ms = 15000, what = js) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        try {
          if (await p.eval(js)) return;
        } catch {
          /* page busy */
        }
        await sleep(150);
      }
      throw new Error(`${name}: timeout waiting for ${what}`);
    },
    async click(text, scope = 'document') {
      const ok = await p.eval(
        `(() => { const b = [...${scope}.querySelectorAll('button')].find(b => b.textContent.trim().includes(${JSON.stringify(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`,
      );
      if (!ok) throw new Error(`${name}: no enabled button "${text}"`);
    },
    async type(selector, value) {
      await p.eval(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    },
    async key(type, code) {
      await p.eval(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { code: ${JSON.stringify(code)}, key: ${JSON.stringify(code)} }))`);
    },
    async shot(file) {
      const dir = process.env.RMR_E2E_OUT;
      if (!dir) return;
      const img = await win.webContents.capturePage();
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), img.toPNG());
    },
    text: () => p.eval<string>('document.body.textContent'),
  };
  return p;
}

const racers = (p: Page) =>
  p.eval<{ name: string; remote: boolean; x: number; z: number; speed: number; place: number }[] | null>(
    `(() => { const g = window.__game; if (!g) return null; return g.racers.map(r => ({ name: r.name, remote: r.remote, x: r.x, z: r.z, speed: r.speed, place: r.place })); })()`,
  );

export async function runE2E(origin: string): Promise<number> {
  const pages: Page[] = [];
  try {
    const A = await openPage('A', origin);
    const B = await openPage('B', origin);
    pages.push(A, B);
    for (const p of pages) await p.waitFor(`document.body.textContent.includes('Multiplayer') || document.body.textContent.includes('Мультиплеер')`, 30000, 'menu');
    // play in English so the button texts below match
    for (const p of pages) {
      await p.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') && b.textContent.includes('⚙')); b.click(); })()`);
      await p.click('English');
      await p.click('Close');
    }
    check('desktop bridge is available in the page', await A.eval<boolean>('!!window.rmrDesktop && window.rmrDesktop.isDesktop'));
    const lan = await A.eval<{ running: boolean; port: number; primary: string | null }>('window.rmrDesktop.lanInfo()');
    check('LAN server runs in the main process', lan.running, `port ${lan.port}, LAN address ${lan.primary}`);
    check('page has no Node access (contextIsolation / sandbox)', (await A.eval<string>('typeof require + typeof process')) === 'undefinedundefined');

    // ---- A creates a 1-lap room
    await A.click('Multiplayer (LAN)');
    await A.waitFor(`!!document.querySelector('#mp-name')`);
    await A.shot('01-mp-desktop.png');
    check('desktop shows the LAN server panel', (await A.text()).includes('LAN server'));
    await A.type('#mp-name', 'Alice');
    await A.click('Create room');
    await A.waitFor(`document.body.textContent.includes('Room name')`);
    await A.eval(`(() => { const h = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Laps'); [...h.parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === '1').click(); })()`);
    await A.waitFor(`![...document.querySelectorAll('button')].find(b => b.textContent.includes('Create room 🚀')).disabled`, 10000, 'create enabled');
    await A.click('Create room 🚀');
    await A.waitFor(`document.body.textContent.includes("Alice's room")`, 10000, 'host lobby');
    check('host is in the lobby of a new room', true);

    // ---- B finds it in the LAN list and joins
    await B.click('Multiplayer (LAN)');
    await B.waitFor(`!!document.querySelector('#mp-name')`);
    await B.type('#mp-name', 'Bob');
    await B.waitFor(`document.body.textContent.includes("Alice's room")`, 10000, 'room listed');
    await B.waitFor(`document.body.textContent.includes('reachable')`, 8000, 'reachability check');
    await B.shot('02-find-rooms.png');
    check('room appears in the LAN list with a reachability / ping check', true);
    await B.click('Join');
    await B.waitFor(`document.body.textContent.includes("I'm ready")`, 10000, 'guest lobby');
    await A.waitFor(`document.body.textContent.includes('Bob')`, 5000, 'host sees Bob');
    check('host sees the new player', true);
    await B.click("I'm ready");
    await A.waitFor(`document.body.textContent.includes('Everybody is ready')`, 10000, 'all ready');
    await A.shot('03-lobby.png');
    check('lobby: ready state reaches the host, start unlocked', true);

    // ---- race
    await A.click('Start 🏁');
    await A.waitFor('!!window.__game', 30000, 'A race');
    await B.waitFor('!!window.__game', 30000, 'B race');
    await A.waitFor(`window.__game.phase === 'racing'`, 25000, 'A green light');
    await B.waitFor(`window.__game.phase === 'racing'`, 25000, 'B green light');
    const [tA, tB] = [await A.eval<number>('window.__game.raceTime'), await B.eval<number>('window.__game.raceTime')];
    check('shared countdown and race clock', Math.abs(tA - tB) < 0.3, `A ${tA.toFixed(2)} s / B ${tB.toFixed(2)} s`);
    const ra = (await racers(A))!;
    check('each game has both cars, the other one network-driven', ra.length === 2 && ra.filter((r) => r.remote).length === 1);

    await B.key('keydown', 'ArrowUp');
    await sleep(4000);
    await A.shot('04-race-host-view.png');
    await B.shot('05-race-guest-view.png');
    const bSelf = (await racers(B))!.find((r) => !r.remote)!;
    const bOnA = (await racers(A))!.find((r) => r.remote)!;
    const dist = Math.hypot(bSelf.x - bOnA.x, bSelf.z - bOnA.z);
    check('B drives in its own game', bSelf.speed > 15, `${bSelf.speed.toFixed(1)} m/s`);
    check("A shows B's car where B really is (interpolation delay only)", dist < bSelf.speed * 0.25 + 3, `${dist.toFixed(1)} m apart`);
    // smoothness: sample B's car on A's screen every frame for 1 s
    const jumps = await A.eval<number>(`new Promise(res => { const g = window.__game; const r = g.racers.find(x => x.remote); let px = r.x, pz = r.z, max = 0, n = 0; const f = () => { const d = Math.hypot(r.x - px, r.z - pz); max = Math.max(max, d); px = r.x; pz = r.z; if (++n < 60) requestAnimationFrame(f); else res(max); }; requestAnimationFrame(f); })`);
    check('remote car moves smoothly (no teleports between frames)', jumps < 4, `max ${jumps.toFixed(2)} m per frame`);
    const placeA = await A.eval<number>('window.__game.player.place');
    check('host-authoritative standings put B ahead', placeA === 2, `A is P${placeA}`);
    await sleep(1200);
    const net = await A.eval<{ rxHz: number }>('({ rxHz: window.__game.net.rxHz })');
    const tx = await B.eval<{ txHz: number; fps: number }>(`new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 30) requestAnimationFrame(f); else res({ txHz: window.__game.net.txHz, fps: Math.round(n * 1000 / (performance.now() - t0)) }); }; requestAnimationFrame(f); })`);
    check('car states / snapshots flow at the network tick rate', net.rxHz >= 15 && tx.txHz >= 17, `B sends ${tx.txHz}/s at ${tx.fps} fps, A receives ${net.rxHz} snapshots/s`);

    // ---- finish (the AI drives both cars for the rest of the lap)
    await B.key('keyup', 'ArrowUp');
    await A.eval('window.__game.autopilot = true');
    await B.eval('window.__game.autopilot = true');
    log('autopilot is driving both cars to the finish…');
    await A.waitFor(`document.body.textContent.includes('Back to lobby')`, 180000, 'results A');
    await B.waitFor(`document.body.textContent.includes('Back to lobby')`, 20000, 'results B');
    await A.shot('06-results.png');
    const res = await A.text();
    check('race ends with results on both screens', res.includes('Alice') && res.includes('Bob'));

    await A.click('Back to lobby');
    await B.click('Back to lobby');
    await B.waitFor(`document.body.textContent.includes("I'm ready")`, 5000, 'B lobby');
    check('both return to the same lobby', true);

    // ---- host stops the LAN server: the guest must be told (no endless waiting)
    await A.click('Leave');
    await A.waitFor(`document.body.textContent.includes('LAN server')`, 5000, 'A menu');
    await A.click('Stop');
    await B.waitFor(`document.body.textContent.includes('was shut down') || document.body.textContent.includes('closed the room') || document.body.textContent.includes('no longer')`, 20000, 'guest notified');
    await B.shot('07-host-stopped.png');
    check('guest is told when the host stops its server', true);
    await A.click('Start');
    await A.waitFor(`document.body.textContent.includes('running')`, 8000, 'server restarted');
    check('host can start the LAN server again from the game', true);
  } catch (e) {
    check('scenario completed', false, String((e as Error).message ?? e));
    for (const p of pages) {
      try {
        await p.shot(`fail-${p.name}.png`);
        log(`${p.name} page: ${(await p.text()).slice(0, 300)}`);
      } catch {
        /* ignore */
      }
    }
  }
  const relevant = errors.filter((e) => !/fonts\.(googleapis|gstatic)|ERR_INTERNET|Autofill|DevTools/.test(e));
  check('no errors in the page consoles', relevant.length === 0, relevant.slice(0, 5).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  log(`${results.length - failed}/${results.length} desktop checks passed`);
  for (const p of pages) p.win.destroy();
  return failed ? 1 : 0;
}
