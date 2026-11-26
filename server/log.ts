/** tiny levelled logger (RMR_LOG=debug for verbose output, RMR_LOG=silent in tests) */
const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 } as const;
type Level = keyof typeof LEVELS;

// the same code also runs on Cloudflare Workers, where there is no process.env
const envLevel = ((typeof process !== 'undefined' && process.env?.RMR_LOG) || 'info') as Level;
let level: number = LEVELS[envLevel] ?? LEVELS.info;

export function setLogLevel(l: Level) {
  level = LEVELS[l];
}

const stamp = () => new Date().toISOString().slice(11, 19);

export const log = {
  error: (...a: unknown[]) => level >= 1 && console.error(stamp(), '✖', ...a),
  warn: (...a: unknown[]) => level >= 2 && console.warn(stamp(), '!', ...a),
  info: (...a: unknown[]) => level >= 3 && console.log(stamp(), '·', ...a),
  debug: (...a: unknown[]) => level >= 4 && console.log(stamp(), '…', ...a),
};
