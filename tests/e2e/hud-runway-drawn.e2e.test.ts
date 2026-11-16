import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App, E2E, stopServer } from "./lib/app";
import { HUD_RUNWAY_GAP_JS, type RunwayGap } from "./lib/hud-runway-gap";

// The HUD's runway outline on the runway drawn (Sam, 16 Nov 2026: « dans certains e2e, la piste du HUD n'est pas alignée avec la vraie
// piste — c'est normal ? »): the F-35 lined up on a runway's threshold, then frozen 3 km out on its final 160 m up; each time the
// outline's corners (controller/lowthrust.ts runwayView: its site, heading, level) against the drawn and levelled strip's
// (game/sites.ts EARTH_RUNWAYS, the ground drawn there) — across, along, up, and the angle at the eye — for the runway in view and
// its airport's others (AP7a). Le Bourget 25 and Edwards 23L (the game's sites, the world's other runways round them), Toulon-Hyères
// 05 (a world runway, the geoid 49 m over the ellipsoid there), Madrid-Barajas (a world runway, no national imagery).
// Captures (HR_SHOTS=<dir>): the cockpit at the threshold and on the final.
// Done when: every outline within 0.15° of its strip at the eye, the threshold within 3 m across, the heading within 0.05° (a game
// site's other runways, with no strip of ours — the photograph's alone —, listed).
// Duration: about 3 min (four airfields' tiles; frozen placings, nothing flown).

const SHOTS = process.env.HR_SHOTS;
const LIMIT = { deg: 0.15, across: 3, hdg: 0.05 };

describe.skipIf(!E2E)("the HUD's runway on the runway drawn", () => {
  let app: App;
  const all: { where: string; gaps: RunwayGap[] }[] = [];
  beforeAll(async () => {
    app = await App.boot({ width: 1440, height: 900, hash: "scene=game:artemis", tiles: true });
    await app.waitFor("__bh.camera.piloting", 60_000);
    await app.js(
      `(() => { Object.assign(__bh.settings, { vessel: "f35", traffic: false, damage: false, weather: "fair", wind: 0, hudRunwaysAll: true }); __bh.game.setDate("2026-07-10T11:00:00Z"); return 1; })()`,
    );
    await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
  }, 180_000);
  afterAll(() => {
    app?.close();
    stopServer();
  });

  const measure = async (where: string, label: string) => {
    await app.scenario(`${where} · ${label}`);
    await app.settled(60_000).catch(() => {});
    // (the relief and the photographs in, frozen meanwhile: measured while Edwards's relief still came in, the ground drawn under
    // its other runways stood in bumps of 24–55 m, flat 8 s later)
    await app.dataSettled(`${where} — ${label}`);
    await app.js("(() => { for (let i = 0; i < 3; i++) __bh.step(1 / 30); return 1; })()");
    const gaps = (await app.js<RunwayGap[] | null>(HUD_RUNWAY_GAP_JS)) ?? [];
    all.push({ where: `${where} — ${label}`, gaps });
    console.log(`  ${where} — ${label}:`);
    for (const g of gaps) console.log(`    ${JSON.stringify(g)}`);
    if (SHOTS) {
      await Bun.$`mkdir -p ${SHOTS}`;
      await app.js(
        "(async () => { __bh.freeze(false); const f = () => new Promise((q) => requestAnimationFrame(q)); for (let i = 0; i < 4; i++) await f(); __bh.freeze(true); return 1; })()",
      );
      await app.shot(`${SHOTS}/${where.replace(/\W+/g, "-")}-${label.replace(/\W+/g, "-")}.png`);
    }
    return gaps;
  };

  /** lined up (frozen), measured; then 3 km out on the same final, 160 m up, frozen, measured */
  const field = async (where: string, near?: [number, number], noonUtc = 11) => {
    // (by day there: the photograph seen)
    await app.js(`(() => { __bh.game.setDate("2026-07-10T${String(noonUtc).padStart(2, "0")}:00:00Z"); return 1; })()`);
    if (near) {
      // (a world airfield: its tile brought in first, the jet frozen over it)
      await app.js(`(() => { __bh.freeze(true); __bh.game.flyAt(${near[0]}, ${near[1]}, 1500, 0, 150); return 1; })()`);
      await app.waitFor(`(() => { try { __bh.game.lineUp(${JSON.stringify(where)}); return true; } catch { return false; } })()`, 60_000);
    }
    const said = await app.js<string>(
      `(() => { __bh.freeze(true); const s = __bh.game.lineUp(${JSON.stringify(where)}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset(); return s; })()`,
    );
    console.log(`  ${said}`);
    await measure(where, "threshold");
    await app.js(`(() => { const c = __bh.camera, v = c.runwayView(), s = v.site, R = Math.PI / 180, d = (3000 + v.along) / 6371000;
      const b = ((s.rwy + 180) % 360) * R, la = s.lat * R, lo = s.lon * R;
      const lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
      const lon = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
      __bh.game.flyAt(lat / R, lon / R, 160, s.rwy, 75); c.gearDown = true; __bh.refresh(); c.viewReset(); return 1; })()`);
    await measure(where, "final 3 km");
  };

  test("Le Bourget 25 (a game site), threshold and final", async () => {
    await field("Paris – Le Bourget");
  }, 240_000);

  test("Edwards 23L and its other runways (a game site, the world's round it)", async () => {
    await field("Edwards", undefined, 19);
  }, 240_000);

  test("Toulon-Hyères (a world runway, the geoid +49 m)", async () => {
    await field("LFTH", [43.05, 6.1]);
  }, 240_000);

  test("Madrid-Barajas (a world runway, no national imagery)", async () => {
    await field("LEMD", [40.4, -3.6]);
  }, 240_000);

  test("every outline on its strip", () => {
    const bad: string[] = [];
    for (const m of all)
      for (const g of m.gaps) {
        // (a game site's airport's other runways — Le Bourget's 03/21 and 09/27, Edwards's 05L/23R and 07/25 —: no strip of
        // ours drawn or levelled, the photograph's alone; the outline OurAirports' — said, not judged here)
        if (!g.drawn) {
          // (no strip of ours — the photograph's alone —: its height against the ground drawn judged)
          console.log(
            `  · ${m.where} ${g.name}: no strip drawn; the outline ${g.upOnly} m off the ground at worst (${g.worstDeg}° at the eye)`,
          );
          if (g.worstDeg > LIMIT.deg)
            bad.push(`${m.where} ${g.name}: its outline ${g.upOnly} m off the ground (${g.worstDeg}° at the eye)`);
          continue;
        }
        if (g.worstDeg > LIMIT.deg) bad.push(`${m.where} ${g.name}: ${g.worstDeg}° at the eye (${g.dist} m)`);
        if (Math.abs(g.thr.across) > LIMIT.across) bad.push(`${m.where} ${g.name}: threshold ${g.thr.across} m across`);
        if (Math.abs(g.hdg) > LIMIT.hdg) bad.push(`${m.where} ${g.name}: heading ${g.hdg}° off`);
      }
    for (const b of bad) console.log(`  ✗ ${b}`);
    expect(bad).toEqual([]);
  });
});
