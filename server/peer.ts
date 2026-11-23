import type { WebSocket } from 'ws';
import { NET } from '../src/net/config';
import type { ServerMsg } from '../src/net/protocol';
import { log } from './log';

/** token bucket: `rate` messages per second, bursts up to 2 s worth */
class Bucket {
  private tokens: number;
  constructor(private readonly rate: number) {
    this.tokens = rate * 2;
  }
  private last = performance.now();
  take(now: number): boolean {
    this.tokens = Math.min(this.rate * 2, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

let nextPeerId = 1;

/**
 * One WebSocket connection (a browser tab). It owns the socket-level concerns:
 * rate limiting, size limits, heartbeat bookkeeping and safe sending.
 */
export class Peer {
  readonly id = nextPeerId++;
  lastHeard = performance.now();
  /** server-measured round trip (WebSocket ping → pong), -1 until measured */
  rtt = -1;
  private pingSentAt = 0;
  private json = new Bucket(NET.RATE_JSON);
  private bin = new Bucket(NET.RATE_BINARY);
  /** consecutive rate-limit violations; a flooding client is disconnected */
  private floods = 0;
  closed = false;
  /** what this socket is used for (decided by the first message / the URL) */
  role: 'agent' | 'player' | 'pending' = 'pending';

  constructor(
    readonly ws: WebSocket,
    readonly ip: string,
  ) {
    ws.on('pong', () => {
      const now = performance.now();
      this.lastHeard = now;
      if (this.pingSentAt) this.rtt = Math.round(now - this.pingSentAt);
      this.pingSentAt = 0;
    });
  }

  /** returns false (and may drop the connection) when the message exceeds the rate limit */
  allow(binary: boolean, now: number): boolean {
    if (this.closed) return false;
    const ok = (binary ? this.bin : this.json).take(now);
    if (ok) {
      this.floods = Math.max(0, this.floods - 1);
      return true;
    }
    if (++this.floods > 200) {
      log.warn(`peer ${this.id} (${this.ip}) flooding — disconnected`);
      this.close(1008, 'rate limit');
    }
    return false;
  }

  send(msg: ServerMsg) {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** pre-serialised JSON (sent to many peers at once) */
  sendRaw(data: string | Uint8Array) {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    // a client that cannot keep up (e.g. Wi-Fi stalls) skips frames instead of buffering megabytes
    if (typeof data !== 'string' && this.ws.bufferedAmount > 64 * 1024) return;
    this.ws.send(data);
  }

  /** heartbeat, driven by the server tick */
  heartbeat(now: number) {
    if (now - this.lastHeard > NET.DEAD_AFTER_MS) {
      log.info(`peer ${this.id} (${this.ip}) timed out`);
      this.ws.terminate();
      return;
    }
    if (!this.pingSentAt) {
      this.pingSentAt = now;
      try {
        this.ws.ping();
      } catch {
        /* socket closing */
      }
    } else if (now - this.pingSentAt > NET.DEAD_AFTER_MS) this.pingSentAt = 0;
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason);
    } catch {
      this.ws.terminate();
    }
  }
}
