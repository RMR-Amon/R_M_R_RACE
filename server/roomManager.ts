import { GAME_VERSION } from '../src/net/config';
import type { Profile, RoomListing, RoomSettings } from '../src/net/protocol';
import type { Peer } from './peer';
import { Room, type Player } from './room';

/** most rooms one host server keeps at the same time */
const MAX_ROOMS = 16;

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(
    readonly sid: string,
    readonly port: number,
  ) {}

  create(peer: Peer, settings: RoomSettings, profile: Profile, now: number): { room: Room; player: Player } | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const room = new Room(this, settings);
    this.rooms.set(room.id, room);
    const player = room.addPlayer(peer, profile, now);
    return { room, player };
  }

  get(id: string) {
    return this.rooms.get(id);
  }

  removeRoom(room: Room) {
    this.rooms.delete(room.id);
  }

  listings(): RoomListing[] {
    return [...this.rooms.values()].map((r) => r.listing(this.sid, this.port, GAME_VERSION));
  }

  tick(now: number) {
    for (const r of [...this.rooms.values()]) r.tick(now);
  }

  closeAll(reason: 'shutdown') {
    for (const r of [...this.rooms.values()]) r.close(reason);
  }
}
