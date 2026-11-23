/**
 * Player synchronisation helpers:
 *  - LocalSender: decides when the local car's state goes out (20 Hz while it changes,
 *    1 Hz keyframes while it stands still) and encodes it into one reused buffer;
 *  - RemoteBuffer: a ring buffer of snapshots per remote car, sampled INTERP_DELAY_MS in the
 *    past and blended between the two surrounding samples (short extrapolation on packet loss).
 * No objects are allocated per packet or per frame.
 */
import { NET } from './config';
import { F2_TELEPORT, STATE_BYTES, copyCarState, encodeState, newCarState, type CarState } from './protocol';

const TAU = Math.PI * 2;
const angDiff = (a: number, b: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export class LocalSender {
  private seq = 0;
  private lastSent = -1e9;
  private readonly last = newCarState();
  private readonly buf = new ArrayBuffer(STATE_BYTES);
  private readonly interval = 1000 / NET.CLIENT_SEND_HZ;
  /** packets sent (debug / tests) */
  sent = 0;

  /** returns the encoded frame when it is time to send one, otherwise null */
  /** schedule of the next regular send (drift-corrected, so 30–50 fps still give ~20 Hz) */
  private nextAt = -1e9;

  next(s: CarState, now: number): ArrayBuffer | null {
    if (now < this.nextAt) return null;
    // advance by whole intervals; after a long stall start over instead of bursting
    this.nextAt = now - this.nextAt > this.interval * 2 ? now + this.interval : this.nextAt + this.interval;
    const since = now - this.lastSent;
    const l = this.last;
    const changed =
      s.flags !== l.flags ||
      s.flags2 !== l.flags2 ||
      Math.abs(s.x - l.x) > 0.01 ||
      Math.abs(s.z - l.z) > 0.01 ||
      Math.abs(s.y - l.y) > 0.01 ||
      Math.abs(angDiff(l.heading, s.heading)) > 0.002 ||
      Math.abs(s.speed - l.speed) > 0.05 ||
      Math.abs(s.steer - l.steer) > 0.02 ||
      Math.abs(s.drift - l.drift) > 0.02 ||
      Math.abs(angDiff(l.spin, s.spin)) > 0.01;
    if (!changed && since < NET.KEYFRAME_MS) return null;
    copyCarState(l, s);
    this.lastSent = now;
    this.seq = (this.seq + 1) & 0xffff;
    this.sent++;
    return encodeState(this.buf, this.seq, s);
  }
}

const SIZE = 24;

export class RemoteBuffer {
  private readonly ring: CarState[] = Array.from({ length: SIZE }, newCarState);
  private head = -1;
  private count = 0;
  /** host time of the newest sample */
  newest = -Infinity;

  reset() {
    this.head = -1;
    this.count = 0;
    this.newest = -Infinity;
  }

  push(s: CarState) {
    // keyframes repeat the last sample with the same timestamp: nothing new
    if (s.t <= this.newest) return;
    this.head = (this.head + 1) % SIZE;
    copyCarState(this.ring[this.head], s);
    this.count = Math.min(SIZE, this.count + 1);
    this.newest = s.t;
  }

  private at(i: number) {
    // i = 0 → newest
    return this.ring[(this.head - i + SIZE * 2) % SIZE];
  }

  /** writes the state at host time `t` into `out`; false when nothing was received yet */
  sample(t: number, out: CarState): boolean {
    if (!this.count) return false;
    const newest = this.at(0);
    if (t >= newest.t) {
      // ran out of samples (packet loss / host hiccup): extrapolate a little along the velocity
      copyCarState(out, newest);
      const ex = Math.min(t - newest.t, NET.EXTRAPOLATE_MS) / 1000;
      out.x += newest.vx * ex;
      out.z += newest.vz * ex;
      return true;
    }
    for (let i = 1; i < this.count; i++) {
      const a = this.at(i);
      if (a.t > t) continue;
      const b = this.at(i - 1);
      // a respawn / correction is a jump, never a slide across the map
      if (b.flags2 & F2_TELEPORT) {
        copyCarState(out, a);
        return true;
      }
      const span = b.t - a.t;
      const k = span > 0 ? (t - a.t) / span : 1;
      blend(out, a, b, k);
      return true;
    }
    // older than everything buffered
    copyCarState(out, this.at(this.count - 1));
    return true;
  }
}

function blend(out: CarState, a: CarState, b: CarState, k: number) {
  out.t = a.t + (b.t - a.t) * k;
  out.x = a.x + (b.x - a.x) * k;
  out.y = a.y + (b.y - a.y) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.vx = a.vx + (b.vx - a.vx) * k;
  out.vy = a.vy + (b.vy - a.vy) * k;
  out.vz = a.vz + (b.vz - a.vz) * k;
  out.heading = a.heading + angDiff(a.heading, b.heading) * k;
  out.speed = a.speed + (b.speed - a.speed) * k;
  out.steer = a.steer + (b.steer - a.steer) * k;
  out.drift = a.drift + (b.drift - a.drift) * k;
  out.spin = a.spin + angDiff(a.spin, b.spin) * k;
  const near = k < 0.5 ? a : b;
  out.flags = near.flags;
  out.flags2 = near.flags2;
}
