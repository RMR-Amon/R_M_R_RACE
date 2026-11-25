/**
 * Controls the LAN host server inside the desktop app's main process: start (with a port fallback
 * if 47800 is taken), stop (closes every room and tells the players), status for the UI, and
 * network changes (Wi-Fi switched / new IP).
 */
import { NET, GAME_VERSION } from '../src/net/config';
import type { DesktopLanInfo } from '../src/net/desktop';
import type { RunningServer } from '../server/index';
import { launchServer } from '../server/launch';
import { primaryAddress, rankedInterfaces } from '../server/netInfo';
import { log } from '../server/log';

export class LanController {
  private srv: RunningServer | null = null;
  private starting: Promise<DesktopLanInfo> | null = null;
  private error: string | null = null;
  private lastKey = '';
  private watch: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly distDir: string,
    private readonly onChange: (info: DesktopLanInfo) => void,
  ) {}

  info(): DesktopLanInfo {
    const srv = this.srv;
    return {
      running: !!srv,
      port: srv?.port ?? NET.HTTP_PORT,
      udpPort: NET.DISCOVERY_PORT,
      discovery: !!srv && srv.discovery.active,
      primary: primaryAddress(),
      interfaces: rankedInterfaces().map((i) => ({ name: i.name, address: i.address })),
      error: this.error,
      version: GAME_VERSION,
    };
  }

  start(): Promise<DesktopLanInfo> {
    if (this.srv) return Promise.resolve(this.info());
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        this.srv = (await launchServer({ port: NET.HTTP_PORT, udpPort: NET.DISCOVERY_PORT, distDir: this.distDir })).srv;
        this.error = null;
      } catch (e) {
        this.error = String((e as Error)?.message ?? e);
      }
      if (this.srv) log.info(`desktop LAN server on port ${this.srv.port}, LAN address ${primaryAddress() ?? 'none'}`);
      else log.error(`desktop LAN server failed: ${this.error}`);
      this.starting = null;
      this.emit();
      this.watchNetwork();
      return this.info();
    })();
    return this.starting;
  }

  async stop(): Promise<DesktopLanInfo> {
    if (this.starting) await this.starting;
    const srv = this.srv;
    this.srv = null;
    if (srv) {
      // rooms get "closed: shutdown" before the sockets go away
      await srv.close();
      log.info('desktop LAN server stopped');
    }
    this.emit();
    return this.info();
  }

  dispose() {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
  }

  private emit() {
    const i = this.info();
    this.lastKey = JSON.stringify([i.running, i.port, i.discovery, i.primary, i.interfaces, i.error]);
    this.onChange(i);
  }

  /** Wi-Fi reconnects / network switches change the address shown to the other players */
  private watchNetwork() {
    if (this.watch) return;
    this.watch = setInterval(() => {
      const i = this.info();
      const key = JSON.stringify([i.running, i.port, i.discovery, i.primary, i.interfaces, i.error]);
      if (key !== this.lastKey) this.emit();
    }, 5000);
  }
}
