/**
 * Minimal QR code encoder (byte mode, error correction M, versions 1–6 = up to 106 bytes), enough
 * for "http://192.168.100.100:47800/" without adding a library.
 */

/** per version: [data codewords, EC codewords per block, blocks] for level M */
const SPEC: [number, number, number][] = [
  [16, 10, 1],
  [28, 16, 1],
  [44, 26, 1],
  [64, 18, 2],
  [86, 24, 2],
  [108, 16, 4],
];

// GF(256) tables
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function ecCodewords(data: number[], n: number): number[] {
  // generator polynomial
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    gen.forEach((g, k) => {
      next[k] ^= g;
      next[k + 1] ^= mul(g, EXP[i]);
    });
    gen = next;
  }
  const rem = [...data, ...new Array<number>(n).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const f = rem[i];
    if (f) gen.forEach((g, k) => (rem[i + k] ^= mul(g, f)));
  }
  return rem.slice(data.length);
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m: boolean[][]): number {
  const n = m.length;
  let p = 0;
  const lines: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  for (const l of lines) {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && l[i] === l[i - 1]) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    const s = l.map((b) => (b ? '1' : '0')).join('');
    for (let i = 0; i + 11 <= n; i++) {
      const w = s.slice(i, i + 11);
      if (w === '10111010000' || w === '00001011101') p += 40;
    }
  }
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) dark++;
      if (r && c && m[r][c] === m[r - 1][c] && m[r][c] === m[r][c - 1] && m[r][c] === m[r - 1][c - 1]) p += 3;
    }
  }
  return p + Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
}

/** QR modules (true = dark), without the quiet zone; null when the text is too long */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  const v = SPEC.findIndex(([data]) => bytes.length <= data - 2);
  if (v < 0) return null;
  const [dataLen, ecLen, blocks] = SPEC[v];

  // ---- data codewords: mode 0100, 8-bit length, bytes, terminator, padding
  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(4, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < dataLen; pad = pad === 0xec ? 0x11 : 0xec) data.push(pad);

  // ---- error correction, interleaved
  const per = dataLen / blocks;
  const d = Array.from({ length: blocks }, (_, i) => data.slice(i * per, (i + 1) * per));
  const e = d.map((b) => ecCodewords(b, ecLen));
  const words: number[] = [];
  for (let i = 0; i < per; i++) for (const b of d) words.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const b of e) words.push(b[i]);

  // ---- function patterns
  const n = 21 + v * 4;
  const m: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fixed: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const set = (r: number, c: number, on: boolean) => {
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    m[r][c] = on;
    fixed[r][c] = true;
  };
  for (const [fr, fc] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(fr + r, fc + c, ring !== 2 && ring <= 3);
      }
    }
  }
  if (v > 0) {
    const a = n - 7;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(a + r, a + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
  }
  for (let i = 8; i < n - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // format areas (filled per mask below)
  for (let i = 0; i < 9; i++) {
    if (!fixed[8][i]) set(8, i, false);
    if (!fixed[i][8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, n - 1 - i, false);
    set(n - 1 - i, 8, false);
  }
  set(n - 8, 8, true);

  // ---- data modules: two-column zigzag from the bottom right
  const stream = words.flatMap((w) => Array.from({ length: 8 }, (_, i) => ((w >> (7 - i)) & 1) === 1));
  let k = 0;
  let up = true;
  for (let right = n - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const r = up ? n - 1 - i : i;
      for (const c of [right, right - 1]) if (!fixed[r][c]) m[r][c] = stream[k++] ?? false;
    }
    up = !up;
  }

  // ---- best mask
  let best: boolean[][] | null = null;
  let bestP = Infinity;
  MASKS.forEach((f, mask) => {
    const t = m.map((row, r) => row.map((x, c) => (fixed[r][c] ? x : x !== f(r, c))));
    // format information: level M = 00, BCH(15,5)
    const info = mask;
    let rem = info << 10;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    const fmt = ((info << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((fmt >> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) t[i][8] = bit(i);
    t[7][8] = bit(6);
    t[8][8] = bit(7);
    t[8][7] = bit(8);
    for (let i = 9; i < 15; i++) t[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) t[8][n - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) t[n - 15 + i][8] = bit(i);
    t[n - 8][8] = true;
    const p = penalty(t);
    if (p < bestP) {
      bestP = p;
      best = t;
    }
  });
  return best;
}
