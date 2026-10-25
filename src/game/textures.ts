import * as THREE from 'three';
import type { ThemeId } from './types';
import { THEME_STYLES } from './themes';
import { makeRng } from './rng';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const cache = new Map<string, THREE.Texture>();

export function canvasTexture(key: string, w: number, h: number, draw: Draw, opts: { pixel?: boolean; repeat?: boolean } = {}) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  if (opts.pixel) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
  } else {
    tex.anisotropy = 8;
  }
  cache.set(key, tex);
  return tex;
}

export function disposeTextureCache() {
  cache.forEach((t) => t.dispose());
  cache.clear();
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, alpha: number, seed = 1, light = false) {
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${rng.range(0, alpha)})`;
    const s = rng.range(1, 3);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
}

/** Road texture: u across the road (0..1), v along (repeats every 10 m) */
export function roadTexture(theme: ThemeId) {
  const st = THEME_STYLES[theme];
  const pixel = theme === 'pixel';
  return canvasTexture('road-' + theme, pixel ? 64 : 512, pixel ? 32 : 256, (ctx, w, h) => {
    ctx.fillStyle = st.road;
    ctx.fillRect(0, 0, w, h);
    if (pixel) {
      const rng = makeRng(4);
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
          ctx.fillRect(x, y, 4, 4);
        }
      ctx.fillStyle = st.roadEdge;
      ctx.fillRect(1, 0, 2, h);
      ctx.fillRect(w - 3, 0, 2, h);
      ctx.fillStyle = st.roadLine;
      ctx.fillRect(w / 3 - 1, 0, 2, h / 2);
      ctx.fillRect((2 * w) / 3 - 1, 0, 2, h / 2);
      return;
    }
    noise(ctx, w, h, 9000, 0.25, 7);
    noise(ctx, w, h, 4000, 0.08, 9, true);
    if (theme === 'candy') {
      // chocolate tile grooves
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 4;
      for (let x = 0; x <= w; x += w / 6) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      for (let x = 3; x <= w; x += w / 6) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }
    // edge lines
    ctx.fillStyle = st.roadEdge;
    ctx.fillRect(w * 0.015, 0, w * 0.012, h);
    ctx.fillRect(w * 0.973, 0, w * 0.012, h);
    // dashed lane lines
    ctx.fillStyle = st.roadLine;
    for (const u of [1 / 3, 2 / 3]) ctx.fillRect(w * u - 3, 0, 6, h * 0.5);
    if (theme === 'ocean') {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#67e8f9';
      for (const u of [1 / 3, 2 / 3]) ctx.fillRect(w * u - 9, 0, 18, h * 0.5);
      ctx.globalAlpha = 1;
    }
  }, { pixel });
}

export function curbTexture(theme: ThemeId) {
  const st = THEME_STYLES[theme];
  return canvasTexture('curb-' + theme, 32, 64, (ctx, w, h) => {
    ctx.fillStyle = st.curbA;
    ctx.fillRect(0, 0, w, h / 2);
    ctx.fillStyle = st.curbB;
    ctx.fillRect(0, h / 2, w, h / 2);
  }, { pixel: true });
}

export function groundTexture(theme: ThemeId) {
  const st = THEME_STYLES[theme];
  const pixel = theme === 'pixel';
  return canvasTexture('ground-' + theme, pixel ? 32 : 256, pixel ? 32 : 256, (ctx, w, h) => {
    ctx.fillStyle = st.groundA;
    ctx.fillRect(0, 0, w, h);
    const rng = makeRng(13);
    if (pixel) {
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          ctx.fillStyle = rng.chance(0.35) ? st.groundB : rng.chance(0.15) ? '#7ad84e' : st.groundA;
          ctx.fillRect(x, y, 4, 4);
        }
      return;
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rng.chance(0.5) ? st.groundB : st.groundA;
      ctx.globalAlpha = rng.range(0.2, 0.7);
      const r = rng.range(2, 9);
      ctx.beginPath();
      ctx.arc(rng.range(0, w), rng.range(0, h), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (theme === 'desert' || theme === 'ocean') {
      // sand ripples
      ctx.strokeStyle = 'rgba(120,70,20,0.18)';
      ctx.lineWidth = 2;
      for (let y = 0; y < h; y += 14) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin((x / w) * Math.PI * 4 + y) * 4);
        ctx.stroke();
      }
    }
    if (theme === 'candy') {
      const cols = ['#ffffff', '#fde047', '#60a5fa', '#34d399', '#f87171', '#c084fc'];
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = rng.pick(cols);
        ctx.save();
        ctx.translate(rng.range(0, w), rng.range(0, h));
        ctx.rotate(rng.range(0, Math.PI));
        ctx.fillRect(-4, -1.2, 8, 2.4);
        ctx.restore();
      }
    }
    if (theme === 'city') {
      noise(ctx, w, h, 3000, 0.15, 21);
    }
  }, { pixel });
}

export function wallTexture(theme: ThemeId) {
  const st = THEME_STYLES[theme];
  const pixel = theme === 'pixel';
  return canvasTexture('wall-' + theme, pixel ? 32 : 128, pixel ? 16 : 64, (ctx, w, h) => {
    ctx.fillStyle = st.wallA;
    ctx.fillRect(0, 0, w, h);
    if (pixel) {
      // bricks
      ctx.fillStyle = st.wallB;
      for (let y = 0; y < h; y += 4) {
        ctx.fillRect(0, y + 3, w, 1);
        const off = (y / 4) % 2 ? 4 : 0;
        for (let x = off; x < w; x += 8) ctx.fillRect(x, y, 1, 3);
      }
      return;
    }
    if (theme === 'city' || theme === 'candy') {
      ctx.fillStyle = st.wallB;
      for (let x = -h; x < w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + 16, h);
        ctx.lineTo(x + 16 + h, 0);
        ctx.lineTo(x + h, 0);
        ctx.fill();
      }
    } else if (theme === 'desert') {
      ctx.fillStyle = st.wallB;
      for (let x = 0; x < w; x += 16) ctx.fillRect(x, 0, 3, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, h * 0.3, w, 3);
      ctx.fillRect(0, h * 0.7, w, 3);
    } else {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, st.wallA);
      g.addColorStop(0.5, st.wallB);
      g.addColorStop(1, st.wallA);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 600, 0.2, 5, true);
    }
  }, { pixel });
}

export function cliffTexture(theme: ThemeId) {
  const st = THEME_STYLES[theme];
  return canvasTexture('cliff-' + theme, 128, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, st.cliff);
    g.addColorStop(1, st.cliffDark);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const rng = makeRng(3);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.25)})`;
      ctx.fillRect(0, rng.range(0, h), w, rng.range(2, 8));
    }
    noise(ctx, w, h, 1500, 0.2, 8);
  }, { pixel: theme === 'pixel' });
}

export function itemBoxTexture() {
  return canvasTexture('itembox', 128, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#e5e5e5');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 10;
    ctx.font = '900 92px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText('?', w / 2, h / 2 + 4);
    ctx.fillText('?', w / 2, h / 2 + 4);
  }, { repeat: false });
}

export function boostTexture() {
  return canvasTexture('boost', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, '#ff7a00');
    g.addColorStop(1, '#ffe600');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(w * 0.12, h * 0.95);
    ctx.lineTo(w * 0.5, h * 0.55);
    ctx.lineTo(w * 0.88, h * 0.95);
    ctx.lineTo(w * 0.88, h * 0.7);
    ctx.lineTo(w * 0.5, h * 0.3);
    ctx.lineTo(w * 0.12, h * 0.7);
    ctx.closePath();
    ctx.fill();
  });
}

export function rampTexture() {
  return canvasTexture('ramp', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#facc15';
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 16, h);
      ctx.lineTo(x + 16 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.fill();
    }
  });
}

export function checkerTexture() {
  return canvasTexture('checker', 128, 32, (ctx, w, h) => {
    const s = 16;
    for (let y = 0; y < h; y += s)
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = (x / s + y / s) % 2 ? '#111' : '#fff';
        ctx.fillRect(x, y, s, s);
      }
  }, { pixel: true });
}

export function signTexture(text: string, bg: string, fg: string) {
  return canvasTexture('sign-' + text + bg, 256, 128, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const size = lines.length > 1 ? 42 : 50;
    ctx.font = `900 ${size}px Nunito, Arial, sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (size + 4)));
  }, { repeat: false });
}

export function bannerTexture(text: string, bg: string, fg: string) {
  return canvasTexture('banner-' + text + bg, 1024, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, bg);
    g.addColorStop(0.5, fg === '#ffffff' ? '#00000055' : bg);
    g.addColorStop(1, bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = '900 84px "Russo One", Nunito, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, { repeat: false });
}

export function windowsTexture(seed: number, lit: string) {
  return canvasTexture('windows-' + seed + lit, 64, 128, (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const rng = makeRng(seed);
    for (let y = 4; y < h; y += 8)
      for (let x = 4; x < w; x += 8) {
        if (rng.chance(0.55)) {
          ctx.fillStyle = rng.chance(0.75) ? lit : '#7dd3fc';
          ctx.globalAlpha = rng.range(0.5, 1);
          ctx.fillRect(x, y, 4, 5);
        }
      }
    ctx.globalAlpha = 1;
  }, { pixel: true });
}

export function swirlTexture(a: string, b: string) {
  return canvasTexture('swirl-' + a + b, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    ctx.translate(w / 2, h / 2);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let t = 0; t < 1; t += 0.05) ctx.lineTo(Math.cos(t * 4) * t * 64, Math.sin(t * 4) * t * 64);
      for (let t = 1; t > 0; t -= 0.05) ctx.lineTo(Math.cos(t * 4 + 0.5) * t * 64, Math.sin(t * 4 + 0.5) * t * 64);
      ctx.fill();
    }
  }, { repeat: false });
}

export function stripeTexture(a: string, b: string) {
  return canvasTexture('stripe-' + a + b, 64, 64, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    for (let x = -h; x < w + h; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + 16, h);
      ctx.lineTo(x + 16 + h, 0);
      ctx.lineTo(x + h, 0);
      ctx.fill();
    }
  });
}

export function softDotTexture() {
  return canvasTexture('softdot', 64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}
