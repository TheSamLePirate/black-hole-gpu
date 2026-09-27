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
