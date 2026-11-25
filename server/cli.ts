/**
 * Command-line LAN server:   npm start   (checks, builds the game, starts this)
 *                            npm run server   (without building)
 * The organizer runs it; everybody else only opens the printed LAN address in a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_VERSION, NET } from '../src/net/config';
import { launchServer } from './launch';
import { log, setLogLevel } from './log';
import { rankedInterfaces } from './netInfo';

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');

const portArg = process.env.RMR_PORT;
const port = portArg ? Number(portArg) : NET.HTTP_PORT;
const udpPort = process.env.RMR_UDP ? Number(process.env.RMR_UDP) : NET.DISCOVERY_PORT;
const validPort = (p: number) => Number.isInteger(p) && p >= 1 && p <= 65535;
if (!validPort(port) || !validPort(udpPort)) {
  log.error('RMR_PORT / RMR_UDP must be a port number (1–65535)');
  process.exit(1);
}
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  log.error('The game is not built yet. Run "npm start" (it builds the game) or "npm run build" first.');
  process.exit(1);
}
if (!process.env.RMR_LOG) setLogLevel('warn');

const line = (s = '') => console.log(s);

async function main() {
  const { srv, check, fellBack } = await launchServer({ port, udpPort, distDir, fixedPort: !!portArg });
  const ifaces = rankedInterfaces();
  const main = ifaces.find((i) => !i.virtual) ?? ifaces[0];

  line();
  line(`  R_M_R RACE LAN SERVER  v${GAME_VERSION}`);
  line();
  line('  Status:     RUNNING');
  if (fellBack) line(`              (port ${port} is busy — using ${srv.port}; give players the address below)`);
  line();
  line(`  Local:      http://localhost:${srv.port}        (this computer)`);
  if (main) {
    line(`  LAN:        http://${main.address}:${srv.port}   <- players open this   [${main.name}]`);
    if (check.lan === false) line('              ! this address does not answer even on this computer — check firewall / VPN software');
    for (const i of ifaces) if (i !== main) line(`  ${i.virtual ? 'Virtual:   ' : 'Also:      '} http://${i.address}:${srv.port}   [${i.name}]`);
  } else {
    line('  LAN:        NO NETWORK — connect to Wi-Fi, a hotspot or Ethernet (the address will be shown in the game)');
  }
  line();
  line(
    `  Discovery:  ${
      check.discovery === 'verified'
        ? `ACTIVE (UDP ${udpPort}; test broadcast sent and received on this computer)`
        : check.discovery === 'open'
          ? `UNSURE (UDP ${udpPort} is open, but the test broadcast did not come back — check firewall / network)`
          : `FAILED (${check.discoveryError ?? 'unknown'}) — other hosts' rooms are not found; joining by address still works`
    }`,
  );
  line('  WebSocket:  ACTIVE');
  line('  Players:    0');
  line();
  line('  Waiting for players…   (Ctrl+C stops the server)');
  line('  If Windows Firewall asks: allow Node.js on PRIVATE networks only.');
  line();

  // keep the organizer informed (only when something changes)
  let players = 0;
  let rooms = 0;
  let address = main?.address;
  const status = setInterval(() => {
    const p = srv.players();
    const r = srv.manager.rooms.size;
    if (p !== players || r !== rooms) {
      players = p;
      rooms = r;
      line(`  ${new Date().toLocaleTimeString()}  players: ${p}, rooms: ${r}`);
    }
    const now = rankedInterfaces();
    const a = (now.find((i) => !i.virtual) ?? now[0])?.address;
    if (a !== address) {
      address = a;
      line(a ? `  ${new Date().toLocaleTimeString()}  network changed — LAN address is now http://${a}:${srv.port}` : '  network lost');
    }
  }, 1000);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(status);
    line('  Stopping: telling the players and closing rooms…');
    const exit = () => process.exit(0);
    srv.close().then(exit, exit);
    setTimeout(exit, 2500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // closing the terminal window
  process.on('SIGHUP', stop);
}

main().catch((e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') log.error(portArg ? `Port ${port} is already in use.` : `Ports ${port}–${port + 10} are all in use.`);
  else log.error(`The LAN server could not start: ${e.message}`);
  process.exit(1);
});
