# The camera — free flight, voyages, views about any craft

(Français : [CAMERA.fr.md](CAMERA.fr.md). The plan and its measures: [PLAN-CAMERA-AAA.md](PLAN-CAMERA-AAA.md).)

## The free camera

- **F3** takes the view out of the craft you fly (it flies on); **F1** back aboard, the look kept (no snap).
- **Speed by the surface**: in free flight the camera's speed is proportional to its height over the nearest
  world — every world counted at once (a soft minimum), so nothing jumps when the nearest one changes. The
  wheel and the camera panel's slider set the factor, one range for both (× 1/16 … × 32).
- The orbit keys about a target ease in and out (a tenth of a second), and the lens zooms on a critically damped
  spring: no zoom starts or stops in a single frame.

## The voyage — G

Pick a target (the map, the target list, a click on a world), then **G** in the free camera. **G** again stops
the voyage where it is, at rest with what it is near. **Space** pauses it like the rest of the world.

- **The relativistic rocket**: a constant proper acceleration up to midway, the same deceleration after. It is
  slowed near any world (speed ≤ k × the height over its surface): relativistic in the void, gentle by a planet.
  The departure and the arrival are eased in and out, never a full stop in one frame.
- **The pace** (camera panel › Voyage): *by the trip* (the default: 10⁵ g capped at 0.999 c — a few % of c to
  the Moon, ~0.93 c to Mars, ~0.99 c to Saturn), or a peak **speed**, a **duration** on your clock τ or on the
  world's clock t, or an **acceleration**.
- **Two clocks**: the world advances by the coordinate time t (the planets have moved on when you arrive); the
  voyage card shows t, your proper time τ, the gap t − τ, β, γ and the acceleration.
- **Playback**: about 20 s on screen (*playback* in the panel): real time by a world, the time warp rising in
  the void so that you cross your own height at the same pace a second all the way.
- **The look is yours**: drag to look around during the voyage — ahead the sky crowds and turns blue, behind it
  thins and reddens (aberration, Doppler, the searchlight effect). The look comes back onto the goal's framing
  over the last two seconds.
- **The path never crosses a world**: it spirals out of the world you leave and into the one you reach; moving
  goals (a moon, the ISS) are met where they will be.
- **Who travels** (panel): the **observer** (the free camera; the craft flies on), or the **craft itself** — its
  crew's clock advances by τ and its mission goes on.

## The cinematic voyage — ⇧G

The same voyage filmed: a low pass over the world you leave (900 m over the ground with the relief anticipated —
250 km over a gas giant —, towards the day side), the voyage, a low pass over the world you reach, then up to its
framing. Two cuts (panel › Voyage › *cinematic*):

- **sequence**: one continuous shot;
- **montage**: cuts — looking back at the world left, then ahead along the speed, then on the goal.

## Through the wormhole

Gargantua's worlds and the hole lie beyond the wormhole. A voyage there from our side goes by itself: a voyage to
our mouth, **down its throat** (a relativistic voyage too, along the throat's own coordinate ℓ, slowed in the throat
itself so the crossing is seen), out of the far mouth, then on to the goal. And back the same way. The **wormhole**
target alone takes you to the mouth on your side.

**An itinerary**: `__bh.tour(["saturn", "wormhole", "hole"])` voyages to each stop in turn, a pause at each — from
the Earth: Saturn, the wormhole, down its throat, Gargantua.

## The camera on any craft

Target a craft — the fleet's, the ISS, an airliner of the traffic, a ship at sea, a wingman, another player's —
and pick its view in the camera panel:

| tile | the view |
|---|---|
| **Around** | the orbit about it (drag, wheel = distance) |
| **Chase** | behind it and a little above, its turns followed with a lag (wheel = distance, drag swings round it) |
| **Cockpit** | at its post — the cockpit, the bridge —, looking along its nose (drag turns the head) |
| **Tower** | set down ahead of its way — on the ground, or in space moving with it —, turning to follow it, the lens drawn in on it; set down again ahead once it is past and far |

Choosing one of these views stops the free camera following your own craft. The craft followed has its ground held by the world
as your own has (PLAN-J2 J2-2, 12 Nov 2026): an airliner of the traffic parked or rolling, seen from 3 km, stands on the same ground as
seen from 60 m (`earthTiles.setAnchors`, `renderer.subjectFocus` — with no craft flown too, since 24 Nov 2026).

## The traffic about the camera

The real aircraft and ships (and the sea's own life, the carriers) live about the **traffic's focus**
(`src/traffic/focus.ts`, Sam's request of 24 Nov 2026: always on, even in the free camera with no craft): the craft
you fly, else the view's own eye — the free camera with no craft at all, a spectator gone 60 km or more from the craft
(the craft again under 40 km), the camera following an airliner or a ship, a tour, a tripod. They are asked of the relay
about it, flown a minute behind on their paths, drawn, labelled (their lights, their names) from the view and can be
followed with the views above — whether a craft is flown or not.

- **Hysteresis**: the place asked moves only once the focus has gone a quarter of its radius (30 km low down) — a free
  camera flown fast does not ask anew each frame —; a jump of half its radius or more (a teleport, a voyage) is asked at
  once, within the sources' pace (air 10 s, sea 5 s); what lies beyond 1.6 radii is let go.
- **Radius by height**: the air 120 km low down, up to 160 km from 15 km up (the lights then seen as far as 128 km); the
  sea 60 km up to 90 km (the relay serves 250 km at most).
- **Off**: the setting (Settings › Real traffic), the page offline, far from the Earth (the view's own focus above 160 km, on
  again under 140 km), and under the title screen — its scene is no flight and its menus cover the labels; the relay's and
  its sources' quotas are kept for play.
- `__bh.trafficFocus()` — [BH-API.md](BH-API.md).

## The airport view

An airport chosen (the camera panel › Airport, or `__bh.airport.start("KLAX")` or the title screen’s Airport card): its real
arrivals and departures, one after the other, filmed by a director — **Director** (Auto: a landing from the tower, behind it, under
it at the threshold, its touchdown from the runway's side; a take-off from the tower, its rotation from the runway's side, under its
climb-out), or one shot held: Tower, Threshold, Runway side, Rotation, Climb-out, Chase, Cockpit, Drone. The game's HUD and panels
are hidden (the top bar stays, toggled as ever); a panel at the right lists the **arrivals**, the **departures** and the aircraft
**about the airport** — one clicked is followed (clicked again: the director chooses again) and its card shown —; a broadcast
caption at the bottom left names the one filmed, its runway and its seconds to touchdown or lift-off. The game's clock is set to
the moment the live traffic is drawn at: the light is the place's own. **Its radio** (`src/traffic/atc.ts`): the tower and the crews
talk over each movement — the final's call and « cleared to land », « line up and wait », « cleared for takeoff », the hand-offs to Ground
and Departure — in ICAO English, through the radio's band (Settings › Voices on); the last lines on the panel. docs/PLAN-AEROPORT-AAA.md.

The panel shows real airport weather and its METAR. Airport mode uses that weather for aircraft attitudes
and restores your previous weather selection on exit. Observed flights have priority; inferred segments
are labelled Reconstructed and supplemental aircraft Synthetic. The Supplemental traffic button enables
mapped pushback/taxi/holding/departure activity when a connected route and a free runway are available.
Without a known network, ground routes are not invented. Aircraft hulls and obstacles hide their lamps.

## Keys

| key | in the free camera (F3) |
|---|---|
| G | voyage to the target · again: stop |
| ⇧G | the cinematic voyage |
| F1 / F3 | back aboard / out |
| wheel | the speed (flying), the distance (orbit, chase) |
| drag | look around (also during a voyage) |
| Space | pause |

Aboard a craft, **G** stays the landing gear.

## For tests and tools

- `__bh.goTo(target)`, `__bh.tour(stops, hold?)`, `__bh.touring()`, `__bh.voyage()` (the voyage's figures),
  `__bh.cam` (the smoothness sensor: jumps, snapped aims, fov jumps, speed breaks) — [BH-API.md](BH-API.md).
- e2e: `camera-smooth` (14 situations through the sensor), `camera-voyage`, `camera-subject`, `traffic-free-camera` (the
  traffic about a free camera with no craft) —
  [E2E-CATALOGUE.md](E2E-CATALOGUE.md).
- Films: `bun scripts/camera-video.ts [voyage cine montage subject tour]` — 720p, 30 images a second, frame by
  frame (the game frozen and stepped), encoded by ffmpeg into `remote-results/camera-video/`.

## The code

| file | what |
|---|---|
| `src/camera/voyage.ts` | the relativistic rocket's plan (pure): the bound by the surface, the spirals, the playback |
| `src/camera/voyager.ts` | the voyage played on the controller; the throat's passage (`startThroat`) |
| `src/camera/cinevoyage.ts`, `skim.ts` | the cinematic voyage, the low passes |
| `src/camera/subjectcam.ts` | the views about a craft |
| `src/traffic/focus.ts` | the traffic's focus: the craft, else the view's eye; hysteresis, radii by height |
| `src/camera/speed.ts` | the speed by the surface |
| `src/camera/metrics.ts` | the smoothness sensor |
| `src/ui/voyagehud.ts`, `src/ui/camerapanel.ts` | the voyage card, the camera panel |
| `src/main.ts` (`goTo`, `travelTo`, `mouthGoal`, `tour`) | the goals, the crossing of the wormhole, the itinerary |
