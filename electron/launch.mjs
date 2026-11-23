// Starts the desktop app from the project:  node electron/launch.mjs [--e2e]
// Clears ELECTRON_RUN_AS_NODE (set inside VS Code terminals, it would make Electron run as plain Node).
import { spawn } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const e2e = process.argv.includes('--e2e');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (e2e) {
  env.RMR_E2E = '1';
  env.RMR_E2E_OUT = env.RMR_E2E_OUT ?? path.resolve('e2e-shots');
}
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
const timer = e2e
  ? setTimeout(() => {
      console.error('[e2e] timed out');
      child.kill();
      process.exit(1);
    }, 300000)
  : null;
child.on('exit', (code) => {
  if (timer) clearTimeout(timer);
  process.exit(code ?? 1);
});
