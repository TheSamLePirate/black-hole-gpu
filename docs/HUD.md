# The HUD's piloting aids

Over the view while flying (`src/ui/hud/symbology.ts`, drawn on `canvas.fl-hud` each frame under the
nose symbol and the flight path vector), each aid where it helps, each with its switch in
**Settings › Game › HUD aids**. Directions come from `flightInfo()` in camera coordinates (at infinity:
right from any mount); points (the future path, the runway, the docking gates) with their distances.

- **Views**: full in the pilot's seat and the views on the hull (chase, dorsal…); from outside the ship
  (around, free, fly-by, the port's camera) the markers only. The ² density *clean*: the markers only.
- **Small screens** (under 1000 × 560 CSS px — a phone): the symbology in the view kept; the heading tape,
  the bank scale, the boxes and the scopes left to the HUD's panels.
- **Colours**: the game's palette — cyan the instruments and the predictions, amber the craft and the
  cautions, green what is right (on speed, on the axis, aimed), red the limits; each stroke over a dark
  outline, read on a bright sky.

## Everywhere near a world

| Aid | What |
|---|---|
| Horizon & pitch ladder | The local horizontal where it is; rungs every 5° (labelled every 10°), solid above, dashed below, their end ticks to the horizon, curved as the lens draws them; within a central field fading towards its rim; zenith and nadir. In orbit the local horizontal stands above the planet's limb by the horizon's dip (~20° at 400 km). |
| Heading tape | At the top: the view's heading against the world's north (its spin axis), boxed; carets for the nose (amber), the track (green: through the air, or the orbit's) and the target (orange). |
| Bank scale | Fixed to the craft, its pointer to the sky's up; red past 60°. |
| Radial & normal | Radial out / in (cyan), normal / anti-normal (magenta) in the view as on the attitude ball. |
| Arrows at the edge | The prograde, the burn, the docking port off screen: an arrow at the edge of the free frame (clear of the mission bar and the hub), the marker's glyph by it. |

## In the air

| Aid | What |
|---|---|
| Angle of attack | Drawn where it is, along the arc from the flight path vector to the nose in the craft's plane of symmetry: a green bracket on the best lift-to-drag incidence (C_L = √(C_D0 π AR e), ±1.5°), an amber tick at 85 % of the stall, a red bar at the stall; the nose symbol among them shows the margin; α in figures. STALL flashes, AOA past 92 %. |
| Sideslip | A ball under the flight path vector, off centre by β (8° full scale). |
| Energy | A chevron by the flight path's wing: the speed's rate as the flight path angle it would buy, atan(dV/dt / g) — above the wings gaining speed, below losing it. |
| Load | In g when it departs from 1 g, amber at 70 % of the craft's limit, red at 90 %. |
| Flight director | With the sci-fi flight computer: where it wants the flight path (its climb angle, its heading), a magenta cue and a dotted line to it. |

## The future

| Aid | What |
|---|---|
| Predicted path | The free fall from the ship's place, in perspective (both universes; on Gargantua's side the lensed tube ⇧Y draws it when on): relative to its body — over the ground as it turns near it and in the air, the orbit as it is higher —, cut where the body stands in front of it. Hidden while a wing carries the craft (the flight path vector tells where it goes). |
| Places to come | +10, +30, +60 s and a quarter of the orbit; about the hole an eighth, a quarter, a half of the prediction (a sample is minutes to hours there). |
| Impact & entry | Where the path meets the ground — the spot as the ground turns now —, the air's top on the way down, Gargantua's horizon; the countdown; off screen an arrow at the edge. |

## Approach & landing

| Aid | What |
|---|---|
| Runway | The entry's own, else the nearest on the world within 80 km below 20 km: its outline (4.5 km × 90 m), the threshold, the centreline drawn 15 km back. |
| Aim point | 2 km short of the threshold: the direction to it is the glide path — the flight path vector on the diamond, the craft on its glide path. |
| Runway box | The runway, the distance to the threshold, the offset across the axis (L / R, ON AXIS), the glide path's error on the final; FLARE below 60 m. |
| Drift scope | Low and slow (under 3 km): the velocity over the ground, heading up, its scale chosen for it; the vertical speed's bar; the height. |
| Stop burn | At full thrust against gravity ((TWR − 1) g): the stopping distance v²/2a and the time until the burn must start — BURN IN …, BURN NOW, TWR < 1. |
| Touchdown spot | Down the height, along the drift for as long as the fall lasts. |

## In space

| Aid | What |
|---|---|
| Burn cue | The plan's next burn: its countdown, Δv, its length at full thrust; the aim — a ring about the manoeuvre marker, green within 2°, amber within 10°, red beyond — and TURN TO THE BURN when it nears with the craft not turned. |
| Docking guide | Gates 5–100 m out along the free port's axis (those still ahead); a scope down the axis — the offset across it, its drift over 10 s —; range, closing (red too fast within 20 m), the lateral offset and rate, the ports' angle. |

## Near Gargantua

| Aid | What |
|---|---|
| Relativity box | dτ/dt and its bar; the speed against the local observer, γ, the sky ahead's Doppler factor; E per unit mass — bound and the margin to escape, or escaping; the radius against the ISCO, the photon orbit and the horizon (red inside, or in the ergosphere); the tide per metre of the craft. The radial-in marker named GARGANTUA. |

Cost: the symbology is a few hundred canvas strokes a frame; the future path and the runway are
recomputed ten times a second at most (`futureView`, `runwayView`). Full screen at 1280 × 720 and on a
phone: 16.7 ms a frame (median).
