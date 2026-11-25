// npm start — the one command for the organizer: checks → builds the game → starts the LAN server.
// Plain JavaScript without dependencies, so it can explain what is missing.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(1);
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 6)) fail(`Node.js 20.6 or newer is needed (this is ${process.versions.node}). Install it from https://nodejs.org`);

const bin = {
  tsc: 'node_modules/typescript/bin/tsc',
  vite: 'node_modules/vite/bin/vite.js',
  tsx: 'node_modules/tsx/dist/cli.mjs',
  ws: 'node_modules/ws/package.json',
  react: 'node_modules/react/package.json',
  three: 'node_modules/three/package.json',
};
const missing = Object.entries(bin).filter(([, f]) => !fs.existsSync(path.join(root, f)));
if (missing.length) fail(`Dependencies are not installed (${missing.map(([n]) => n).join(', ')}). Run "npm install" once (needs internet), then "npm start".`);
for (const f of ['index.html', 'server/cli.ts', 'src/main.tsx']) if (!fs.existsSync(path.join(root, f))) fail(`Project file is missing: ${f}`);

const run = (title, args) => {
  console.log(`  ${title}…`);
  const r = spawnSync(process.execPath, ['--no-deprecation', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    fail(`${title}: failed (see above)`);
  }
};
run('Checking the code', [bin.tsc, '--noEmit']);
run('Building the game', [bin.vite, 'build']);

// Ctrl+C reaches both processes; the server closes its rooms first, we just wait for it
process.on('SIGINT', () => {});
const server = spawn(process.execPath, ['--no-deprecation', '--import', 'tsx', 'server/cli.ts'], { cwd: root, stdio: 'inherit' });
server.on('exit', (code) => process.exit(code ?? 0));
