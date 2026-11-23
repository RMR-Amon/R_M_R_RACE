/**
 * The desktop (Electron) bridge. The preload script exposes `window.rmrDesktop` through
 * contextBridge; in a normal browser it does not exist and the game runs without LAN hosting.
 */
import { useSyncExternalStore } from 'react';

export interface DesktopLanInfo {
  /** the LAN host server (HTTP + WebSocket + UDP discovery) is listening */
  running: boolean;
  /** TCP port of the server (game files, WebSocket) */
  port: number;
  /** UDP discovery port */
  udpPort: number;
  /** UDP discovery is working (false: port blocked / taken — use Connect by IP) */
  discovery: boolean;
  /** best LAN IPv4 address of this computer (Wi-Fi / Ethernet first), null without a network */
  primary: string | null;
  interfaces: { name: string; address: string }[];
  /** last start error (port in use, permission denied…) */
  error: string | null;
  version: string;
}

export interface DesktopApi {
  readonly isDesktop: true;
  readonly platform: string;
  readonly appVersion: string;
  lanInfo(): Promise<DesktopLanInfo>;
  startLan(): Promise<DesktopLanInfo>;
  stopLan(): Promise<DesktopLanInfo>;
  /** called whenever the server starts / stops / changes networks; returns an unsubscribe function */
  onLanChanged(cb: (info: DesktopLanInfo) => void): () => void;
  openExternal(url: string): void;
  /** the rmrrace:// link the app was started with (asked once, then cleared) */
  takeLaunchRoute(): Promise<LaunchRoute | null>;
  /** rmrrace:// links opened while the app is running */
  onRoute(cb: (route: LaunchRoute) => void): () => void;
}

/** where an rmrrace:// link should take the player */
export interface LaunchRoute {
  screen: 'lan';
  /** connect by IP to this host (rmrrace://join?host=…) */
  host?: string;
}

declare global {
  interface Window {
    rmrDesktop?: DesktopApi;
  }
}

export const desktopApi = (): DesktopApi | null => (typeof window !== 'undefined' && window.rmrDesktop?.isDesktop ? window.rmrDesktop : null);

// ---------------------------------------------------------------------------- reactive LAN info

let info: DesktopLanInfo | null = null;
const listeners = new Set<() => void>();
let started = false;

function set(next: DesktopLanInfo) {
  info = next;
  listeners.forEach((f) => f());
}

function ensure() {
  const api = desktopApi();
  if (!api || started) return;
  started = true;
  api.onLanChanged(set);
  void api.lanInfo().then(set);
}

/** current desktop LAN info (null in the browser or before the first answer) */
export function desktopLan(): DesktopLanInfo | null {
  ensure();
  return info;
}

export function subscribeDesktop(f: () => void) {
  ensure();
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export const useDesktopLan = () => useSyncExternalStore(subscribeDesktop, desktopLan, desktopLan);

/** waits for the first LAN info from the main process (desktop only) */
export function desktopLanReady(): Promise<DesktopLanInfo | null> {
  const api = desktopApi();
  if (!api) return Promise.resolve(null);
  ensure();
  return info ? Promise.resolve(info) : api.lanInfo().then((i) => (set(i), i));
}

/** the Windows installer of the latest GitHub release (the file name is the same in every release) */
export const INSTALLER_URL = 'https://github.com/RMR-Amon/R_M_R_RACE/releases/latest/download/RMR_Race_Setup.exe';
/** all releases (notes, portable build) */
export const RELEASES_URL = 'https://github.com/RMR-Amon/R_M_R_RACE/releases/latest';
/** opens the desktop app straight in LAN multiplayer (registered by the installer) */
export const DESKTOP_LAN_LINK = 'rmrrace://lan';

/** host for "connect by IP" handed over by a deep link (read once by the multiplayer screen) */
let joinHost: string | null = null;
export const setJoinHost = (h: string | null) => {
  joinHost = h;
};
export const takeJoinHost = () => {
  const h = joinHost;
  joinHost = null;
  return h;
};
