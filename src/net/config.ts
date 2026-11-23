/**
 * Network configuration shared by the browser client and the LAN host server.
 * Changing anything that affects the wire format requires bumping PROTOCOL_VERSION.
 */

/** unique game identifier: discovery packets from other software are ignored */
export const GAME_ID = 'RMR_race';
/** wire protocol version: hosts and clients with a different version do not see / join each other */
export const PROTOCOL_VERSION = 1;
/** shown in the room list */
export const GAME_VERSION = '1.1.0';

export const NET = {
  /** host server: HTTP (game files for phones / other PCs) + WebSocket on the same TCP port */
  HTTP_PORT: 47800,
  /** UDP port for LAN room discovery (broadcast) */
  DISCOVERY_PORT: 47801,

  /** a host announces its rooms this often */
  ANNOUNCE_MS: 1000,
  /** a room that was not heard from for this long is removed from the list (≈3 missed heartbeats) */
  ROOM_TIMEOUT_MS: 3500,
  /** how often the room list is pushed to a browser that watches it */
  ROOM_LIST_PUSH_MS: 1000,

  /** client → host car state rate while the car moves */
  CLIENT_SEND_HZ: 20,
  /** host → clients snapshot rate */
  SNAPSHOT_HZ: 20,
  /** a car that does not change still sends a keyframe this often (keeps the stream alive) */
  KEYFRAME_MS: 1000,
  /** remote cars are drawn this far in the past so there are always two snapshots to blend */
  INTERP_DELAY_MS: 110,
  /** when packets stop coming, remote cars are extrapolated for at most this long */
  EXTRAPOLATE_MS: 250,
  /** standings (laps / places / points) are pushed at most this often */
  STANDINGS_MIN_MS: 200,

  /** client ping / clock sync interval */
  PING_MS: 1000,
  /** a side that has not heard anything for this long treats the connection as dead */
  DEAD_AFTER_MS: 6000,
  /** a dropped player keeps their slot (and car) for this long, so they can reconnect */
  RECONNECT_GRACE_MS: 15000,
  /** the first message on a new socket must arrive within this time */
  HELLO_TIMEOUT_MS: 5000,

  /** largest message a client may send to the host */
  MAX_MESSAGE_BYTES: 4096,
  /** per-connection rate limits (messages per second, burst = 2 s worth) */
  RATE_JSON: 20,
  RATE_BINARY: 45,

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  /** the match does not start while somebody's ping is above this (ms) */
  MAX_START_PING: 300,
  /** every client must build the 3D scene within this time */
  LOAD_TIMEOUT_MS: 25000,
  /** time from "everybody loaded" to the green light (the 3-2-1 countdown) */
  COUNTDOWN_MS: 3600,
  /** after the winner finishes, the others have this long before they are marked DNF */
  FINISH_GRACE_MS: 30000,
  /** checkpoints per lap the server tracks */
  CHECKPOINTS: 8,
} as const;
