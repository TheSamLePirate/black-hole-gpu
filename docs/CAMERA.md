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

Choosing one of these views stops the free camera following your own craft.

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
- e2e: `camera-smooth` (14 situations through the sensor), `camera-voyage`, `camera-subject` —
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
| `src/camera/speed.ts` | the speed by the surface |
| `src/camera/metrics.ts` | the smoothness sensor |
| `src/ui/voyagehud.ts`, `src/ui/camerapanel.ts` | the voyage card, the camera panel |
| `src/main.ts` (`goTo`, `travelTo`, `mouthGoal`, `tour`) | the goals, the crossing of the wormhole, the itinerary |
