/**
 * Starts the LAN server and proves that it works — shared by the command line (npm start) and the
 * optional desktop app.
 *
 *  - port fallback: 47800, then 47802 … 47810 (47801 is the UDP discovery port);
 *  - self check: HTTP, WebSocket, the LAN address and UDP broadcast are really exercised, so
 *    "running" is never reported for a server nobody can reach.
 */
import { WebSocket } from 'ws';
import { NET } from '../src/net/config';
import { startServer, type RunningServer, type ServerOptions } from './index';
import { log } from './log';
import { primaryAddress } from './netInfo';

export interface SelfCheck {
  /** the HTTP API answers with OUR server id */
  http: boolean;
  /** the WebSocket endpoint answers with OUR server id (no other program owns the port) */
  ws: boolean;
  /** the server answers on the LAN address the other players use (null: no network) */
  lan: boolean | null;
  lanAddress: string | null;
  /**
   * 'verified': our own broadcast came back on this computer (that other devices receive it depends
   * on their firewall and the Wi-Fi); 'open': the socket is bound, but the broadcast did not return
   */
  discovery: 'verified' | 'open' | 'failed';
  discoveryError: string | null;
}

async function apiSid(hostPort: string): Promise<string | null> {
  try {
    const res = await fetch(`http://${hostPort}/api/info`, { signal: AbortSignal.timeout(2500) });
    return ((await res.json()) as { sid?: string }).sid ?? null;
  } catch {
    return null;
  }
}

function wsSid(hostPort: string): Promise<string | null> {
  return new Promise((done) => {
    const ws = new WebSocket(`ws://${hostPort}/agent`);
    const finish = (sid: string | null) => {
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.close();
      done(sid);
    };
    const timer = setTimeout(() => finish(null), 2500);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'watch' })));
    ws.on('message', (d) => {
      try {
        finish((JSON.parse(d.toString()) as { self?: { sid?: string } }).self?.sid ?? null);
      } catch {
        finish(null);
      }
    });
    ws.on('error', () => finish(null));
  });
}

export async function selfCheck(srv: RunningServer): Promise<SelfCheck> {
  const local = `127.0.0.1:${srv.port}`;
  const lanAddress = primaryAddress();
  const [http, ws, lan, heard] = await Promise.all([
    apiSid(local),
    wsSid(local),
    lanAddress ? apiSid(`${lanAddress}:${srv.port}`) : Promise.resolve(null),
    srv.discovery.active ? srv.discovery.verify() : Promise.resolve(false),
  ]);
  return {
    http: http === srv.sid,
    ws: ws === srv.sid,
    lan: lanAddress ? lan === srv.sid : null,
    lanAddress,
    discovery: !srv.discovery.active ? 'failed' : heard ? 'verified' : 'open',
    discoveryError: srv.discovery.error,
  };
}

export interface Launched {
  srv: RunningServer;
  check: SelfCheck;
  /** the preferred port was not usable */
  fellBack: boolean;
}

/** `fixedPort`: the port was asked for explicitly — do not silently use another one */
export async function launchServer(opts: ServerOptions & { fixedPort?: boolean }): Promise<Launched> {
  const first = opts.port ?? NET.HTTP_PORT;
  const udp = opts.udpPort ?? NET.DISCOVERY_PORT;
  const ports = (opts.fixedPort ? [first] : [first, ...Array.from({ length: 9 }, (_, i) => first + 2 + i)]).filter((p) => p !== udp);
  let lastErr: unknown = new Error('no usable port');
  for (const port of ports) {
    let srv: RunningServer;
    try {
      srv = await startServer({ ...opts, port });
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code;
      // EACCES: Windows reserves port ranges (Hyper-V / WSL)
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e;
      log.debug(`port ${port} is not available (${code})`);
      continue;
    }
    const check = await selfCheck(srv);
    if (check.http && check.ws) return { srv, check, fellBack: port !== first };
    // we could bind it, but another program answers (or a firewall blocks even this computer)
    lastErr = new Error(`port ${port} could be opened but does not answer`);
    log.warn((lastErr as Error).message);
    await srv.close();
  }
  throw lastErr;
}
