# Playing together

*[Version française](NETWORK.fr.md)* — the plan and its rounds: [PLAN-RESEAU.md](PLAN-RESEAU.md); the
progress sheets: `docs/progress/reseau/`.

Two to four players in one world, spectators and instrument screens beside them. The solo game stays
whole: nothing connects until the player asks for a room, and the network's code (`net.js`, 13 KB) is
loaded only then.

## Getting started

1. **Open the Network panel**: **Esc** (the pause menu) → **Network — play together**; or **hold Tab** (the
   wheel) → **Network**. (The panel can be hidden: Settings › Network.)
2. **Your name and colour** at the top of the panel.
3. **Create a room** (a name, a password, both optional) → its **six-letter code** shows, with **Copy the
   link**. Send the code or the link to the others.
4. **The others**: the same panel → **Join a room**, the code (and the password if any), the role — **Pilot**,
   **Spectator** or **Instruments**; or just open the link. A phone or a tablet: the **Screens** tab shows a **QR
   code** to scan.
5. **In a room**, the badge at the top left (● CODE · players · latency) opens the panel again: tabs **Crew**
   (Follow, Beside, volumes), **Match** (fights, races, landings), **Voice** (microphone), **Screens**.
6. **Leave the room** at the panel's foot; **Back to my craft** when you come back to a room.

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

Two Macs, the room server in production between them (`tests/e2e/net-formation`: the leader here, the wingman
on kerr-mini, both on the autopilot's 3000 m, 090°, 220 m/s, logs side by side by the room's time, 3 min):
- in calm air the gap stays 40.0–40.1 m (drift 4 cm): the two pages fly the same flight;
- in the light wind (its turbulence each craft's own) it opens from 40 to ~105 m in 3 min (≈50 m back, 35 m
  out) — as two real jets on their autopilots would: they hold the air's speed and a heading, not a place;
- whatever the gap, each page draws the other where he is to 2–5 cm (at most 9 cm).

Not yet: another's Ranger gear and lights (a
uniform of the flown craft's), the crafts of the players gone kept in the room's world (R7).

## Matches (R3)

- **A match** (the room panel, a pilot: the mode, what is flown, the rules — infinite ammunition,
  invulnerable, friendly fire, enemy missiles, the time, the kill limit): **everyone for himself**, **two teams**
  (blue and red, dealt in turn), **together against the aggressors** (the four fights), a **gate race**, a
  **landing contest**. An 8 s countdown on the room's clock, then each pilot put at his start: the arena's ring
  of 8 km over Rogers Dry Lake facing its middle, the teams abreast 15 km apart, the fight's start abreast,
  the race in echelon (60 m right, 40 m back), the landing in trail 2.5 km apart.
- **In the fight**: the others in your world where the network puts them — team-mates blue, never locked,
  never hurt unless friendly fire —; **your shots judged by you** (a hit on another sent to him, his damage
  his); the host's aggressors going after the nearest pilot, run on his world, sent to the others with their
  missiles; **every pilot's missiles sent** — drawn with their smoke, the missile warning when one chases you —;
  your countermeasures drawing the others' missiles too.
- **Shot down**: said to all (the kill feed: *Ben ✕ Ana · AIM-120*), the kill counted, back in the fight 5 s
  later on your place of the ring; a **mid-air collision** between two players destroys both (out of a match:
  no pause, back on the nearest runway 4 s later).
- **The HUD**: the hit marker (four ticks; a kill: thick and red), the score bar (the mode, the clock, the
  scores or the teams'), the big words (the countdown, *GO*, *shot down by … — back in 4 s*), the end's
  ranking; a newcomer told of the match running.

Measured on kerr-mini (`tests/e2e/net-battle`, `net-coop`): the AIM-120 fired at 15 km seen on the target's
helmet at 15 km, the kill on both score sheets; the host's drones on the guest's world within a metre; the
guest's AIM-9X downing one, the kill his on both; the racers 72 m apart at the start.

## The voices (R2)

- **Microphone on** (the room panel): the browser asks once; our voice sent on each direct link (WebRTC,
  Opus — echo cancelled, noise suppressed). It opens **by our voice** (the default, a threshold), **by a key
  held** (push to talk: the key chosen in the panel — no key of the flight's is free) or **always**.
- **Each other heard through a radio** from craft to craft: a headset's band, a little drive, a hiss while
  he speaks, the **Quindar tones** at the start (2 525 Hz) and the end (2 475 Hz) of each transmission, as
  Apollo's; the engines, the ambience and the score lowered under him (−8 dB); who speaks lit in the panel
  (◉) and on his name tag; each one's volume.
- **Two devices on one network are not heard** (they are in one room: an echo) — a checkbox to hear them.
- The relay (TURN) for the phones on 4G: the server's coturn, once turned on ([DEPLOY.md](DEPLOY.md)); STUN
  alone until then.

Measured on kerr-mini (`tests/e2e/net-voice`, two pages, a spoken phrase as each microphone): each one's
voice received by the other at −8 to −12 dBFS, shown speaking, two Quindar tones; the same network's muted.

## Following another, the screens added (R4)

- **Follow** (the room panel, each pilot): your craft becomes his puppet — placed where he is each frame,
  his kind, his surfaces, gear, nozzle and flame, his instruments (his telemetry four times a second: the
  fuel, the throttle, the gear, the flaps, the air brake) —, **every view** of the game on it (the cockpit and
  its panoramic display, the chase, the fly-by, the free one around him…); your own samples not sent.
- **A spectator** (the room link with `&role=spectator`, or the panel's role) follows the first pilot at once;
  **an instruments screen** (`&role=instruments`) too, in his cockpit.
- **The kill cam**: shot down in a match by another, his craft followed until you fly again.
- **Add a screen** (the room panel): the room's link as a **QR code** — a phone's or a tablet's camera opens it
  (over HTTPS: samlepirate.org) — as a spectator, an instruments screen or a pilot; the code is ours
  (`src/net/qr.ts`, byte mode, correction M, versions 1–10, checked module by module against Python's
  qrcode).

Measured on kerr-mini (`tests/e2e/net-spectate`): the followed craft within 1–11 m of where its pilot has it
(read 0.1 s apart), its gear posed from his, the F-35's HUD and cockpit; the pilot sees nobody.

Not yet: the spectator's free-fall prediction ("IMPACT …") is his own craft's (no lift), not the pilot's;
the instruments' route and autopilot modes are the pilot's own only on his screen.

## On foot together (R5)

- **Walking** (⇧K out of a landed craft, or the On foot mode): the others see your astronaut — the real one,
  his skinned body, his gait (walk, run, the turn, a jump) from your speed —, where you walk on the Earth, your
  name over his head ("on foot"); your parked craft is seen too. Samples 15 times a second, his place and
  speed predicted to now as the craft are.
- **Board a friend's craft** (⇧K on foot by another's landed craft — within 4 m of either door, or 2 m of its
  hull): you ride in it as his **passenger** — his craft yours to see from every view, his instruments, his
  flight; the pilot is told ("Ben is aboard"), the room panel and his name tag say so. Your own craft is left
  parked where it was.
- **Get off** (⇧K once his craft is landed and still): on foot at its right-hand door, its nose ahead; your
  own craft back where you left it (to the decimetre).
- The others' craft are placed from your camera wherever it is — on foot 14 km from your own craft, the one
  beside you stands beside you.
- **On the Moon, on Mars** too: a craft landed there is sent fixed to that ground (not coasting: it no longer
  drifts on the others' screens), its astronaut walks there.
- **Beside** a player on foot: you on foot beside him (2.5 m to his right, facing as he does), your craft
  parked by his if it stands on that ground.

Measured on kerr-mini (`tests/e2e/net-walk`): two astronauts 12 m apart on Edwards' apron, each seen by the
other at the right distance; one walks 3 s — seen moving at 1.1–1.3 m/s; he boards the other's F-35 (his view
on it within 0.1 m, landed: no false lift-off called), gets off 8 m from it, his own F-35 back 14 km away
within 0.1 m.

Not yet: with the grass turned off, the others on foot are drawn only while you walk too; a passenger's
seat is the pilot's view (no second seat modelled).

## Together in space (R6)

- **The room's warp**: each pilot's warp is his vote; the room runs at the slowest asked. A slowdown is at once
  for everyone (dated when its pilot slowed); a speed-up waits until every pilot asks for it — "×100 asked —
  waiting for Ben" in the time bar, "Ana asks for ×100 — warp up to accept" on Ben's (warping up accepts it);
  then it starts at one instant for all. A pause pauses the room ("paused by Ana"); an empty room runs on at ×1.
- **One clock**: each scene is kept on the room's (eased from half to twice the pace, set on it at once if a tab
  was put aside); the samples carry their sender's scene time and are read at the reader's — a clock a little off
  misplaces nobody.
- **In orbit**: above 100 km (or out of the Earth's sphere) a craft is sent in the inertial frame of the body
  whose sphere it is in; coasting (no thrust) it is carried along its orbit (Kepler, plus the pulls besides the
  body's centre its pilot measures — the Earth's flattening, the Moon, the Sun —) between its samples, 1 to 30 a
  second as the warp runs faster, one at once when it leaves the orbit the others carry it on.
- **Seen**: drawn within 60 km, beyond a tag with the distance (thousands of km); **targets** (Tab, the map, a
  click): the HUD's distance and closing rate, the lock, the rendezvous, the 3D map with each one's orbit;
  **Beside** works in orbit (200 m off the wing, at the same velocity).

Measured on kerr-mini (`tests/e2e/net-space`): two Rangers 200 m apart in a 400 km orbit; Ana's ×100 held at
×1 until Ben accepts, then 500 s of the scene at ×100 — both scenes within 0.1 s of the room's clock, the
formation kept (169 m); Ben slows to ×10 then ×1: at once for both, both within 1 s; Ben targeted: the HUD's
168 m = the view's; a quarter orbit away: a marker 6 400 km off.

Not yet: a pace following the proper time (Gargantua's dilation: R8); a date change in a room.

## Docking together, the persistent world (R7)

- **Docking to another's craft**: target him (Tab, the map), fly in on the docking HUD or engage **DOCK** (B):
  the autopilot brings you onto his free port as onto the station's. At the capture the lighter craft latches
  onto the heavier (at one mass the later comer): it is **held** by his — its place his composed with the
  ports', its cameras and screens kept —; he flies the assembly and sees you on his port, rigid. **UNDOCK** (or
  a push): the springs part you at 5 cm/s.
- **Contacts**: a craft striking another's hull bounces off it; the other gets its share of the blow (by their
  masses). (The mid-air collisions of the fights stay in the Earth's air.)
- **The persistent world**: the room keeps each one's craft as he left it — parked where it stood, or on its
  orbit (carried on by Kepler): the others see it ("Ana (away)"), target it, dock to it. Back in the room,
  **Back to my craft** (the room panel) puts you on it where it is now.

Measured on kerr-mini (`tests/e2e/net-dock`): Ben's Ranger drifting at 15 cm/s onto Ana's Endurance's fore hub:
latched, held within a millimetre of where her craft carries him, seen on her hub (14.7 m from her centre);
Ana moved 1 km: Ben with her (1.5 cm); undocked: 0.2 m apart 4 s on; the DOCK autopilot from 25 m to the
capture; off the axis at 0.5 m/s: "Contact with Ana's Endurance · 0.42 m/s", her share received; Ana gone:
her Endurance on its orbit, Ben docks to it; Ana back on it, 3.6 m from Ben.

Not yet: a shared free craft (the room's own Endurance) with leases; the assembly's mass for the host; a
remote Ranger's gear and lamps.

## By Gargantua (R8)

- **On Gargantua's side** each craft is sent on the hole's map (Boyer–Lindquist's flat map, its coordinate
  velocity); the others near yours are brought into your camera's rest frame — drawn, tagged, **Beside** works
  there too (in orbit about Miller at a third of the speed of light, 200 m off a wing).
- **Through the wormhole**: those on the other side are tagged on its mouth ("by Gargantua — through the
  wormhole", "in our solar system — through the wormhole").
- **One clock** for the room — its coordinate time —: by Miller your proper time runs slower, and your tag says so
  to the others (τ ×0.85 in a 400 km orbit about Miller).

Measured on kerr-mini (`tests/e2e/net-gargantua`): two Rangers about Miller, each seen 206 m from the other; Ben
back by the Earth: Ana tagged on the mouth with her clock's rate.

Not yet: the markers bent by the lens far off (they point straight); a remote Ranger's gear and lamps.

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

End to end too: `tests/e2e/net-gargantua` (by Gargantua, through the wormhole), `tests/e2e/net-dock` (docking together, contacts, the persistent world), `tests/e2e/net-space` (in orbit together, the room's warp, targets), `tests/e2e/net-walk` (on foot together, a passenger's ride), `tests/e2e/net-moon` (on foot on the Moon, Beside on foot), `tests/e2e/net-formation` (two Macs in formation, the drift), `tests/e2e/net-flight` (two F-35s: seen 8 km off, on the radar, the direct link, Beside —
formation, the same gap seen by both —, the afterburner seen). Unit: `tests/net-core.test.ts` (the samples, the clock under 200 ms and 5 % lost, the Hermite within a
centimetre, the smoothing, the bot's flight), `tests/net-rooms.test.ts` (a real server: rooms, limits,
passwords, a reconnection's slot, the owner's delete, the rooms kept across a restart). End to end:
`tests/e2e/net-rooms` (the solo page untouched, a room from the pause menu, a page by the link, the bot,
the clocks, leaving).
