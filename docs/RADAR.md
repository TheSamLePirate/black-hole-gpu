# The radar, the tactical picture and the world's runways

The pilot's sensors, what every screen draws of them, and what the crew and the room receive. The plan and its history:
[PLAN-RADAR-AAA.md](PLAN-RADAR-AAA.md) (French), each phase's sheet in `docs/progress/radar/`. French:
[RADAR.fr.md](RADAR.fr.md).

## The tactical picture — one list of tracks

`src/radar/picture.ts`, built once a frame by `controller/radar.ts` (`pictureStep`) after the radar's sweep. It is the only
thing the screens, the tools and the network read.

- **A track carries both the truth and the sensors' view.**
  - The truth: `side` (friend, hostile, neutral, traffic, carrier, player, dead), `rt` (where it truly is),
    `lat`/`lon`/`h` over the WGS84 ellipsoid (exact: its Earth-fixed point from the craft's fix).
  - The sensors' view:
    - `sensors`: bits RADAR 1, DATALINK 2, TCAS 4, AIS 8, DAS 16, EOTS 32, BRIEF 64;
    - `iff`: as answered or seen — unknown until then;
    - `state`: firm (measured now), coast (carried on), datalink, or truth (no sensor holds it);
    - `r`: the radar's estimate;
    - `seenAt`: when it was last measured.
- **The sources** (`camera.radarSources`): the real traffic `trf:`, the ships `ais:`, the carriers `cv:`, a fight's
  targets `cmb:`, our AI wingmen `wng:`, the others' `rwg:`, the room's players `net:`.
  - Every source gives its things in one frame: the local east, north, up at the craft.
  - The fight's flat frame passes through `combatToLocal`.
- **The weapons are tracks too.**
  - Missiles (`msl:`) carry their seeker, target (`own` for us), time to go, `ours`, decoyed, motor, and their end
    (SPLASH or MISS, shown 3 s).
  - Decoys (`cm:`) carry their life left.
- **The selection** (`camera.pictureSelected`) is one for all the pilot's screens; the lock is the radar's
  (`camera.radar.lock`).
- **The history** (`TrailStore`): a point at each radar measure (each 2 s otherwise, 0.25 s for a missile), 120 a track,
  400 tracks.
- **Cost**: `__bh.radar.stats().ms` gives the picture's building time, smoothed.

## The sensors

| sensor | who | what |
|---|---|---|
| **APG-81** (`game/radar.ts`, a `RadarSpec`) | the F-35 in the air | ±60° in 2 s, range ∝ σ^¼ (150 km on 5 m²), the radar horizon, the relief's mask, the Doppler notch looking down; RWS, TWS, STT; IFF within 120 km, eyes within 3 km |
| **DAS** | the F-35 | heat, all round: aircraft within 30 km, a missile's motor within 20 km (3 km burnt out), flares within 10 km; no IFF |
| **EOTS** | the F-35 | ±30° off the nose, 60 km; no IFF |
| **Datalink** | everyone | our friends' craft, our missiles (their guidance link), the room's teammates' radar tracks (Link 16) |
| **TCAS** (`radar/tcas.ts`) | every craft in the air | the transponders within 30 NM and ±9 900 ft, graded as TCAS II (sensitivity level 5) |
| **AIS** | everyone | the ships |
| **Rendezvous radar, docking lidar** (`radar/space.ts`) | the Ranger, the Lander, the Endurance | the station, the fleet's craft, the room's players in orbit, on the craft's LVLH axes |

**Chaff**: in RWS, at the realistic or manual assistance, a bloom is a false unknown track for its first 2.5 s.

### The TCAS

The TCAS grades each transponder:

- **proximate**: within 6 NM and 1 200 ft;
- **TA** (traffic advisory): the closest approach within 40 s, or already inside the protected volume;
- **RA** (resolution advisory): within 25 s, only on a closing intruder.
  - It says climb or descend, away from where the intruder will pass (the intruder's own RA heeded).
  - It is inhibited under 1 000 ft over the ground.

Where it shows:

- **Symbols**: the TCAS II's own — a diamond (filled when proximate), an amber disc (TA), a red square (RA). A
  non-civil track is ringed in those colours.
- **The HUD of every craft**: TRAFFIC, or CLIMB ↑ / DESCEND ↓, with the distance, the height difference and the
  time; the intruder is marked in the view.
- **The voice**: "Traffic, traffic", "Climb, climb!", "Descend, descend!", "Clear of conflict".
- **The F-35's Auto-ACAS** flies the RA's sense.
- **Setting**: `tcas`.

### The spacecraft

Five times a second (`controller/spacepic.ts`), each craft builds its tracks:

- **Their place**: on the LVLH axes (V-bar, H-bar, R-bar), with the range, the rate and the closest approach.
- **The radar**:

  | craft | range on 5 m² |
  |---|---|
  | Ranger | 120 km (the ISS seen at ~540 km) |
  | Lander | 80 km |
  | Endurance | 300 km |

- **The lidar**: within 3 to 5 km.
- **Hidden**: a body between hides a craft from both, never from the datalink.
- **The HUD's space scope** (chase view): V-bar up, H-bar right, a logarithmic range from 100 m to 1 000 km. Each track
  shows its range, rate and R-bar height.

## The screens

**One symbology** (`src/radar/symbols.ts`, `drawSym`), pure, so the crew uses it too.

- **Shapes**: APP-6 simplified.
  - Aircraft open below: a friend's arc, a hostile's chevron, an unknown's or a neutral's box.
  - Ships and ground units whole.
  - The civil traffic a TCAS diamond.
  - A missile a dart along its way, blinking when it is at us.
  - A flare an orange star, chaff a cloud of grey dots.
- **States**: plain (firm), dimmer (coast), dashed (datalink), faded (truth only). The lock is ringed, the selection an
  amber dashed ring.
- **Palette** (`PAL`): friend cyan, hostile red, unknown yellow, neutral white, traffic grey-white, a player in their own
  colour.

What each screen draws:

| screen | file | what |
|---|---|---|
| HUD scope | `ui/hud/symbology.ts drawRadar` | the radar's and datalink's tracks, the TCAS traffic that matters, missiles (line to target, time to go, PITBULL + A-pole, SPLASH/MISS + F-pole, DECOYED), decoys, trails, the world's airfields; a click selects, the wheel steps the range |
| PCD TSD, FCR, DAS, EOTS | `f35/pcd.ts`, data `f35/cockpit.ts` | the same; the FCR the radar's own (RWS bricks); the DAS band what the DAS holds; a touch selects, the wheel steps the TSD's and FCR's range |
| Tactical map (right panel, M) | `ui/jetmap.ts`, `ui/flighthud.ts` | OSM by night, the trace and the predicted path, the plan, the airfields, the picture; the wheel steps 2 … 320 km, a click selects, its top-left corner resizes it |
| The view | `controller/telemetry.ts pic`, `drawPicked` | a click on an aircraft selects it (never a body); the selected one's card |

## Selecting and zooming

- **A click on a symbol** (within 12 px) selects it on every screen: its card and its BRAA. A **second click** on the
  same symbol locks it, if it is a radar track. A click in the void lets the selection go (the lock stays).
- **The crew's « Designate to the pilot »** does the same as the pilot's click.
- **The wheel over a radar** steps its range (a notch every 50 px) and is consumed: the camera's field never moves. The
  common steps are 2 … 320 km for the air, 1 000 and 10 000 km for space; the crew's scopes use them too (a pinch settles
  on the nearest).

## The world's runways

The data:

- **Source**: OurAirports (public domain), built by `scripts/build-runways.ts` into `assets/runways/v1`.
- **Format**: 5° tiles, an index, an identifier map.
- **Contents**: 72 621 places, 34 030 runways; missing thresholds are rebuilt from the runway number and marked
  approximate.

Its module is `src/world/runways.ts` (pure, shared with the crew): `fieldsNear`, `fieldByCode`, `fieldShown`.

Where the runways appear:

- **Maps and radars**: on every one, with the level of detail of the range (`world/runwaydraw.ts`): a dot far off, lines
  at scale, outlines and numbers close.
- **In 3D**: the 24 nearest within 25 km, flattened like the game's own sites (`world/runways3d.ts`).
  - Their level is the median of the bare relief under them, on the geodetic latitude.
  - They are measured again at 5 and 20 s, as the finer relief arrives.
  - They are drawn by surface; lights only on lit runways.
- **Usable**: the ILS, the autopilot's approach and landing, `lineUp`/`glideTo`, the flight plan, RTB, the charts,
  METAR, TARS, the crew — any ICAO or IATA code.

## The crew and the network

### The compact picture

`net/picture.ts`, the `pic` block of `instruments`, four times a second:

- **Rows**: one a track, quantified — the place in 1e-5° from the pilot's, the height in m, the velocity in dm/s, the
  freshness, and the bits.
- **A dictionary**: the ids, names and types, sent once a track.
- **Priorities**: the lock, the selection, the hostiles, the missiles, the decoys, the datalink's and what is within
  40 km go in every block; the rest by turns, at most 220 rows a block.
- **Gone**: the ids lost are said.
- **The pilot's radar**: its mode, beam and range.
- **Catch-up**: a crew that comes gets the dictionary again and the last two minutes of every history.

300 tracks fit in about 6 KB.

### The console

`crew/tracks.ts` merges every pilot's picture by id, the freshest measure winning.

- **« Sensor »**: what the pilot's sensors hold, coloured by their IFF. The scope shows the pilot's real ±60° sector and
  his beam.
- **« Shared »**: the whole truth — also in a match, as the room is told. What the sensors do not hold is faded, and
  there is no false sweep.
- **Orders**: they name a contact by its id (`wp.lock`, `ap.traffic`, `nav.target`, `wp.designate`).
- **Saved**: the range, north up and the view are kept.

### Link 16

`net/link16.ts`: each F-35 sends, twice a second, the keys and IFF of the tracks its own radar holds.

- **With whom**: the whole room out of a match and in the non-combat matches, one's team in a team fight, nobody in the
  free fight or the free-for-all.
- **On the receiving page**: the thing becomes a datalink track (dashed, IFF known). One thing stays one track. It is
  dropped when nobody shares it any more.

### In a match

- **Missiles and decoys** from another player are placed from the shooter's craft as the network places it. Each page's
  fight is anchored where it began.
- **Hostility**: a missile at us is hostile, whoever fired it.

## Settings

| setting | default | what |
|---|---|---|
| `f35Radar`, `f35RadarRange`, `f35RadarRelief` | on, auto, on | the HUD's scope, its range, the relief under it |
| `radarTrails` | off | the tracks' history: off, 30 s, 3 min |
| `radarTrailLock` | on | the lock's and the selection's history even with the trails off |
| `radarTrailMissiles` | on | a missile's last 5 s always |
| `tcas` | on | the TCAS for every craft in the air |

## Tests

**Unit tests**:

- `radar` — the APG-81;
- `radar-picture` — the merging, places, trails, DAS and EOTS;
- `radar-symbols`;
- `tcas`;
- `space-picture`;
- `net-picture` — round trip, size, priorities, gone, catch-up;
- `link16`;
- `runways`, `runway-parity`;
- `callouts` — the TCAS's lines.

**e2e** on kerr-mini (see [E2E-CATALOGUE.md](E2E-CATALOGUE.md)):

- `radar-sync` — the P1–P11 probe;
- `radar-select`;
- `jetmap`;
- `decoys`;
- `missile-cues`;
- `tcas`;
- `space-sensors`;
- `link16`;
- `world-runway`;
- `net-wing-fight`.
