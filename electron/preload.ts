/**
 * Preload (sandboxed, context-isolated): the ONLY bridge between the game page and Node.
 * The page gets a small, typed API — no `require`, no `ipcRenderer`, no file system.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { DesktopApi, DesktopLanInfo } from '../src/net/desktop';

const api: DesktopApi = {
  isDesktop: true,
  platform: process.platform,
  appVersion: String(ipcRenderer.sendSync('app:version')),
  lanInfo: () => ipcRenderer.invoke('lan:info'),
  startLan: () => ipcRenderer.invoke('lan:start'),
  stopLan: () => ipcRenderer.invoke('lan:stop'),
  onLanChanged: (cb) => {
    const handler = (_e: IpcRendererEvent, info: DesktopLanInfo) => cb(info);
    ipcRenderer.on('lan:changed', handler);
    return () => {
      ipcRenderer.removeListener('lan:changed', handler);
    };
  },
  openExternal: (url) => ipcRenderer.send('app:open', String(url)),
};

contextBridge.exposeInMainWorld('rmrDesktop', api);
