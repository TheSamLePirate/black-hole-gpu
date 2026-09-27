# The map (3D)

The minimap (bottom right while flying) and the full-screen map (**M**) are one 3D view: a camera
orbiting a focus, its angles measured in a reference plane. Canvas 2D over the tracer's pinhole
projection, float64 throughout — from a low Earth orbit to the edge of the solar system
(`src/ui/map3d/`: `camera.ts` the eased orbit camera, `scene.ts` what each universe holds,
`map3d.ts` the drawing, gestures and bar).

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

- **Focus** — the body at the centre, with the breadcrumb of its primaries (Sun › Saturn › Titan, a
  click on one centres it) and a searchable tree of every body (moons under their planet), the ship
  (followed), the target. *auto*: the ship's primary (the Earth for a flight to the Moon).
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
- Beyond the prediction (our side): **patched Kepler conics** from the path's end (`src/system/our-extend.ts`,
  `src/game/kepler.ts` — universal variables): a conic around the body of the sphere of influence;
  entering a moon's or a planet's sphere, a conic around it; leaving, around its primary; stopped at a
  surface. Drawn dotted (“conics ▸”), with the lowest point in each sphere crossed, an impact, and their
  marks on the timeline (“(conics)”); the preview's ship follows them. Computed in the planner's worker
  (~20 ms, a few times a second at most, the frame loop untouched). A picture, not the flight: near the
  edge of a sphere of influence patched conics are sensitive (an apogee at the Earth's sphere may or
  may not meet the Moon on the way back); the planner's n-body paths stay the reference.
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
- Stems from the ship and the target down to the plane (solid above it, dashed below).
- The ship's paths: free fall (cyan), through the nodes (orange), apsides, where they cross the plane
  (**AN** / **DN**), impacts, the closest approach to the target, the target where the plan meets it;
  Gargantua's side: time ticks, the companion star's arc, the ship's track.

Cost: ~1 ms a frame on the main thread (the orbits cached and re-sampled a few a frame as time goes by).
