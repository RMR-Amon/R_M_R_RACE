/**
 * Full screen on phones and tablets: hides the browser's address bar and buttons so only the game is visible.
 *
 * - Android, iPad, desktop browsers: Fullscreen API (needs a tap) + landscape lock where the browser allows it.
 * - iPhone Safari has no Fullscreen API for pages: the only way without browser borders is to add the site
 *   to the home screen; it then opens from its icon as an app (manifest.webmanifest, display: fullscreen).
 */
import { useEffect, useState } from 'react';

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (o?: FullscreenOptions) => Promise<void> | void };

const doc = () => (typeof document === 'undefined' ? null : (document as FsDoc));

export const isTouchDevice = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

/** Opened from the home-screen icon: there are no browser borders already */
export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const fullscreenSupported = () => {
  const d = doc();
  return !!d && !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
};

export const isFullscreen = () => {
  const d = doc();
  return !!d && !!(d.fullscreenElement || d.webkitFullscreenElement);
};

export async function enterFullscreen(): Promise<boolean> {
  const d = doc();
  if (!d || isFullscreen() || !fullscreenSupported()) return isFullscreen();
  const el = d.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else await el.webkitRequestFullscreen?.();
  } catch {
    return false;
  }
  try {
    // a racing game is played sideways; browsers that cannot lock simply refuse
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape');
  } catch {
    /* not allowed here: the player turns the phone */
  }
  return isFullscreen();
}

export async function exitFullscreen() {
  const d = doc();
  if (!d || !isFullscreen()) return;
  try {
    screen.orientation?.unlock?.();
  } catch {
    /* nothing locked */
  }
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    /* already left */
  }
}

/** Phones and tablets that are not already running as an installed app */
export const fullscreenUseful = () => isTouchDevice() && !isStandalone() && (fullscreenSupported() || isIOS());

export function useFullscreen() {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  return on;
}
