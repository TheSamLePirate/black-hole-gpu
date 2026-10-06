# The map (3D)

The minimap (bottom right while flying) and the full-screen map (**M**) are one 3D view: a camera
orbiting a focus, its angles measured in a reference plane, float64 throughout — from a low Earth orbit
to the edge of the solar system. Two layers with one projection: the **GPU** (WebGPU, the tracer's own
device and maps — `gpu.ts`, `shaders/map.wgsl`) draws the bodies, the orbits and the paths, the
reference plane's grid and the marks (apsides, nodes, AN / DN, the ship, the closest approaches, the
spheres of influence — `paint.ts`, drawn there or on the canvas alike); a Canvas 2D overlay the text
(labels, the node's card, the footer) and the nodes' handle glyphs. The points are projected on the CPU in float64 (the log scale's
warp included) and handed over in pixels with their view depth. Without WebGPU, or if its pipelines are
refused, the canvas draws everything itself (`src/ui/map3d/`: `camera.ts` the eased orbit camera, `scene.ts` what each universe holds,
`map3d.ts` the drawing, gestures and bar). The flight HUD's map panel (`src/ui/flighthud.ts`) puts
it under three tabs — **3D**, **Globe**, **Planisphere** (see *The ground track* below).

## Wormhole crossings

The map remains populated throughout the Dneg region, including its flares. The physical cylinder
has proper length `whLength * whRho` and extends from `-a` to `+a`, where
`a = whLength * whRho / 2`. Its inset shows intrinsic progress and the length converted using the
current black-hole mass. Both map mouths use `whRho` as their radius. The larger gluing sphere
connects Dneg to Kerr; leaving the cylinder and leaving that sphere are different events.

Inside the cylinder, the map keeps the entry universe until the ship exits at the opposite end.
The cylinder projects to a sphere in Cartesian map coordinates, so its longitudinal motion is shown
in the inset. Saved games retain the entry universe, even when the ship is stopped at the centre.
Free-flight predictions carry explicit times and universes, with entrance, centre, exit and gluing
events. Paths never connect Cartesian points in different universes. The timeline announces when
its preview reaches the other universe, a computation limit or a prediction failure.

A change of universe or physical domain resets previews, trails and asynchronous path caches.
Inapplicable manoeuvres are suspended with an explanation; their nodes retain their original
universe. Wormhole arrival missions keep their traversal behavior. The existing warp restoration
at the end of the Dneg region respects a warp value manually changed by the pilot.

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

## Full screen

**M** opens the map over the whole screen; the flight HUD's instruments are hidden but for the top bar.
The flight computer on the left, its analysis on the right (each folds to a tab), a compact **strip**
along the bottom — the orbit's state, altitude, speed, periapsis and apoapsis (r in M about Gargantua),
the hub's actions (HOLD POS, CIRC, APPROACH, LAND, TAKE OFF, ENTRY: the flight computer's own operations).
The map frames itself in the free middle (its bar, its timeline, its footer there; nothing over anything,
from 1280×720 to 2560×1440); the strip sheds its state, then the buttons' names, then the apsides as it
narrows.

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
  low orbit on one map); **Legend** — what each line and mark is, for the universe shown (remembered);
  **Fit** — back to the automatic framing; **CoM / Hole** (Gargantua's side with a massive companion
  star) — the frame; **⛶** — full screen.

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
- Bodies as true spheres on the GPU (each a quad whose pixels' rays meet the sphere: right in
  perspective, a planet filling the view as well as a dot), textured on their own axes with the
  tracer's maps — the planets' and moons' images, the Earth's day, clouds, city lights and the sea's
  glint —, lit by their star (the terminator, the air's rim), their limbs anti-aliased; Saturn's rings
  in front of and behind it with the planet's shadow; the Sun and the star glowing; Gargantua's horizon,
  its disk (brighter on the approaching side) and photon ring; its worlds drawn as the tracer draws them
  (Miller's water, Mann's ice, Edmunds' plateaus); a field of stars behind. Lit in linear light and
  encoded for the screen (sRGB): the maps' own colours. The grid is hidden behind them by the same depth
  as the lines.
- **The marks on the GPU**: discs, polygons (up to four corners: diamonds, triangles, the ship's
  chevron), short screen lines and soft discs (a sphere of influence's faint fill), as signed distance
  fields — anti-aliased at any size, filled and stroked, a disc's rim dashed. They are drawn over the
  lines, always seen, under the canvas's labels.
- **The lines on the GPU**: every orbit and path (the free fall, the plan, the preview, the conics, the
  entry, the bodies' arcs in the preview) anti-aliased at any width, round at their joints and ends,
  dashed by their length on the screen, faded with depth. The opaque bodies are drawn into a depth
  buffer first (the view depth's logarithm, near to 10¹² × near: a low orbit and the whole system in
  one buffer). The lines are tested against it, so an orbit passing behind a planet, a star or
  Gargantua's horizon is cut exactly at the limb, pixel by pixel.
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
- **The preview** (violet, long dashes): an operation or a mission asked of the flight computer is
  drawn before it is flown — its burns, its path, its arrival, its marks on the timeline, the globe
  and the planisphere — then *TO THE PLAN* adopts it, *DISCARD* (or another tab) drops it. Our side:
  the planner's n-body path; about the hole: the geodesics; about Gargantua's worlds: their orbit in
  their own frame (Kepler), carried on the map as the world moves.
- **The entry**: the guidance's predicted fall to the site (orange, dashed) and the site.
- The labels are placed, the most important first, where they fit: each tried where it was asked, then
  round what it names (the other side, above, below, the corners), off the bodies' discs and the ship's
  mark; one that fits nowhere is left out unless it matters (the focus, the target, the preview, an
  impact). An apsis a few pixels from its body (an orbit too small on the screen) goes unlabelled; the
  same apsis named by the prediction and by the conics, once.

Through the wormhole the ship, the target, the scene and the paths are not all on one side: a target
on the other side (the wormhole's mouth as seen from ours, a body of Gargantua's) gets no closest
approach or arrival mark along the conics, rather than a wrong one.

## The ground track

The **Globe** and **Planisphere** tabs (`src/ui/groundtrack.ts`): the world the ship orbits — only
inside a planet's or a moon's sphere of influence (ours; Miller, Mann, Edmunds on Gargantua's side);
elsewhere the tabs are dimmed and the 3D map shows, the tab chosen kept (remembered in
`localStorage` `kerr.map-tab`).

- **Globe** — on the GPU (the map's renderer: the world's map at the screen's resolution, the Earth's
  clouds and city lights, the night side faintly lit to stay readable, an atmosphere's rim; without
  WebGPU a CPU raster), turning under the ship, centred on it.
  Drag turns it (the ship no longer followed), the wheel zooms (×1–8), a double-click follows the
  ship again.
- **Planisphere** — equirectangular, on the GPU: each pixel the surface straight below, lit as the
  globe lights it (the terminator, the night faint, the Earth's city lights and clouds; Gargantua's
  worlds procedural) at the screen's resolution. Without WebGPU, the map's image with a night mask.
- On both: the graticule, the track left (fading; recorded whatever the tab), the free-fall path ahead
  and the planned one through the nodes (each point on the world's axes at its own time: the world
  turns under it), periapsis / apoapsis with their heights, the horizon the ship sees, the point under
  the Sun, the ship's chevron; the ISS and the fleet's craft where they are, their ground track an orbit
  ahead (brighter when targeted). The readout: latitude, longitude, altitude, Pe · Ap · i.
- Gargantua's worlds: procedural, as the tracer draws them, in their own frame (x away from the hole).
- The sites (spaceports, runways, Gargantua's camps), the preview's path, the entry's fall.
- The same drawing picks a place in F2 › Place: a click on the globe or the planisphere — where to land,
  or the orbit passing over it.

On the GPU the tracks over the globe and the planisphere are GPU lines too (anti-aliased, faded along,
broken across the planisphere's edge), drawn at 15 Hz (every frame while dragged).

Cost: ~1 ms a frame on the main thread (the orbits cached and re-sampled a few a frame as time goes by);
on the GPU, four draw calls (the stars, the bodies' depth, the bodies, the lines — a few thousand
segments) and a fifth for the marks. Full screen at 1600×900 holds 60 frames a second (16.7 ms median and
95th percentile, Earth or the whole system in view).
