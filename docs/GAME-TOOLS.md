# Game tools

Tools to manage, place, audit and improve the game — from the interface (**F2**, or 🛠 in the
mission bar / *Tools* in the toolbar) and from code (`__bh.game` in the console).

## The window (F2)

| Tab | What it does |
|---|---|
| **Ranger** | Live state: universe, sphere of influence, status (landed / in flight / suborbital / in orbit / escaping / hyperbolic; Kerr orbit on Gargantua's side), altitude, speeds, periapsis, apoapsis, inclination, e, period, times to the apsides, next event (leaving / entering a SOI, impact, the mouth), target, date and warp, pilot modes. *Copy as JSON*. |
| **Place** | Puts the Ranger in orbit around any body (ours: the 27 of the solar system; Gargantua's: Miller, Mann, Edmunds, and Gargantua itself on a Kerr circular orbit) — periapsis / apoapsis altitudes, inclination from the body's equator, Ω, ω, ν, retrograde — or on a ground (latitude, longitude, known sites). Quick buttons: orbit the target, LEO, KSC pad, low lunar orbit. |
| **Target · SOI** | The chain of spheres of influence the ship is in; every body with its radius, SOI and distance — a click targets it. |
| **Time** | Warp ×1 … ×1 000 000, pause; set the scene's clock to a date. |
| **Saves** | Named saves (every setting exact, the date, the pilot, the flight plan), the autosave, load / export / delete, import a file, copy a link. |
| **Audit** | Self-checks: settings finite, ephemeris velocities vs positions, ship state, SOI agreement, free-fall predictor vs Kepler, save round trip, frame rate, steadiness of the ship's light and of the auto exposure, errors, and (optional) the planner on the target. Report downloadable. |
| **Journal** | What happened: pilot messages, SOI and status changes, placements, saves, audits, errors — filter, copy, download. |

## The HUD

- **Telemetry › Ranger**: the status badge, SOI, altitude, speed, Pe · Ap, inclination · e,
  period · time to periapsis, next event, target. Sparklines in m/s and km around a body.
- **Orbit** (bottom left): around a body, the orbit to scale (the body, the apsides, the ship) and its
  Kepler figures; near Gargantua, the Kerr effective potential as before.
- **Map**: the spheres of influence (dashed; the ship's own brighter).
- **⌇ / Y**: the future path's cyan tube in the view, on / off (the map keeps it).

## Settings › Game

Turn rate, turn acceleration, RCS authority, free look; crash speed, ballistic coefficient;
Ranger status, SOI rings, future path in the view; autosave and its period.

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
__bh.game.orbitTarget()                             // around the current target
__bh.game.target("saturn"); __bh.game.soi(); __bh.game.bodies()
__bh.game.warp(1000); __bh.game.pause(); __bh.game.setDate("2067-06-01T12:00")
__bh.game.set("crashSpeed", 20); __bh.game.get("turnRate")
__bh.game.save("before TMI"); __bh.game.load("before TMI"); __bh.game.saves()
__bh.game.exportSave(); __bh.game.importSave(json); __bh.game.shareLink()
await __bh.game.audit({ planner: true })
__bh.game.log.events; __bh.game.log.text()
```

Sources: `src/game/` (orbit, place, status, save, log, audit, tuning, tools), `src/ui/gametools.ts`.
