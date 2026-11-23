/**
 * Client connection to a host server: one WebSocket with
 *  - heartbeat: a ping every second, the connection counts as dead after DEAD_AFTER_MS of silence
 *    (switched-off Wi-Fi does not close a TCP socket by itself);
 *  - clock sync: every pong gives a (round trip, server time) sample, the sample with the smallest
 *    round trip wins, so `serverNow()` is accurate to a few milliseconds on a LAN;
 *  - automatic reconnection for RECONNECT_GRACE_MS with a "resume" hello (session token).
 */
import { NET } from './config';
import type { ClientMsg, ServerMsg } from './protocol';

export type ConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** why a connection ended for good */
export type CloseReason = 'unreachable' | 'lost' | 'normal';

export interface ConnHandlers {
  onJson(msg: ServerMsg): void;
  onBinary(view: DataView): void;
  onState(state: ConnState): void;
  onClosed(reason: CloseReason): void;
}

const BACKOFF = [250, 600, 1200, 2000, 2500];

export class Connection {
  state: ConnState = 'connecting';
  /** last measured round trip (ms), -1 until known */
  rtt = -1;
  private ws: WebSocket | null = null;
  private offset = 0;
  private samples: { rtt: number; off: number }[] = [];
  private lastHeard = 0;
  private timer = 0;
  private retryTimer = 0;
  private attempt = 0;
  private dropAt = 0;
  /** set once the server accepted us (only then is a dropped socket worth resuming) */
  private established = false;
  private ended = false;

  constructor(
    readonly url: string,
    private readonly h: ConnHandlers,
    /** first hello, and the hello used when reconnecting (null = cannot resume) */
    private readonly hello: (resume: boolean) => ClientMsg | null,
  ) {
    this.open();
    this.timer = window.setInterval(this.beat, NET.PING_MS);
  }

  /** the host accepted the session (welcome received) */
  markEstablished() {
    this.established = true;
    this.attempt = 0;
  }

  serverNow() {
    return performance.now() + this.offset;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(buf: ArrayBuffer) {
    const ws = this.ws;
    // never queue stale car states behind a stalled socket
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 16 * 1024) ws.send(buf);
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close(1000);
      } catch {
        /* ignore */
      }
    }
    this.setState('closed');
  }

  private setState(s: ConnState) {
    if (this.state === s) return;
    this.state = s;
    this.h.onState(s);
  }

  private open() {
    const resume = this.established;
    const hello = this.hello(resume);
    if (!hello) {
      this.finish(resume ? 'lost' : 'unreachable');
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.lastHeard = performance.now();
      ws.send(JSON.stringify(hello));
      this.ping();
    };
    ws.onmessage = (ev) => {
      this.lastHeard = performance.now();
      if (typeof ev.data === 'string') {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') this.onPong(msg.c, msg.s);
        if (msg.t === 'welcome') this.setState('open');
        this.h.onJson(msg);
      } else if (ev.data instanceof ArrayBuffer) {
        this.h.onBinary(new DataView(ev.data));
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.ended) return;
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* followed by onclose */
    };
  }

  private scheduleRetry() {
    if (this.ended) return;
    const now = performance.now();
    if (!this.established) {
      // a first connection gets a few quick tries (the host may still be starting)
      if (this.attempt >= 2) return this.finish('unreachable');
    } else {
      if (this.state !== 'reconnecting') this.dropAt = now;
      this.setState('reconnecting');
      if (now - this.dropAt > NET.RECONNECT_GRACE_MS) return this.finish('lost');
    }
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt++;
    this.retryTimer = window.setTimeout(() => this.open(), wait);
  }

  private finish(reason: CloseReason) {
    if (this.ended) return;
    this.close();
    this.h.onClosed(reason);
  }

  /** server-initiated end (kicked, room closed, fatal error): no reconnection */
  endQuietly() {
    this.close();
  }

  private beat = () => {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (performance.now() - this.lastHeard > NET.DEAD_AFTER_MS) {
      // silent socket (Wi-Fi off, host gone): drop it and go through the reconnect logic
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
      this.scheduleRetry();
      return;
    }
    this.ping();
  };

  private ping() {
    this.send({ t: 'ping', c: performance.now(), rtt: this.rtt });
  }

  private onPong(c: number, s: number) {
    const now = performance.now();
    const rtt = now - c;
    if (!(rtt >= 0) || rtt > 10000) return;
    this.rtt = Math.round(rtt);
    this.samples.push({ rtt, off: s + rtt / 2 - now });
    if (this.samples.length > 12) this.samples.shift();
    let best = this.samples[0];
    for (const x of this.samples) if (x.rtt < best.rtt) best = x;
    this.offset = best.off;
  }
}
