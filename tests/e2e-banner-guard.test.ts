import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { headerProblems } from "./e2e/lib/header-check";

// The e2e's banner says what is being tried (docs/E2E.md, the banner — Sam, 16 Nov 2026: « pour que je puisse faire mes remarques
// visuelles sur les e2e que je vois passer, les e2e doivent obligatoirement utiliser le bandeau d'information visible … et le
// scénario en cours »): every e2e file has a header saying what it proves and what it does, its « // Duration: » and
// « // Done when: » lines, and — when it runs through cases (a template title, a loop over places, ends, crafts, dates, weathers) —
// says each one with app.scenario(label). The files written before the rule wait in WAITING, with what they lack; a file touched
// is brought to the rule and taken off the list (the test says when): the list only shrinks, a new file never joins it.

/** The files written before the rule (16 Nov 2026), with what they lacked then. */
const WAITING = new Set([
  "a11y.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "a320-cine.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "a320-ecam.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "a320-gate.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "a320-services.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "a320-sound.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "a320-start.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "aar.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "air-aerosols.e2e.test.ts", // runs through cases without app.scenario(label)
  "air-cost.e2e.test.ts", // no « // Duration: » line
  "air-grain.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "air-ms.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "air-tlut-read.e2e.test.ts", // no « // Done when: » line
  "air-tlut.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "aircraft-autokeys.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "aircraft-save.e2e.test.ts", // no « // Duration: » line
  "approach-charts.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-approach.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-burn.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-climb.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-descent.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-dock.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-entry.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-final.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist-handover.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assist.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "assistlevel.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "atlas.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "audio-space.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "aurora-cost.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "aurora-giants.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "aurora-jupiter.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "aurora-mars.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "aurora-oval.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "autosave-cost.e2e.test.ts", // no « // Duration: » line
  "bakes-loading.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "bh-api.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "boot-debug.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "boot-time.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "buildings.e2e.test.ts", // runs through cases without app.scenario(label)
  "cadence.e2e.test.ts", // runs through cases without app.scenario(label)
  "callouts.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "camera-travel.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "carriers.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "cases.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "character-aaa.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "character.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "city-flicker.e2e.test.ts", // no « // Duration: » line
  "city-shadows.e2e.test.ts", // no « // Duration: » line
  "cloud-amortize.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "cloud-layers-air.e2e.test.ts", // no « // Done when: » line; runs through cases without app.scenario(label)
  "cloud-light-column.e2e.test.ts", // runs through cases without app.scenario(label)
  "cloud-light-volume.e2e.test.ts", // runs through cases without app.scenario(label)
  "cloud-near-field.e2e.test.ts", // runs through cases without app.scenario(label)
  "cloud-occlusion.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "cloud-shadow-c6.e2e.test.ts", // runs through cases without app.scenario(label)
  "cloud-volume-fade.e2e.test.ts", // runs through cases without app.scenario(label)
  "coast-cost.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "coast-flight.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "coast-loading.e2e.test.ts", // no « // Duration: » line
  "coast-refs.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "coast-survey.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "coast-swell.e2e.test.ts", // no « // Done when: » line
  "cockpit-flight.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "cockpit.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "compile-time.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "copilot.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "cost-view.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "course.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-aar.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-actions.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-craft.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-demo-space.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-en.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-lvlh.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-posts.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-space-actions.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-space.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew-stations.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "crew.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "data-meter.e2e.test.ts", // runs through cases without app.scenario(label)
  "day-clouds-mix.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "deckland.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "decoys.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "detail-reach.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "diag-boot.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "dock-undock.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "earth-horizons-truth.e2e.test.ts", // runs through cases without app.scenario(label)
  "earth-horizons.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "earth-scenery.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "earth-surface.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "eclipse-atmosphere.e2e.test.ts", // no header saying what it proves and what it does; no « // Duration: » line; no « // Done when: » line
  "eclipse-raster.e2e.test.ts", // no « // Duration: » line
  "eclipses.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ellipsoid.e2e.test.ts", // no header saying what it proves and what it does; no « // Duration: » line; no « // Done when: » line
  "entry.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-aerobatics.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-body.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-challenges.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-combat.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-flight-ops.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-gunsight.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-high-alpha.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-hud.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-intercept.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-pcd.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-radar.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-sea-trail.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-sound.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "f35-wingmen.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "first-image-downloads.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "fleet-switch.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "flight-quality.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "forest-aaa.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "forest-impostors.e2e.test.ts", // no « // Done when: » line
  "forest-wind.e2e.test.ts", // no « // Done when: » line
  "fps-truth.e2e.test.ts", // no « // Duration: » line
  "frame-guard.e2e.test.ts", // no « // Duration: » line
  "gargantua-circ.e2e.test.ts", // no « // Done when: » line
  "gargantua-ground.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "gcas.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "gear.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ghost.e2e.test.ts", // runs through cases without app.scenario(label)
  "giants-flow.e2e.test.ts", // runs through cases without app.scenario(label)
  "gibraltar-shots.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "golden.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "gpu-recovery-hold.e2e.test.ts", // no « // Duration: » line
  "gpu-recovery.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "grass-aaa.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ground-camera-warp.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ground-details.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ground-placement.e2e.test.ts", // runs through cases without app.scenario(label)
  "ground-planets.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ground-relight.e2e.test.ts", // no « // Done when: » line; runs through cases without app.scenario(label)
  "ground-sunset.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "gtao.e2e.test.ts", // no « // Done when: » line; runs through cases without app.scenario(label)
  "harness.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hidden-tab.e2e.test.ts", // no « // Duration: » line
  "horizon-pilot.e2e.test.ts", // no « // Done when: » line
  "hotas-flight.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hotas.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hub-card.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hub-graph.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hub-warp.e2e.test.ts", // no header saying what it proves and what it does; no « // Duration: » line; no « // Done when: » line
  "hud-clone.e2e.test.ts", // runs through cases without app.scenario(label)
  "hud-kinds.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hud-layout.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "hud-runway.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ign-canopy.e2e.test.ts", // runs through cases without app.scenario(label)
  "instructor.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "instruments-age.e2e.test.ts", // no « // Duration: » line
  "intro.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "iss-moonset.e2e.test.ts", // runs through cases without app.scenario(label)
  "iss-sunset.e2e.test.ts", // runs through cases without app.scenario(label)
  "j2-cover.e2e.test.ts", // runs through cases without app.scenario(label)
  "j2-probes.e2e.test.ts", // runs through cases without app.scenario(label)
  "jetmap.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "jetpad.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "knowledge.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "l4-specular.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "lander-radar.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "landing.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "landscapes.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "lightning-probe.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "link16.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "lite-sky-share.e2e.test.ts", // runs through cases without app.scenario(label)
  "loop-cpu.e2e.test.ts", // no « // Duration: » line
  "low-cover.e2e.test.ts", // runs through cases without app.scenario(label)
  "lowflight-governor.e2e.test.ts", // runs through cases without app.scenario(label)
  "lunar-eclipse-ring.e2e.test.ts", // runs through cases without app.scenario(label)
  "magnetosphere-diagram.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "menus-campaign.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "metar.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "missile-cues.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "missile-view.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "mission.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "missioneditor.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "missionmap.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "modes.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "modifier-keys.e2e.test.ts", // no « // Duration: » line
  "monument-relief.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "moon-telescope.e2e.test.ts", // no « // Duration: » line
  "moons-ground.e2e.test.ts", // runs through cases without app.scenario(label)
  "motion-detail.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "motion-quality.e2e.test.ts", // runs through cases without app.scenario(label)
  "music-panel.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "near-air.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-battle.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-board.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-coop.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-crew.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-dock.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-fleet.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-flight.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-formation.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-gargantua.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-inbound.e2e.test.ts", // runs through cases without app.scenario(label)
  "net-moon.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-orders.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-rooms.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-share.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-shotdown.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "net-space.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-spectate.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-time.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-ui.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-voice.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-walk.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "net-wing-fight.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "night-views.e2e.test.ts", // runs through cases without app.scenario(label)
  "nyc-sunset.e2e.test.ts", // runs through cases without app.scenario(label)
  "observatory.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ortho.e2e.test.ts", // runs through cases without app.scenario(label)
  "pad-rotation.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "pad.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "pause.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "perf-ab.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "perf-fps.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "perf-suite.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "photo-fps.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "photo-video.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "place-docked.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "place.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "plan-views.e2e.test.ts", // runs through cases without app.scenario(label)
  "planet-detail.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "planets-baseline.e2e.test.ts", // runs through cases without app.scenario(label)
  "prefs.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "quals.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "radar-relief.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "radar-select.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "radar-sync.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "radio.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "rain-glass.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "rain.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "ranger-radar.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "raster-companion.e2e.test.ts", // runs through cases without app.scenario(label)
  "raster-diagnose.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "raster-flight.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "raster-motion.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "raster-paths.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "raster-primary.e2e.test.ts", // runs through cases without app.scenario(label)
  "raster-pulse.e2e.test.ts", // runs through cases without app.scenario(label)
  "raster-roads.e2e.test.ts", // no « // Duration: » line
  "raster-shade-ablation.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "rates.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "refr-cost.e2e.test.ts", // no « // Duration: » line
  "refraction-wgs84.e2e.test.ts", // no « // Duration: » line
  "relief-shadows.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "reload.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "resume-point.e2e.test.ts", // no « // Duration: » line
  "runway-mesh.e2e.test.ts", // runs through cases without app.scenario(label)
  "runway-placement.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "runway-wind.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "s1-missions.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "s2-views.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "s3-replay.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "s5.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "saves-storage.e2e.test.ts", // no « // Duration: » line
  "saves.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "scenery-bench.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "scenery-hitboxes.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "school-demos.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "sea-cost.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sea-depth-probe.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sea-fft.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sea-life.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "sea-motion.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sea-pieces.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "sea-repeat.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "sea-sparkle-probe.e2e.test.ts", // no « // Done when: » line
  "sea-sunset.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "season-snow.e2e.test.ts", // runs through cases without app.scenario(label)
  "settings.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "shootdown-gpu.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "shootdown.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sky-events.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sky-open.e2e.test.ts", // no « // Done when: » line; runs through cases without app.scenario(label)
  "sky-showcase.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "smoke.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "snowfall.e2e.test.ts", // runs through cases without app.scenario(label)
  "space-missions.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "space-school.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "space-sensors.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "spectator.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "storm-blotch.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "sunset-incident.e2e.test.ts", // no « // Done when: » line; runs through cases without app.scenario(label)
  "surface-id.e2e.test.ts", // no « // Done when: » line
  "tars-agent-live.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-agent.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-aircraft-tools.e2e.test.ts", // no « // Duration: » line
  "tars-ear.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-eval.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-online.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-orbs.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-reach.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars-voice.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tars.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tcas.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tdc.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "telemetry.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "terrain-fade.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "terrain-raster-hint.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "tile-arrival.e2e.test.ts", // runs through cases without app.scenario(label)
  "tile-memory.e2e.test.ts", // no « // Duration: » line; runs through cases without app.scenario(label)
  "time.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "title-departure.e2e.test.ts", // runs through cases without app.scenario(label)
  "title-foot.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "title-more.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "title-plane.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "title.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "touch.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "traffic-formation.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "traffic-relay.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "traffic-ships.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line; runs through cases without app.scenario(label)
  "trap.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "tree-impostors.e2e.test.ts", // no « // Done when: » line
  "vaisseaux-x1.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "vaisseaux-x5.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "view-pose.e2e.test.ts", // no « // Duration: » line
  "view-reset.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "voice.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "wake-probe.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "walk-raster.e2e.test.ts", // runs through cases without app.scenario(label)
  "war-airbase.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "war-mode.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "weather-grid.e2e.test.ts", // no « // Duration: » line
  "world-runway.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "worlds.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "wormhole-map.e2e.test.ts", // no header saying what it proves and what it does; no « // Duration: » line; no « // Done when: » line
  "wreck-replay.e2e.test.ts", // no « // Duration: » line; no « // Done when: » line
  "zones-scenery.e2e.test.ts", // runs through cases without app.scenario(label)
  "zones-usa-night.e2e.test.ts", // runs through cases without app.scenario(label)
]);

const files = readdirSync("tests/e2e").filter((f) => f.endsWith(".e2e.test.ts") && !f.startsWith("zz-"));

test("every e2e file not waiting has its header (what, Duration, Done when) and says its scenarios", () => {
  const bad = files
    .filter((f) => !WAITING.has(f))
    .map((f) => [f, headerProblems(readFileSync(`tests/e2e/${f}`, "utf8"))] as const)
    .filter(([, p]) => p.length)
    .map(([f, p]) => `${f}: ${p.join("; ")}`);
  expect(bad).toEqual([]);
});

test("a waiting file brought to the rule is taken off the list; the list names only files that exist", () => {
  const done = [...WAITING].filter((f) => files.includes(f) && !headerProblems(readFileSync(`tests/e2e/${f}`, "utf8")).length);
  const gone = [...WAITING].filter((f) => !files.includes(f));
  expect({ "brought to the rule — take them off WAITING": done, "no such file — take them off": gone }).toEqual({
    "brought to the rule — take them off WAITING": [],
    "no such file — take them off": [],
  });
});

test("the judge: a header that says it all passes; each lack named; cases without a scenario caught", () => {
  const good = [
    "// The thing proven at length, what the test does to prove it, flown and measured as said.",
    "// Done when: it ends.",
    "// Duration: ~1 min.",
    'test("a", () => {});',
  ].join("\n");
  expect(headerProblems(good)).toEqual([]);
  expect(headerProblems(good.replace("// Duration: ~1 min.\n", "")).join()).toMatch(/Duration/);
  expect(headerProblems(good.replace("// Done when: it ends.\n", "")).join()).toMatch(/Done when/);
  const loop = "for (const F of L) test(`${F}`, () => {});";
  expect(headerProblems(`${good}\n${loop}`).join()).toMatch(/app.scenario/);
  expect(headerProblems(`${good}\n${loop}\nawait app.scenario(F);`)).toEqual([]);
});
