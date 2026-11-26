/**
 * R_M_R Race online — Worker entry point.
 *
 *   GET /health              is the service up (and is the free quota left)?
 *   WS  /matchmaking         Quick Play queue, private rooms, online counter  → Matchmaker (one object)
 *   WS  /room/<32 hex>       one lobby + race                                  → GameRoom (one object per room)
 *
 * The Worker itself only checks the request and passes it on; it keeps no state.
 */
import { GAME_ID, GAME_VERSION, ONLINE_PROTOCOL } from '../../src/net/config';
import { errorCode, refuseSocket, settings, type Env } from './env';

export { GameRoom } from './gameRoom';
export { Matchmaker } from './matchmaker';

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

/** only the game's own website(s); requests without an Origin are not browsers and are refused */
export function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('origin');
    const allowed = originAllowed(origin, env);
    const socket = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
    const cfg = settings(env);

    // inspection for the automatic tests (DEBUG = 1 only)
    const dbg = cfg.debug ? /^\/debug\/(info|crash|rows)\/([0-9a-f]{32})$/.exec(url.pathname) : null;
    if (dbg) {
      try {
        if (dbg[1] === 'rows') return json(await env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).debugRows());
        return json(await env.ROOMS.get(env.ROOMS.idFromName(dbg[2])).debug(dbg[1] as 'info' | 'crash'));
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    if (!socket) {
      if (req.method !== 'GET') return json({ error: 'method' }, 405);
      if (url.pathname !== '/health' && url.pathname !== '/') return json({ error: 'notFound' }, 404);
      const cors: Record<string, string> = allowed ? { 'access-control-allow-origin': origin!, vary: 'origin' } : {};
      const simulate = cfg.debug && url.searchParams.has('simulateQuota');
      if (simulate) return json({ ok: false, error: 'SERVICE_LIMIT_REACHED' }, 503, cors);
      return json({ ok: true, game: GAME_ID, proto: ONLINE_PROTOCOL, version: GAME_VERSION, origin: allowed }, 200, cors);
    }

    if (!allowed) return refuseSocket('badOrigin');
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    try {
      if (cfg.debug && url.searchParams.has('simulateQuota')) throw new Error('Exceeded allowed duration in Durable Objects free tier.');
      const headers = new Headers(req.headers);
      headers.set('x-rmr-ip', ip);
      const inner = new Request(req, { headers });
      if (url.pathname === '/matchmaking') return await env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global')).fetch(inner);
      const m = /^\/room\/([0-9a-f]{32})$/.exec(url.pathname);
      if (m) return await env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(inner);
      return refuseSocket('roomNotFound');
    } catch (e) {
      // the daily Free limits of Durable Objects show up here: say so instead of just failing
      console.error('durable object error', e instanceof Error ? e.message : String(e));
      return refuseSocket(errorCode(e));
    }
  },
} satisfies ExportedHandler<Env>;
