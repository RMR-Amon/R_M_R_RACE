import os from 'node:os';

export interface LanInterface {
  name: string;
  address: string;
  netmask: string;
  /** directed broadcast address of the subnet (e.g. 192.168.1.255) */
  broadcast: string;
}

const toInt = (ip: string) => ip.split('.').reduce((a, p) => ((a << 8) | (Number(p) & 255)) >>> 0, 0);
const toIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** IPv4 LAN interfaces of this machine (virtual adapters included — the OS routes per subnet) */
export function lanInterfaces(): LanInterface[] {
  const out: LanInterface[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = toInt(a.address);
      const mask = toInt(a.netmask);
      out.push({ name, address: a.address, netmask: a.netmask, broadcast: toIp((ip & mask) | (~mask >>> 0)) });
    }
  }
  return out;
}

/**
 * Only private / link-local / loopback addresses may talk to the host server: the game is a LAN
 * game, and this keeps it closed even if the machine is reachable from the internet.
 */
export function isLanAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr;
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (a === '::1') return true;
  if (a.includes(':')) {
    const h = a.toLowerCase();
    return h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
  }
  const p = a.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 169 && p[1] === 254) ||
    // carrier-grade NAT range used by some mobile hotspots
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
  );
}

export const plainIp = (addr: string | undefined) => (addr?.startsWith('::ffff:') ? addr.slice(7) : addr ?? '');
