/** minimal Chrome / Edge driver (DevTools protocol) used by the browser tests */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const OUT = process.env.RMR_E2E_OUT;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function findBrowser(): string | null {
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
export const listeners: ((m: CdpMsg) => void)[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    cdp.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

export const errors: string[] = [];
export const outside: string[] = [];
export const sockets: string[] = [];

export class Page {
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

/** starts a headless browser that can only reach the given hosts; returns a function that stops it */
export async function launchBrowser(allow: string[]): Promise<{ exe: string; stop: () => Promise<void> }> {
  const exe = findBrowser();
  if (!exe) throw new Error('Chrome / Edge not found (set CHROME_PATH)');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmr-browser-'));
  const chrome: ChildProcess = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--lang=en-US',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--mute-audio', '--enable-unsafe-swiftshader',
    // no internet: nothing but this computer can be reached
    `--host-resolver-rules=MAP * ~NOTFOUND , ${allow.map((h) => `EXCLUDE ${h}`).join(' , ')}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const stop = async () => {
    try {
      await Promise.race([send('Browser.close'), sleep(2000)]);
    } catch {
      /* already closed */
    }
    cdp?.terminate();
    chrome.kill();
    await sleep(500);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      /* the OS still holds a file of the temporary profile */
    }
  };
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = '';
    chrome.stderr!.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', () => reject(new Error('browser exited')));
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
  return { exe, stop };
}
