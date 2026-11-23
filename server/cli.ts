/**
 * Command-line LAN host:   npm run server   (or npm start = build + server)
 * The desktop app (electron/main.ts) starts the same server in its main process instead.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_VERSION, NET, PROTOCOL_VERSION } from '../src/net/config';
import { startServer } from './index';
import { lanInterfaces, primaryAddress } from './netInfo';
import { log } from './log';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.RMR_PORT) || NET.HTTP_PORT;

startServer({ port, udpPort: Number(process.env.RMR_UDP) || NET.DISCOVERY_PORT, distDir: path.join(here, '..', 'dist') })
  .then((srv) => {
    const addrs = lanInterfaces();
    log.info(`RMR_race LAN host v${GAME_VERSION} (protocol ${PROTOCOL_VERSION}) — server id ${srv.sid}`);
    log.info(`On this computer:   http://localhost:${port}`);
    const main = primaryAddress();
    for (const a of addrs) log.info(`Other devices (${a.name}${a.address === main ? ', main' : ''}): http://${a.address}:${port}`);
    if (!addrs.length) log.warn('No LAN interface found — connect to a Wi-Fi / hotspot / Ethernet network.');
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      log.info('shutting down: closing rooms…');
      srv.close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') log.error(`Port ${port} is already in use — is RMR_race already running? (set RMR_PORT to use another port)`);
    else log.error(e);
    process.exit(1);
  });
