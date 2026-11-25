import os from 'node:os';

export interface LanInterface {
  name: string;
  /** VM / VPN adapter: other players usually cannot reach this address */
  virtual?: boolean;
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

const VIRTUAL = /vethernet|virtualbox|vbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|hamachi|radmin|vpn|tap-|tun/i;
const PHYSICAL = /wi-?fi|wlan|wireless|беспровод|ethernet|eth\d|en\d|подключение по локальной сети/i;

/** how likely an interface is the real LAN (Wi-Fi / Ethernet) rather than a VM or VPN adapter */
function score(i: LanInterface): number {
  let s = 0;
  if (VIRTUAL.test(i.name)) s -= 100;
  if (PHYSICAL.test(i.name)) s += 20;
  if (i.address.startsWith('192.168.')) s += 10;
  else if (i.address.startsWith('10.')) s += 6;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)) s += 3;
  if (i.address.startsWith('169.254.')) s -= 50; // no DHCP lease
  return s;
}

let cache: { at: number; list: LanInterface[] } | null = null;

/**
 * Private-network interfaces sorted best-first (real Wi-Fi / Ethernet before VM and VPN adapters).
 * Cached for 2 s: asking Windows for the adapters is slow and the room list is pushed often.
 */
export function rankedInterfaces(): LanInterface[] {
  const now = Date.now();
  if (!cache || now - cache.at > 2000) {
    const list = lanInterfaces()
      .filter((i) => isLanAddress(i.address))
      .map((i) => ({ ...i, virtual: score(i) < 0 }))
      .sort((a, b) => score(b) - score(a));
    cache = { at: now, list };
  }
  return cache.list;
}

/** position of the interface whose subnet contains `addr` (Infinity when none does) */
export function subnetRank(addr: string): number {
  const ip = toInt(addr);
  const i = rankedInterfaces().findIndex((x) => ((ip & toInt(x.netmask)) >>> 0) === ((toInt(x.address) & toInt(x.netmask)) >>> 0));
  return i < 0 ? Infinity : i;
}

/** host names / addresses that can only mean a device on this network (never a public website) */
export function isLanHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return isLanAddress(h);
  // computer names ("my-pc") and the usual home-network suffixes
  return /^[a-z0-9-]+$/.test(h) || /\.(local|lan|home|internal)$/.test(h);
}

const hostName = (hostPort: string) => (hostPort.startsWith('[') ? hostPort.slice(0, hostPort.indexOf(']') + 1) : hostPort.split(':')[0]);

/**
 * Browsers always send `Origin` with WebSocket / cross-origin requests. Only pages that come from
 * the local network (a host server, the dev server) or from the desktop app may talk to us — a
 * random website must not be able to drive the LAN server through a visitor's browser.
 * No Origin header = a plain page load or not a browser.
 */
export function isLanOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  if (origin === 'app://rmr') return true;
  const m = /^http:\/\/([^/]+)$/.exec(origin);
  return !!m && isLanHost(hostName(m[1]));
}

/** the Host header must name this network too (blocks DNS rebinding) */
export const isLanHostHeader = (host: string | undefined) => !!host && isLanHost(hostName(host));

/** the address other computers should use to reach this one (null without a network) */
export function primaryAddress(): string | null {
  return rankedInterfaces()[0]?.address ?? null;
}
