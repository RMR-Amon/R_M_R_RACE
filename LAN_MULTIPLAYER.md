# RMR_race — LAN Multiplayer

2–8 players on one local network (same Wi-Fi router or the same phone hotspot), without the internet and without any external server.

## Quick start

On the **host** computer (the one that creates the room):

```bash
npm install          # once
npm start            # builds the game and starts the LAN host server
```

The console prints the addresses:

```
On this computer:   http://localhost:47800
Other devices (Wi-Fi): http://192.168.1.20:47800
```

1. The host opens `http://localhost:47800` → **🌐 Multiplayer (LAN)** → **Create room**.
2. Other players on the same network:
   - **PC with the project:** run `npm start` and open `http://localhost:47800` → Multiplayer → **Find rooms**. The room appears automatically.
   - **Phone / tablet / PC without the project:** open the host's address in a browser (`http://192.168.1.20:47800`) → Multiplayer → Find rooms.
3. Players press **I'm ready**, and the host presses **Start**.

Ports: **TCP 47800** (game + WebSocket) and **UDP 47801** (room discovery). Change the TCP port with the `RMR_PORT` environment variable and the UDP port with `RMR_UDP`.

> **Windows:** on the first run Windows Firewall asks for permission for Node.js. Allow it for **private networks**. Otherwise other devices will not see the room.

## Why this architecture

The game runs in the browser (React + Three.js + Vite). Browsers **cannot** open UDP sockets or run a server, so a fully in-browser LAN game is impossible. The solution is a small Node.js host server (`server/`) that:

| Role | How |
|---|---|
| LAN discovery | UDP broadcast every second (heartbeat) to `255.255.255.255` and to the directed broadcast address of each interface; a timeout of 3.5 s removes dead rooms |
| Serving the game to phones | HTTP serves `dist/`, so devices without Node just open the address |
| Lobby and match | WebSocket (`ws`), `/play` path |
| Room list for the browser | WebSocket `/agent` (the browser cannot listen to UDP itself) |
| Validation | Uses **the same** `Track`, cars and grid from `src/` (run via `tsx`) |

Electron was not used: it would change how the game ships and starts, and it would not help phones. Node + `ws` adds one small dependency with no sub-dependencies.

### Host-Authoritative

- **Each client simulates its own car** (instant controls, the equivalent of client-side prediction) and sends its state at 20 Hz as a **35-byte binary packet**.
- **The host validates every packet**: maximum speed for that car (nitro, flight and boost pads included), distance moved per time step, staying on the road or arena, a client clock time budget (against speedhack), and duplicate or old packets. A rejected packet → `correct` → the client is put back at the last accepted position (server reconciliation).
- **Only the host decides** progress, checkpoints (8 per lap), laps, places, finish, battle points and coins. A client cannot "finish" or score points itself.
- **Item hits**: the victim reports the hit. The host checks that the shot exists, belongs to another player, has the right type and has not been counted yet. Using an item requires a real pass through a row of lucky blocks (checked by the host on the track).
- **Snapshots** (20 Hz) contain only the cars that changed. A standing car sends a keyframe once per second. Other players' cars are drawn with a 110 ms delay and **interpolated** between two snapshots (extrapolation of at most 250 ms if packets are lost).
- **Countdown and race timer** are synchronised with the host clock (the sample with the lowest round trip is used), so the green light comes at the same moment for everyone.
- The match ends **at the same moment for everyone**: when everybody has finished, 30 s after the winner, or when the battle time runs out.

### Disconnects

| Situation | Behaviour |
|---|---|
| Wi-Fi switched off / tab frozen | A heartbeat detects the silence within 6 s. The slot is kept for 15 s, others see 📡 "reconnecting" |
| Brief connection drop | The client reconnects automatically with a session token; in a race it continues where it was |
| Page reloaded | The token is in `sessionStorage`, so the room rejoins itself (including a running race) |
| Not back within 15 s | The player is removed and their car disappears |
| Player left the lobby | Removed immediately, everyone gets a notice |
| Host player left | **Host migration**: the player who has been in the room longest becomes host (the room keeps living on the host server) |
| Host closed the room / server stopped (Ctrl+C) | Everyone gets "The host closed the room" and returns to the menu |
| Host computer disappeared from the network | The reconnect fails after 15 s and players get "Connection lost" |

Moving the *server* to another computer is not possible: room state lives in the host's process, and transferring it in the middle of a race is not safe for match integrity. What migrates is the host *role* (control of the lobby).

### Security

Message size limit (4 KB) · rate limits (JSON 20/s, binary 45/s; a flood → disconnect) · protocol and game ID check · Player ID taken from the connection, never from the packet · increasing command numbers (replays are ignored) · sanitised names and settings · 4-digit code for private rooms with 30 s lock-out after 5 wrong attempts · 60 s ban after a kick · **only private / local IP addresses** are accepted · connection limits (96 total, 12 per IP) · path traversal protection on the static server.

## Project structure

```
server/                 LAN host server (Node, run with tsx)
  index.ts              HTTP + WebSocket + one 20 Hz loop, shutdown
  discovery.ts          LAN Discovery (UDP broadcast, heartbeat, timeout)
  roomManager.ts        Room Manager
  room.ts               Lobby Manager (players, host, kick, ready, reconnect)
  match.ts              Match Manager (validation, checkpoints, laps, results)
  peer.ts               Connection: rate limiting, heartbeat
  netInfo.ts            Interfaces, broadcast addresses, LAN IP filter
  gameData.ts           Game data (Track, cars) for the server
  static.ts             Serves dist/
  test/lanTest.ts       Automated end-to-end tests
src/net/                Network part of the client
  config.ts             Network Configuration (ports, rates, timeouts)
  protocol.ts           Network Protocol (types, binary codec, validators)
  connection.ts         Client Connection + Connection State (heartbeat, clock sync, reconnect)
  sync.ts               Player Synchronization (sending, interpolation)
  raceLink.ts           Bridge between the engine and the network
  session.ts            Session / lobby state for the UI, error handling
  lanService.ts         Room list, connect by IP
src/game/grid.ts        Grid positions (shared by client and server)
src/components/multiplayer/  MultiplayerMenu, Lobby, shared components
```

Network logic is separated from game logic: the engine (`src/game/engine.ts`) talks only to `RaceLink`. In single player `cfg.net` is absent and the old code paths work as before.

## Testing

### Automated (one machine)

```bash
npm run test:lan
```

It starts real host servers and scripted players (real WebSocket and UDP traffic). Result of the last run: **69/69 checks**.

| Area | What is checked |
|---|---|
| Discovery | Two hosts see each other over UDP; several rooms per host; a closed room disappears; a vanished host times out after ≈3.5 s; another protocol version is refused |
| Lobby | 8 players; the 9th gets "room full"; start is refused while players are not ready; only the host can start; command replay is ignored; kick (and no immediate return); leave; host migration; private code; sanitised settings |
| 8-player race | Shared green light; 20 Hz snapshots; everyone receives all 7 other cars; checkpoints; finish order matches the real driving; results for everyone; return to the lobby |
| Anti-cheat | Teleport → correction and no progress gain; impossible speed → correction |
| Items | Item without a pickup is not relayed; after a pickup it is; a second item from one pickup is refused; hit scored once; invented and self hits are not counted |
| Disconnects | Drop → others are notified; reconnect with the token in the middle of a race; removal after 15 s; expired token refused; late join refused; host closes the room; server shutdown |
| Robustness | Foreign game ID, oversized packets, no hello, flooding |
| Browser code | `src/net` session, clock sync, interpolation without jumps, a standing car sends only keyframes |

Load (8 players, 20 Hz): **≈7 KB/s download per client**. Host server CPU plus 8 scripted clients: **≈5–6% of one core**.

### Manual test on several devices

Preparation: everyone on the **same** Wi-Fi network; the host runs `npm start` and allows Node.js in the firewall.

| # | Scenario | Expected |
|---|---|---|
| 1 | Two PCs on one Wi-Fi: A creates a room, B → Find rooms | Room appears within 1–2 s, B joins, the race works |
| 2 | 5 devices (PCs + phones via `http://<host-ip>:47800`) | Everyone is in one lobby, ping < 60 ms, everyone sees each other in the race |
| 3 | 8 players in one room | The 9th gets "Room is full"; the race runs smoothly |
| 4 | Two hosts each create a room | Both rooms are in the list on all devices |
| 5 | A new player joins while the others are in the lobby | Everyone sees them immediately ("… joined") |
| 6 | A player presses Leave in the lobby | Disappears from everyone's list |
| 7 | A player switches Wi-Fi off during the race | Others see 📡 within ≤6 s; Wi-Fi back on within 15 s → the player continues; after 15 s → removed |
| 8 | Host closes the room / presses Ctrl+C on the server | Everyone gets a notice and returns to the menu |
| 9 | Reload the page during a race (F5) | The room and race rejoin automatically |
| 10 | Devices on **different** Wi-Fi networks | Rooms are **not** visible (broadcast does not cross routers) |
| 11 | Switch the internet off on the router (Wi-Fi stays on) | Everything works: no internet is needed |
| 12 | 8 players on the weakest devices | Steady FPS; on phones set graphics to "Low" |

**If rooms are not visible:** check that both devices are on the same network (not a guest network); that "AP / client isolation" is off in the router; that Node.js is allowed through the firewall (TCP 47800, UDP 47801); then try **Connect by IP** with the host address. If connecting by IP fails too, the network blocks traffic between devices.

## Known limitations

- **The Node server is needed on the host.** A plain web page cannot host a LAN game (browser restriction). Phones can join any room but can create a room only on the server of the PC they opened the game from.
- **Being on the same Wi-Fi does not guarantee visibility**: guest networks, AP isolation, corporate firewalls and some mesh systems block broadcast and traffic between clients. Connect by IP works when only UDP is blocked.
- Movement is **client-authoritative with host validation** rather than full physics on the server (the engine is tied to Three.js and the browser). Speed, teleport, off-road and time-budget cheats are blocked, but smaller deviations within physical limits are possible.
- Item hits are decided by **the victim's** client (the host only accepts real shots). Rarely, a missile may hit a car on one screen and miss it on another.
- Lucky blocks and barricades are not synchronised: each client shows them on its own.
- Online races have no AI opponents and no walk-in intro, and they cannot be paused.
- Host migration moves only the host **role**; if the host *computer* disappears, the session ends.
- There is no HTTPS (it is a LAN game). If the page is opened over https, the browser blocks `ws://`.
