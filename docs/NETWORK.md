# Playing together

*[Version française](NETWORK.fr.md)* — the plan and its rounds: [PLAN-RESEAU.md](PLAN-RESEAU.md); the
progress sheets: `docs/progress/reseau/`.

Two to four players in one world, spectators and instrument screens beside them. The solo game stays
whole: nothing connects until the player asks for a room, and the network's code (`net.js`, 13 KB) is
loaded only then.

## Rooms (R0)

- **Network — play together** (the pause menu, the wheel): a name and a colour; **Create a room** (a name
  and a password, both optional) or **Join** one by its code, as a pilot, a spectator or an instruments
  screen; **Your rooms**: the rooms this device knows, joined again in a click, deleted by their owner.
- **The room's link** (`#join=CODE`): the page opens straight into the game, the room joined.
- **The badge** beside the target's card: the room's code, its members, the round trip; amber when the
  link is lost (the game flies on, the link is tried again and the room taken back, the same slot).
- A room holds 8 devices, 4 of them pilots. It is kept on the server until its owner deletes it; its clock
  runs on while nobody is in it.
- **Settings › Network › Network menu** off: no trace of the network in the game.

## Flying together over the Earth (R1)

- **Each player flies his own craft** (the F-35, the Ranger, the Lander…, several of the same kind): the
  others' are drawn where they are — an F-35's surfaces, gear, nozzle and STOVL doors moving as its pilot's
  controls move them, its afterburner's flame, its engines' trails, its wingtips' threads and its vapour
  sheet pulling hard —, their name, craft and distance over them (an arrow at the edge when off screen), on
  the F-35's radar in their colour with their track and their height against ours.
- **Shown now**: carried from their last sample by their motion (velocity, acceleration, spin), a
  disagreement taken in smoothly — a wingman 25 m off flies 25 m off (a fifth of a second's delay would put
  him 50 m behind at 250 m/s).
- **Beside** (the room panel, each other pilot): your craft put off his right wing at his speed, his heading
  and his height — in formation; on the ground, parked beside him. `__bh.net.teleport(slot, gap?)`.
- **The room's time**: ×1 (real time) for everyone, a warp asked refused; joining sets the scene on the
  room's hour (the same Sun) when it is more than a minute off.
- **The direct links**: a WebRTC data channel to each other page — unordered, never resent —, set up through
  the room server, the samples straight (1–3 ms on one network), through the server while a peer is not
  reached; the room panel says how each one's samples come (direct, local · relayed · via the server).

Measured on kerr-mini (`tests/e2e/net-flight`, two pages): a direct local link, 1–3 ms; the two F-35s in
formation each see the other 27.6–27.7 m off; the leader's afterburner seen lit on the wingman's screen.

Not yet: collisions between players (R3, with the fights' damage), another's Ranger gear and lights (a
uniform of the flown craft's), the crafts of the players gone kept in the room's world (R7).

## How it works

- **The room server** (`server/rooms.ts`, Bun, SQLite): the rooms and their members, the clock, the room's
  events, the craft samples passed on. In production at `wss://stream.samlepirate.org/`
  ([DEPLOY.md](DEPLOY.md)); in dev and in the tests on the page's own server at `/net` (`#server=` picks
  another, `?prodnet` the production one from localhost).
- **The protocol** (`src/net/proto.ts`): JSON for the room's business, 104-byte binary samples for the
  craft (float64 position, velocity, attitude, spin, acceleration, what the craft shows: throttle,
  afterburner, gear, flaps, STOVL, the flight controls' commands, α, CL, Mach).
- **The clock** (`src/net/clock.ts`): NTP's exchange, the offset of the fastest eighth of the last 64
  exchanges; within a millisecond between two pages on one machine.
- **The others** (`src/net/remote.ts`): shown a little in the past — late enough for the next sample —, a
  Hermite spline between samples, carried on by their motion beyond the last one (then a ghost), a
  disagreement taken in smoothly.
- **The network lab**: `#netlab=latency,jitter,loss` (e.g. `100,20,0.05`) makes up a network on top of
  the link.
- **The bot** (`src/net/bot.ts`): `bun src/net/bot.ts --room CODE` joins a room and flies a circle over
  Edwards, 30 samples a second.

Measured on kerr-mini (two pages and the bot, `tests/e2e/net-rooms`): round trip 5–7 ms, the samples 5 ms
late (95 %: 27 ms), the others shown 60–75 ms late, the two pages' clocks within 0.3 ms.

## Tests

End to end too: `tests/e2e/net-flight` (two F-35s: seen 8 km off, on the radar, the direct link, Beside —
formation, the same gap seen by both —, the afterburner seen). Unit: `tests/net-core.test.ts` (the samples, the clock under 200 ms and 5 % lost, the Hermite within a
centimetre, the smoothing, the bot's flight), `tests/net-rooms.test.ts` (a real server: rooms, limits,
passwords, a reconnection's slot, the owner's delete, the rooms kept across a restart). End to end:
`tests/e2e/net-rooms` (the solo page untouched, a room from the pause menu, a page by the link, the bot,
the clocks, leaving).
