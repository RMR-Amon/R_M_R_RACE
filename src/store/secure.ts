/**
 * Protected local storage.
 *
 * Nothing is written to localStorage in plain text: every value is obfuscated (XOR stream keyed by a
 * secret + base64) and sealed with a SHA-256 signature, and the storage key itself is a hash. A value
 * whose signature does not match (edited by hand in DevTools) is rejected and treated as missing.
 *
 * Note: this runs in the browser, so it stops casual tampering — it is not cryptographic secrecy.
 */

const SECRET = 'R_M_R_RACE::7f3c1e9a-save-seal::2026';
const VERSION = 'v2';

// ---------------------------------------------------------------- SHA-256 (sync, small)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const utf8 = (s: string) => new TextEncoder().encode(s);

export function sha256(input: string | Uint8Array): string {
  const msg = typeof input === 'string' ? utf8(input) : input;
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 9 + 63) >> 6) << 6));
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

// ---------------------------------------------------------------- obfuscation

/** keystream derived from the secret by chained SHA-256 blocks */
function keystream(len: number, salt: string) {
  const out = new Uint8Array(len);
  let block = sha256(SECRET + salt);
  let pos = 0;
  while (pos < len) {
    for (let i = 0; i < 64 && pos < len; i += 2) out[pos++] = parseInt(block.slice(i, i + 2), 16);
    block = sha256(block + SECRET);
  }
  return out;
}

function toB64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** opaque storage key for a logical name */
export const storageKey = (name: string) => 'rmr_' + sha256(SECRET + '::key::' + name).slice(0, 24);

function seal(name: string, json: string) {
  const plain = utf8(json);
  const ks = keystream(plain.length, name);
  for (let i = 0; i < plain.length; i++) plain[i] ^= ks[i];
  const body = toB64(plain);
  const sig = sha256(SECRET + '|' + name + '|' + VERSION + '|' + body);
  return `${VERSION}.${body}.${sig}`;
}

function unseal(name: string, raw: string): string | null {
  const [ver, body, sig] = raw.split('.');
  if (ver !== VERSION || !body || !sig) return null;
  if (sha256(SECRET + '|' + name + '|' + VERSION + '|' + body) !== sig) return null;
  const bytes = fromB64(body);
  const ks = keystream(bytes.length, name);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= ks[i];
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- public API

/** Reads a protected value; returns null if missing, unreadable or tampered with */
export function secureGet<T>(name: string): T | null {
  try {
    const raw = localStorage.getItem(storageKey(name));
    if (!raw) return null;
    const json = unseal(name, raw);
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

export function secureSet(name: string, value: unknown) {
  try {
    localStorage.setItem(storageKey(name), seal(name, JSON.stringify(value)));
  } catch {
    /* storage unavailable (private mode / quota) — keep the data in memory only */
  }
}

/** true when a value exists under the name but failed its signature check */
export function secureTampered(name: string): boolean {
  try {
    const raw = localStorage.getItem(storageKey(name));
    return !!raw && unseal(name, raw) === null;
  } catch {
    return false;
  }
}

/** One-time migration of an old plain-text entry into protected storage */
export function migratePlain<T>(legacyKey: string, name: string): T | null {
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return null;
    localStorage.removeItem(legacyKey);
    const value = JSON.parse(raw) as T;
    secureSet(name, value);
    return value;
  } catch {
    return null;
  }
}
