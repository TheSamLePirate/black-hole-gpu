import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

// The static guard of rule 13 (docs/E2E-VOLS.md — Sam, 16 Nov 2026: « les tests e2e en avion doivent être parfaits »): `flyAt` places an
// aircraft with its throttle and its holds as they were — at the boot, 0 and none —; an e2e that then waits (a sleep, a waitFor, the
// data settling) before freezing the simulation, setting a thrust or engaging an autopilot lets it glide at idle meanwhile. Each `flyAt`
// of the e2e is read to the next one (or 80 lines): the first wait must come after the first of those gestures — or the flight be
// stepped (`__bh.step`, the clock frozen). The files not yet brought to the rule are listed below with their owner, and must shrink:
// a new file breaking it is red at once.

/** Not yet brought to rule 13 (16 Nov 2026): their owner fixes them — the list only shrinks. */
const PENDING: Record<string, string> = {
  "approach-sample.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "assistlevel.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "bdtopo.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "buildings.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "canopy-scratches.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "carriers.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "cases.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "cloud-glory.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "coast-loading.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "copilot.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "cost-view.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "course.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "crew-actions.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "crew-en.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "data-meter.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "deckland.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "detail-reach.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "earth-horizons-truth.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "earth-horizons.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "eclipse-raster.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "export-parity.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "f35-body.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "f35-gunsight.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "f35-high-alpha.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "f35-pcd.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "f35-wingmen.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "flight-quality.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "forest-wind.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "gcas.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "geoid.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "ghost.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "gibraltar-shots.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "hlod-cost.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "hlod.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "hud-clone.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "ign-canopy.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "ign-relief.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "instructor.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "j2-page-camera.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "j2-probes.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "j7-approach-ground.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "jetpad.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "kernel-compile.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "knowledge.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "lander-radar.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "lightning-probe.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "lite-sky-share.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "low-rate-offer.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "lowflight-governor.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "lunar-eclipse-ring.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "mapterhorn-world.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "mirage-sun.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "mission.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "missioneditor.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "missionmap.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "moon-telescope.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "motion-blur.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "net-flight.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "net-formation.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "net-orders.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "net-shotdown.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "net-wing-fight.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "ortho-delight.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "ortho.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "overture.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "perf-ab.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "perf-fps.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "quals.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "radar-relief.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "radar-sync.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "radio.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "ranger-radar.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "raster-fine-relief.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "raster-governor.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "raster-motion.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "raster-pulse.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "raster-shade-ablation.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "refraction-wgs84.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "relief-shadows.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "relief-toggle-flight.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "report.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "s1-missions.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "s2-views.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "s3-replay.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "school-demos.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-cost.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-depth-probe.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-fft.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-life.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-marks.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-motion.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sea-repeat.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "shift-m.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "shootdown-gpu.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "shootdown.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "sky-open.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "snowfall.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "sun-behind-deck.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "swisstopo.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "tars-pcd.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "tile-cpu.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "traffic-formation.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "traffic-relay.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "traffic-ships.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "trap.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "undamaged-flight.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "usa-landscapes.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "usa.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "view-reset.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "wake-probe.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "war-mode.e2e.test.ts": "vol (F-35, porte-avions, missions, école, réseau, crew, TARS) — à attribuer par la session d'analyse",
  "weather-grid.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "wreck-replay.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "zones-usa-night.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "zz-bld-probe.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "zz-hold-paris.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "zz-skipship.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
  "zz-sky-real.e2e.test.ts": "session du rendu (rendu, scène, sol, mer, parcours)",
};

const GESTURE =
  /freeze\(true\)|\$\{HELD(_JS)?\}|HELD_JS|__bh\.step\(|apSet\(|jetToggle\(|ilsStart\(|placeJetFrozen\(|placeLow\(|pilot\.throttle\s*=|pilot\.engineNow\s*=|a320ApKey\(|courseStart\(|tankerStart\(|formStart|icptStart\(|startTakeoff|rwyStart|pilotAuto\(|tfStart\(|orbitStart\(|holdStart\(|navToggle\(/;
const WAIT = /Bun\.sleep\(|\bwaitFor\(|\.settled\(|dataSettled\(|setTimeout\(|requestAnimationFrame/;

export function guardFile(src: string): { line: number; why: string }[] {
  const lines = src.split("\n");
  const out: { line: number; why: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/flyAt\(/.test(lines[i]!) || /^\s*\/\//.test(lines[i]!)) continue;
    // (the gesture may sit on the flyAt's own line — `flyAt(...); __bh.freeze(true)` —)
    if (GESTURE.test(lines[i]!.slice(lines[i]!.indexOf("flyAt(")))) continue;
    // (or frozen just before it — `__bh.freeze(true); __bh.game.flyAt(...)`, a line or three above)
    if (/freeze\(true\)/.test([lines[i - 3], lines[i - 2], lines[i - 1], lines[i]!.slice(0, lines[i]!.indexOf("flyAt("))].join(" ")))
      continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 80); j++) {
      const l = lines[j]!;
      if (/^\s*\/\//.test(l)) continue;
      if (/flyAt\(/.test(l)) break;
      if (GESTURE.test(l)) break;
      if (WAIT.test(l)) {
        out.push({ line: i + 1, why: `a wait at line ${j + 1} before any freeze, thrust or autopilot` });
        break;
      }
    }
  }
  return out;
}

test("rule 13: no e2e lets an aircraft glide at idle after flyAt (a wait before a freeze, a thrust or an autopilot)", () => {
  const dir = "tests/e2e";
  const bad: string[] = [];
  const fixed: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".e2e.test.ts"))) {
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const hits = guardFile(src);
    if (hits.length && !PENDING[f]) bad.push(`${f}: ${hits.map((h) => `l. ${h.line} — ${h.why}`).join("; ")}`);
    if (!hits.length && PENDING[f]) fixed.push(f);
  }
  if (bad.length) console.log(`  breaking rule 13:\n    ${bad.join("\n    ")}`);
  if (fixed.length) console.log(`  brought to the rule — take them off PENDING: ${fixed.join(", ")}`);
  expect(bad).toEqual([]);
  expect(fixed).toEqual([]);
});

test("the guard itself: a flyAt then a waitFor is caught; frozen first, or engaged first, is not", () => {
  expect(guardFile("__bh.game.flyAt(1, 2, 900, 90, 150);\nawait app.waitFor(`x`, 5000);")).toHaveLength(1);
  expect(guardFile("__bh.game.flyAt(1, 2, 900, 90, 150); __bh.freeze(true);\nawait app.waitFor(`x`, 5000);")).toHaveLength(0);
  expect(guardFile("__bh.game.flyAt(1, 2, 900, 90, 150);\nc.apSet({ ap: true, athr: true });\nawait Bun.sleep(4000);")).toHaveLength(0);
  expect(guardFile("// __bh.game.flyAt(1, 2, 900, 90, 150);\nawait Bun.sleep(4000);")).toHaveLength(0);
});
