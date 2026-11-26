/** starts the Worker locally (wrangler dev = the real workerd runtime) for the tests, and stops it completely */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface LocalWorker {
  port: number;
  stop(): void;
  output(): string;
}

export async function startWorker(port: number, vars: Record<string, string> = {}): Promise<LocalWorker> {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'rmr-worker-'));
  const bin = path.join(dir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!fs.existsSync(bin)) throw new Error('run "npm install" in the cloudflare folder first');
  const args = [bin, 'dev', '--env', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(port + 1), '--persist-to', state, '--show-interactive-dev-session=false'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  let out = '';
  const proc: ChildProcess = spawn(process.execPath, args, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
  });
  proc.stdout!.on('data', (d) => (out += d));
  proc.stderr!.on('data', (d) => (out += d));
  let exited = false;
  proc.on('exit', () => (exited = true));
  const stop = () => {
    if (!exited && proc.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      else proc.kill('SIGTERM');
    }
    try {
      fs.rmSync(state, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* the OS still holds a file of the temporary folder */
    }
  };
  process.on('exit', stop);
  const end = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`wrangler stopped:\n${out}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > end) {
      stop();
      throw new Error(`worker did not start:\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { port, stop, output: () => out };
}
