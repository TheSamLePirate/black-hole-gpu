# Jet flight and camera, AAA pass: progress and tests to run

The request: a Cinemachine-style camera system (third person, flight, rocket, planets, systems), a better HUD for
plane mode flown like a jet with all of a jet's options, and fewer alarm beeps when flying low.

| Lot | Topic | State |
| --- | --- | --- |
| 1 | Ground alerts on the flight path (GPWS) | done |
| 2 | Jet HUD and jet systems | to do |
| 3 | Camera brain (virtual cameras, blends, noise, dynamic FOV) | to do |

## Lot 1: ground alerts on the flight path

**Why it beeped.** The collision alarm sounded whenever the free-fall (ballistic) impact was under 45 s away.
Flying low on the wings, that is always true: a jet at 150 m has a free-fall impact about 5 s away all the time.
On top of that, the terrain caution sounded on any descent faster than 12 m/s, at any height.

**Now** (`src/game/gpws.ts`, pure and tested in `tests/gpws.test.ts`):

- **Look-ahead along the flight path.** `terrainAhead` gives the seconds until the straight flight path, along
  the velocity over the ground, meets the relief. It samples every 0.5 s up to 6 s, then every 1 s up to 20 s.
  It runs only within 3 km of the ground. The controller computes it in `terrainAheadNow()`
  (`src/controller/motion.ts`) and it reaches the flight info as `terrainAhead`.
- **Which time counts.** On the wings (dynamic pressure above 2 kPa, not stalled, not rocket mode), the time used
  is the shorter of the look-ahead and the straight-down closure. Otherwise (a rocket, a stall) only the closure
  counts.
- **Landing configuration** (gear down, flaps out, or on a final). The landing's sink-rate envelope applies
  instead, as before. The look-ahead triggers a warning only when it is very short. Nothing sounds in the flare
  (below 15 m).
- **The `groundAlerts` setting** (Game › Sound › Ground alerts):

  | Level | Pull-up warning | Terrain caution | Heights and sink rate |
  | --- | --- | --- | --- |
  | Airliner | 7 s ahead | 14 s ahead | always called |
  | Fighter (default) | 4 s ahead | 7 s ahead | only in landing configuration |
  | Off | 2.5 s ahead | none | never |

- **Above 3 km**, the old ballistic collision alarm (impact under 45 s) still applies, and so does the event
  horizon alarm.

### Tests to run on the Macs (manual)

1. **Low pass over flat ground.** Fly the Ranger in plane mode at 150 m and about 250 m/s with the gear up, over
   the Beauce or the sea. Expect no alarm, no "Terrain" and no radio heights.
2. **Ridge ahead.** Fly level at 300 m towards the Alps from Grenoble. Expect the terrain caution tone about
   7 s before the ridge and "Terrain! Pull up!" plus the warning about 4 s before. A pull-up silences both.
3. **Dive.** Push into a 30° dive from 1500 m. Expect the pull-up at about 4 s from the ground, and silence once
   the dive is recovered.
4. **Landing.** On a manual ILS approach with the gear down, expect the heights (300, 100, 50 … 10) and
   "Minimums", no pull-up on the normal glide, and silence in the flare.
5. **Entry autopilot (steep Ranger glide).** Expect no false pull-up, the heights called and the sink rate only
   beyond the envelope.
6. **Airliner level.** Same as test 1. Expect the heights to be called on the way down.
7. **Off level.** Same as test 2. Expect only the last-moment pull-up.
8. **Rocket mode, Lander on the Moon.** No air means no look-ahead. Expect the ballistic alarm above 3 km and the
   ground closure below 3 km.

### Automated

- `bun test tests/gpws.test.ts` covers the look-ahead, the three levels, the landing envelope, rockets, and the
  callouts gated by level.
