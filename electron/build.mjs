// Bundles the Electron main process (with the LAN server and the shared game code) and the preload.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', sourcemap: true, logLevel: 'info' };

await build({
  ...common,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  // electron is provided at runtime; ws' optional native speed-ups are not needed
  external: ['electron', 'bufferutil', 'utf-8-validate'],
});

await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', external: ['electron'] });
