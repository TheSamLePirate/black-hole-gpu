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

Unit: `tests/net-core.test.ts` (the samples, the clock under 200 ms and 5 % lost, the Hermite within a
centimetre, the smoothing, the bot's flight), `tests/net-rooms.test.ts` (a real server: rooms, limits,
passwords, a reconnection's slot, the owner's delete, the rooms kept across a restart). End to end:
`tests/e2e/net-rooms` (the solo page untouched, a room from the pause menu, a page by the link, the bot,
the clocks, leaving).
