# The map (3D)

The minimap (bottom right while flying) and the full-screen map (**M**) are one 3D view: a camera
orbiting a focus, its angles measured in a reference plane. Canvas 2D over the tracer's pinhole
projection, float64 throughout — from a low Earth orbit to the edge of the solar system
(`src/ui/map3d/`: `camera.ts` the eased orbit camera, `scene.ts` what each universe holds,
`map3d.ts` the drawing, gestures and bar). The flight HUD's map panel (`src/ui/flighthud.ts`) puts
it under three tabs — **3D**, **Globe**, **Planisphere** (see *The ground track* below).

## Gestures

| | |
|---|---|
| Drag | turn the view around the focus |
| Right-drag · ⇧-drag | pan |
| Wheel | zoom towards the pointer |
| Click a body | target it |
| Double-click a body | centre it (eased); on empty space: back to the automatic view |
| Click on a path | a manoeuvre node there; drag a node along the path, pull its handles (Δv), right-click / Delete: remove it |
| Hover a body | its card: distance from the ship, radius, distance from its primary, period, sphere of influence |

## The bar

Full screen (**M**), the whole bar across the top. On the minimap, a rail of icon buttons down its
right edge: the **plane** and the **view** each one button cycling (the plane's short name under its
icon: Sys / Eq / Orb / Tgt), then multi-scale, frame, CoM / Hole, full screen — the focus menu and the
segmented buttons only in full screen. Names and what each does in the HUD's tooltips (no keys); what
cannot apply is dimmed, with why (the *Target* plane when the target has no orbit).

- **Focus** — the body at the centre, with the breadcrumb of its primaries (Sun › Saturn › Titan, a
  click on one centres it) and a searchable tree of every body (moons under their planet), the ship
  (followed), the target. *auto*: the ship's primary (the Earth for a flight to the Moon). Our side
  also holds the ISS (under the Earth) and the fleet's craft not flown — targets like the bodies.
- **Plane** — the reference plane the grid lies in and the angles are measured in: the **system**'s
  (the ecliptic; the hole's equator), the focus body's **equator**, the ship's **orbit**, the
  **target**'s orbit. Changing it turns the camera (eased) — the view keeps its angles to the plane.
- **View** — ⊤ from above the plane, ◿ 30° above it, ⟂ edge-on (in the plane).
- **Log** — the distance from the focus as r₀ ln(1 + r/r₀), directions kept (the whole system and a
  low orbit on one map); **Fit** — back to the automatic framing; **CoM / Hole** (Gargantua's side
  with a massive companion star) — the frame; **⛶** — full screen.

## The timeline

Under the breadcrumb (full screen) or at the bottom of the minimap: where everything will be.

- Drag the handle (or click the track): the bodies at that time, the ship where its path takes it —
  the free fall, or the plan once past its first node (to the end of the prediction, then held
  there). Faint rings mark where the ship and the nearby bodies are now; the bodies' arcs until
  then are drawn. The paths are shown in the focus body's frame at that time.
- The marks: manoeuvre nodes (blue), the closest approach to the target (orange), entering another
  body's sphere of influence (violet), periapsis / apoapsis, the arrival, an impact or the horizon
  (red) — a click jumps there, the handle snaps to a mark within 6 px.
- Hand-made nodes: the path through them (n-body) reaches a turn of the orbit after the last burn —
  days to the Moon and back — computed in the planner's worker and kept while the nodes stay as
  they are (refreshed every 2 s); a node just made or pulled first shows a short path (to the last
  node and half an hour on), continued by the conics until the far one comes (well under a second).
- Beyond the prediction (our side): **patched Kepler conics** from the path's end (`src/system/our-extend.ts`,
  `src/game/kepler.ts` — universal variables): a conic around the body of the sphere of influence;
  entering a moon's or a planet's sphere, a conic around it; leaving, around its primary; stopped at a
  surface. Drawn dotted (“conics ▸”), with the lowest point in each sphere crossed, an impact, and their
  marks on the timeline (“(conics)”); the preview's ship follows them. Computed in the planner's worker
  (~20 ms, a few times a second at most, the frame loop untouched). A picture, not the flight: near the
  edge of a sphere of influence patched conics are sensitive (an apogee at the Earth's sphere may or
  may not meet the Moon on the way back); the planner's n-body paths stay the reference.
- Gargantua's side: the same, beyond the geodesic prediction (the plan's path once it has nodes, else
  the free fall): Newtonian conics around Gargantua (GM = 1 M, stopped at its horizon), patched into
  the Hill spheres of Miller, Mann, Edmunds' star and Edmunds, and of a massive companion star
  (`src/system/their-extend.ts`; the engine is shared: `src/system/patched.ts`). Their periapsides
  (r around the hole), the spheres entered, the closest approach to the target, the horizon hit.
  Computed here (~4 ms, twice a second at most). Far from the hole a fair sketch; within ~20 M,
  Kerr's orbits precess and plunge where a conic would not — the geodesic prediction stays the
  reference. The steps never stride over a sphere (Miller's Hill sphere is ~41 000 km).
- ▶ plays it (the span in 8 s); **Now** comes back; the wheel on the track makes the span longer or
  shorter (automatic: as far as the predicted paths reach, or to the encounter with the target along
  the conics). The label: the date and T+.

## What it shows

- The reference plane's grid (rings labelled in km / AU / M, spokes every 30°, the vernal equinox ♈).
- Bodies as spheres lit by their star (a night side, an atmosphere's rim), stars with a glow, Saturn's
  rings in front of and behind it, the hole with its disk, ISCO, photon orbit and ergosphere, the
  wormhole's mouths.
- Each body's orbit (a turn around its primary; moons once they spread on the screen), dimmed with
  depth and where a body hides it; spheres of influence (the ship's own, the focus's, the target's —
  all with Settings › Game › *Spheres of influence*).
- The ISS (its SGP4 place and a turn of its orbit) and the fleet's craft not flown (a turn of their
  Kepler orbit around the Earth; none drawn once unbound) — a click targets them, the closest
  approach and the plan's arrival are drawn against them.
- Stems from the ship and the target down to the plane (solid above it, dashed below).
- The ship's paths: free fall (cyan), through the nodes (orange), apsides, where they cross the plane
  (**AN** / **DN**), impacts, the closest approach to the target, the target where the plan meets it;
  Gargantua's side: time ticks, the companion star's arc, the ship's track.

Through the wormhole the ship, the target, the scene and the paths are not all on one side: a target
on the other side (the wormhole's mouth as seen from ours, a body of Gargantua's) gets no closest
approach or arrival mark along the conics, rather than a wrong one.

## The ground track

The **Globe** and **Planisphere** tabs (`src/ui/groundtrack.ts`): the world the ship orbits — only
inside a planet's or a moon's sphere of influence (ours; Miller, Mann, Edmunds on Gargantua's side);
elsewhere the tabs are dimmed and the 3D map shows, the tab chosen kept (remembered in
`localStorage` `kerr.map-tab`).

- **Globe** — orthographic, the world's map sampled per pixel and lit by the Sun (soft terminator, the
  night a little blue, the limb darkened, an atmosphere's rim), turning under the ship, centred on it.
  Drag turns it (the ship no longer followed), the wheel zooms (×1–8), a double-click follows the
  ship again.
- **Planisphere** — equirectangular, the night laid over it.
- On both: the graticule, the track left (fading; recorded whatever the tab), the free-fall path ahead
  and the planned one through the nodes (each point on the world's axes at its own time: the world
  turns under it), periapsis / apoapsis with their heights, the horizon the ship sees, the point under
  the Sun, the ship's chevron; the ISS and the fleet's craft where they are, their ground track an orbit
  ahead (brighter when targeted). The readout: latitude, longitude, altitude, Pe · Ap · i.
- Gargantua's worlds have no map: their tint, banded, in their own frame (x away from the hole).
- The same drawing picks a place in F2 › Place: a click on the globe or the planisphere — where to land,
  or the orbit passing over it.

The globe's raster (≤ 420 px across) is redrawn only when the view or the light moved; the tracks over
it at 15 Hz (every frame while dragged).

Cost: ~1 ms a frame on the main thread (the orbits cached and re-sampled a few a frame as time goes by).
