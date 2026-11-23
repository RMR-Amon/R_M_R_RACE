/**
 * RMR_race desktop app — Electron main process.
 *
 *  - Shows the EXISTING game (the same Vite build Netlify publishes) from a custom `app://` scheme,
 *    so the UI does not depend on the LAN server and the server can be started / stopped from it.
 *  - Runs the LAN host server (server/index.ts: HTTP + WebSocket on 0.0.0.0, UDP discovery) here,
 *    in Node — never inside the page.
 *  - Security: contextIsolation, sandbox, no nodeIntegration, a tiny preload API, IPC sender checks,
 *    navigation locked to the app, external links only https in the system browser, CSP.
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, ipcMain, net, protocol, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { LanController } from './lan';
import { log } from '../server/log';

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://rmr`;
const E2E = !!process.env.RMR_E2E;

protocol.registerSchemesAsPrivileged([
  // not "secure": the page must be allowed to open ws:// connections to LAN hosts (192.168.x.x)
  { scheme: SCHEME, privileges: { standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const distDir = path.join(app.getAppPath(), 'dist');
let win: BrowserWindow | null = null;

const lan = new LanController(distDir, (info) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lan:changed', info);
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  // LAN hosts: WebSocket (game) and HTTP (room list / reachability checks)
  "connect-src 'self' ws: http:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/** serves dist/ on app://rmr/ (SPA fallback, no path traversal) for one browser session */
export function registerAppProtocolFor(ses: Electron.Session) {
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  ses.protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    const file = path.normalize(path.join(distDir, rel));
    if (file !== distDir && !file.startsWith(distDir + path.sep)) return new Response('forbidden', { status: 403 });
    let target = file;
    try {
      if (!fs.statSync(target).isFile()) target = path.join(distDir, 'index.html');
    } catch {
      target = path.join(distDir, 'index.html');
    }
    const res = await net.fetch(pathToFileURL(target).toString());
    const type = MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream';
    return new Response(res.body, { status: 200, headers: { 'content-type': type, 'content-security-policy': CSP } });
  });
}

/** only our own page may use the IPC API */
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent) => !!e.senderFrame && e.senderFrame.url.startsWith(`${ORIGIN}/`);

function registerIpc() {
  ipcMain.on('app:version', (e) => {
    e.returnValue = trusted(e) ? app.getVersion() : '';
  });
  ipcMain.handle('lan:info', (e) => (trusted(e) ? lan.info() : null));
  ipcMain.handle('lan:start', (e) => (trusted(e) ? lan.start() : null));
  ipcMain.handle('lan:stop', (e) => (trusted(e) ? lan.stop() : null));
  ipcMain.on('app:open', (e, url: unknown) => {
    if (!trusted(e) || typeof url !== 'string') return;
    if (/^https:\/\/[^\s]+$/.test(url)) void shell.openExternal(url);
  });
}

export function hardenWindow(w: BrowserWindow) {
  const wc = w.webContents;
  wc.on('will-navigate', (ev, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) ev.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

export function webPreferences(partition?: string): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // the race must keep running (and sending its car state) when the window is not focused
    backgroundThrottling: false,
    spellcheck: false,
    partition,
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0b0820',
    title: 'RMR_race',
    autoHideMenuBar: true,
    show: false,
    webPreferences: webPreferences(),
  });
  hardenWindow(win);
  win.once('ready-to-show', () => win?.show());
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win?.setFullScreen(!win.isFullScreen());
  });
  win.on('closed', () => {
    win = null;
  });
  void win.loadURL(`${ORIGIN}/`);
}

// one copy per computer: a second one would fight over the LAN ports
if (!E2E && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // the game page: app:// files, no camera / microphone / geolocation permissions
    registerAppProtocolFor(session.defaultSession);
    registerIpc();
    // the LAN server starts with the app: needed to FIND rooms (UDP) as much as to host them
    await lan.start();
    if (E2E) {
      const { runE2E } = await import('./e2e');
      const code = await runE2E(ORIGIN);
      await lan.stop();
      app.exit(code);
      return;
    }
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  // close every room cleanly (players get "the host server was shut down") before quitting
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    lan.dispose();
    const done = () => app.exit(0);
    lan.stop().then(done, done);
    setTimeout(done, 2000);
  });

  app.on('window-all-closed', () => {
    if (!E2E) app.quit();
  });
}

process.on('uncaughtException', (e) => log.error('uncaught', e));
