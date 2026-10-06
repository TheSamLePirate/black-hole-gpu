# Game tools

Tools to manage, place, audit and improve the game — from the interface (**F2**, or the tools button
in the mission bar / *Tools* in the toolbar) and from code (`__bh.game` in the console).

## Placing the ship (for every player)

The HUD's **Place** button (also the radial wheel and the pause menu) opens `src/ui/placepanel.ts`: in
orbit (periapsis, apoapsis, inclination, retrograde; a click on the globe: the orbit passes over the
place now), on the ground (globe, the landing sites, latitude and longitude), beside a body at rest
(the hover autopilot holds it, the body targeted), before the wormhole on our side or on Gargantua's,
and quick ones. During a mission it asks first and ends the mission; from a scene without the game's
world (a bare Kerr view) it loads it first.

## The date and time (for every player)

The transport bar's clock (in flight: its clock button; also the pause menu) opens `src/ui/timepanel.ts`:
back to now (the real date) or to the start of the scene, a date chosen (UTC), steps of an hour, a day,
thirty days — `__bh.game.jumpTo(t)`: the ship carried with the world (on our side with its reference
body: the same orbit, the same place over it; by a mouth, against it; on Gargantua's side in its world's
frame; landed, where it stands), a plan made on the old clock dropped.

## The window (F2, developers: a development build or `?dev`)

| Tab | What it does |
|---|---|
| **Ranger** | Live state: universe, sphere of influence, status (landed / in flight / suborbital / in orbit / escaping / hyperbolic; Kerr orbit on Gargantua's side), altitude, speeds, periapsis, apoapsis, inclination, e, period, times to the apsides, next event (leaving / entering a SOI, impact, the mouth), target, date and warp, pilot modes. *Copy as JSON*. |
| **Place** | Puts the Ranger in orbit around any body (ours: the 27 of the solar system; Gargantua's: Miller, Mann, Edmunds, and Gargantua itself on a Kerr circular orbit) — periapsis / apoapsis altitudes, inclination from the body's equator, Ω, ω, ν, retrograde — or on a ground (latitude, longitude, known sites; Gargantua's worlds too). **The world as a globe or a planisphere** (its map, the day and the night): a click chooses the place — on the ground, where to land; in orbit, the orbit passing over it now (its node Ω and anomaly ν found when placed, the inclination raised to the latitude; typing Ω or ν goes back to them). Quick buttons: orbit the target, LEO, KSC pad, low lunar orbit. |
| **Target · SOI** | The chain of spheres of influence the ship is in; every body with its radius, SOI and distance — a click targets it. |
| **Time** | Warp ×1 … ×1 000 000, pause; set the scene's clock to a date. |
| **Saves** | Named saves (every setting exact, the date, the pilot, the flight plan), the autosave, load / export (⤓) / delete (✕), *Import a file…*, *Export now*, *Copy a link* (this moment, without the plan). |
| **Perf** | Where the frame's time goes: frames rendered and loop rate, GPU time per frame and of its passes, the image size (pixel ratio × render scale), quality · frame budget · realtime block, the worst loop; tables of the GPU passes (ms, last) and of the main thread's sections (ms, worst over 3 s). Buttons: quality *Game* (≈ 60 fps), *RT max* (≈ 30), *High*; dynamic resolution on / off. |
| **Audit** | Self-checks (*Run the audit*): settings finite, ephemeris velocities vs positions, ship state, SOI agreement, free-fall predictor vs Kepler, save round trip, frame rate, steadiness of the ship's light and of the auto exposure, errors, and (optional) the planner on the target. Report downloadable. |

The window remembers its last tab.
| **Journal** | What happened: pilot messages, SOI and status changes, placements, saves, audits, errors — filter, copy, download. |

## The HUD

- **Telemetry › Ranger**: the status badge, SOI, altitude, speed, Pe · Ap, inclination · e,
  period · time to periapsis, next event, target. Sparklines in m/s and km around a body.
- **Orbit** (bottom left): around a body, the orbit to scale (the body, the apsides, the ship) and its
  Kepler figures; near Gargantua, the Kerr effective potential as before.
- **Map**: the spheres of influence (dashed; the ship's own brighter). Its tabs: *3D*, *Globe*,
  *Planisphere* — the ground track of the world the ship orbits (track left and ahead, horizon, Sun).
- **Lock-on** (`src/ui/targethud.ts`): around the target (a body, or the station once clicked) a ring
  its apparent size, its name, the distance to its surface, the closing speed (▼ closing, ▲ away), the
  relative velocity's arrow, the closest approach or the time to impact; off the view, an arrow at the
  edge.
- **Path button** (mission bar) / **⇧Y**: the future path's cyan tube in the view, on / off (the map
  keeps it). Y alone is the telescope.

## Settings › Game

Grouped: *Ranger* (on / off, craft, view, engine, crew g, auto warp for manoeuvres, propellant
gauge, exhaust speed, mass ratio); *Ranger: appearance* (lighting, hull brightness, metalness, clear
coat, roughness); *Ranger handling* (turn rate, turn acceleration, RCS authority, free look yaw /
pitch); *Ground & air* (crash speed, ballistic coefficient); *Displays* (Ranger status, future path in
the view, spheres of influence on the map); *Sound* (volume, flight computer, engines & RCS, cabin &
wind, interface); *Saved games* (autosave, every 2–120 s).

## Saved games instead of the URL

The URL no longer carries the scene (its six digits put a ship in low orbit ~1 000 km off). The game
saves itself in the browser and resumes at the next visit (Settings › Game › Autosave). Links still
work: `#scene=game:interstellar` starts a scene, `#save=…` (made by *Copy a link*) restores a
moment; old `#spin=…` links are read once. The hash is then cleared.

## Code: `__bh.game`

```js
__bh.game.help()                                    // the list
__bh.game.status()                                  // everything the Ranger tab shows
__bh.game.orbit("mars", { peKm: 300, apKm: 1200, inc: 30, nu: 0 })
__bh.game.orbit("gargantua", { rM: 12 })            // Kerr circular orbit, radius in M
__bh.game.orbit("miller", { altKm: 300 })           // in Miller's frame (Gargantua's tides: ±70 km)
__bh.game.land("moon", 0.674, 23.473)               // Tranquility Base
__bh.game.land("mann", 10, -30)                     // Gargantua's worlds: lat / lon on their frame (x away from Gargantua)
__bh.game.near("jupiter")                           // beside it at rest, two radii up: targeted, the hover autopilot on
__bh.game.near("gargantua", { rM: 12 })             // a static observer 12 M from Gargantua
__bh.game.wormhole("gargantua")                     // before the far mouth (or "ours": beyond Saturn), at rest
__bh.game.glideTo("Kennedy", 80, 25, 750)           // the Ranger on a runway's line, 80 km out, 25 km up, 750 m/s — the glide autopilot lands it
__bh.game.glideTo("Kennedy", 40, 8, 300, { acrossKm: 10, headingDeg: -30 })  // 10 km right of the line, its course 30° left of the runway's
__bh.game.hoverOver("moon", 0.674, 23.473, 1.5)     // 1.5 km over Tranquility Base, at rest over it, hovering — G lands it
__bh.game.orbitOver("earth", 48.86, 2.35, { altKm: 400, inc: 51.6 })  // an orbit passing over Paris now
__bh.game.orbitTarget()                             // around the current target
__bh.game.placeAt({ frame, X, vel, fwd, up })        // at a state (home frame / the hole's map)
__bh.game.target("saturn"); __bh.game.targets(); __bh.game.soi(); __bh.game.bodies("gargantua")
__bh.game.warp(1000); __bh.game.realTime(); __bh.game.pause(false); __bh.game.setDate("2067-06-01T12:00"); __bh.game.date()
__bh.game.set("crashSpeed", 20); __bh.game.get("turnRate"); __bh.game.settings()
__bh.game.quality("game")                           // low · medium · high · ultra · realtime · game
__bh.game.perf()                                    // what the Perf tab shows (GPU timestamps: on from the start when the GPU has them)
__bh.game.preset("game:interstellar")               // a scene
__bh.game.save("before TMI"); __bh.game.load("before TMI"); __bh.game.saves(); __bh.game.deleteSave("before TMI")
__bh.game.exportSave(); __bh.game.importSave(json); __bh.game.shareLink(); __bh.game.autosaveNow()
__bh.game.pilotState(); __bh.game.snapshot()        // the pilot's modes in a line; a save object, not stored
await __bh.game.audit({ planner: true })
__bh.game.log.events; __bh.game.log.text()
```

Sources: `src/game/` (orbit, kepler, place, status, save, log, audit, tuning, tools), `src/ui/gametools.ts`, `src/ui/targethud.ts`.
