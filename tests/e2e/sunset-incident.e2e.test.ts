import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { readPng } from "./lib/png";

// R3 — the two Suns (docs/PLAN-REFRACTION-HORIZONS.md, contract C0-5): at sunset, in the raster pipeline from the F-35's
// cockpit looking east — the slopes facing the setting Sun, their last light —, no clouds, the HUD hidden, the clock moved in
// steps (Biarritz every 30 s, Chamonix every 60 s), each step drawn with the incident Sun (renderer.incidentSunOn) and without
// it: the ground's mean luminance (the band above the cockpit, 30–60 % of the height) and the Sun's true, apparent and
// lighting altitudes (__bh.camera.skyInfo). Done when: the ground's light falls without a jump while the disc sets (with the
// incident Sun it lasts until the disc is gone; without it, it went with the true Sun's centre), and a low eclipse (Burgos,
// 12 Aug 2026) draws the same with and without it. Shots every 2 min (on and off) in remote-results/sunset-incident.
// Duration: ~8 min (this Mac, its shaders cached).
const OUT = "remote-results/sunset-incident";
afterAll(stopServer);

const SITES = [
  { name: "biarritz", at: [43.45, -1.52, 1500, 120, 140], from: "2026-06-21T19:40:00Z", to: "2026-06-21T20:06:00Z", step: 30 },
  { name: "chamonix", at: [45.9, 6.85, 450, 110, 120], from: "2026-07-10T18:30:00Z", to: "2026-07-10T19:30:00Z", step: 60 },
];
const lum = (png: Uint8Array, from = 0.3, to = 0.6) => {
  const p = readPng(png);
  let s = 0,
    n = 0;
  for (let y = Math.floor(p.height * from); y < Math.floor(p.height * to); y += 2)
    for (let x = 0; x < p.width; x += 2) {
      const o = (y * p.width + x) * p.channels;
      s += 0.2126 * p.data[o]! + 0.7152 * p.data[o + 1]! + 0.0722 * p.data[o + 2]!;
      n++;
    }
  return +(s / n).toFixed(2);
};

test.skipIf(!E2E)(
  "the incident Sun at sunset: the ground's light falls with the disc, a low eclipse unchanged",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true });
    const capture = async () => {
      const { data } = await app.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      return Buffer.from(data, "base64");
    };
    const all: Record<string, unknown[]> = {};
    for (const site of SITES) {
      await app.load("scene=game:artemis");
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}, { earthClouds: 0 }); document.getElementById("overlay").style.visibility = "hidden"; return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate(${JSON.stringify(site.from)}); return 1; })()`);
      const place = `__bh.game.flyAt(${site.at.join(", ")}); __bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`;
      await app.js(`(() => { ${place} __bh.freeze(true); return 1; })()`);
      const tilesIn = await app.waitFor(`__bh.renderer.earthTiles.pending === 0 && __bh.renderer.earthTiles.finest >= 14`, 60_000).then(
        () => true,
        () => false,
      );
      if (!tilesIn) console.log(`  ${site.name}: tiles still pending after 60 s — measured all the same`);
      await app.js(`(() => { ${place} return 1; })()`);
      await app.settled();
      const rows: Record<string, unknown>[] = [];
      for (let t = Date.parse(site.from), k = 0; t <= Date.parse(site.to); t += site.step * 1000, k++) {
        await app.js(`(() => { __bh.game.setDate(${JSON.stringify(new Date(t).toISOString())}); return 1; })()`);
        const stamp = new Date(t).toISOString().slice(11, 19);
        const row: Record<string, unknown> = { t: stamp };
        for (const on of [true, false]) {
          await app.js(`(() => { __bh.renderer.incidentSunOn = ${on}; __bh.touch(); return 1; })()`);
          await app.js(
            "new Promise((r) => { let n = 0; const f = () => { __bh.touch(); if (++n < 20) requestAnimationFrame(f); else r(1); }; f(); })",
          );
          const png = await capture();
          row[on ? "ground" : "groundOff"] = lum(png);
          if (k % Math.max(1, Math.round(120 / site.step)) === 0)
            await Bun.write(`${OUT}/${site.name}-${stamp.replace(/:/g, "")}-${on ? "on" : "off"}.png`, png);
        }
        const sky = await app.js<{ alt: number; apparent: number; light: number }>(
          `(() => { const s = __bh.camera.skyInfo().sun; return { alt: s.altDeg, apparent: s.apparentAltDeg, light: s.lightAltDeg }; })()`,
        );
        Object.assign(row, sky);
        rows.push(row);
        console.log(
          `  ${site.name} ${row.t}: Sun ${sky.alt}° (seen ${sky.apparent}°, light ${sky.light}°) ground ${row.ground} / off ${row.groundOff}`,
        );
      }
      all[site.name] = rows;
      writeFileSync(`${OUT}/sunset-incident.json`, JSON.stringify(all, null, 1));
      // (the ground's light without a jump: no step between two neighbours over a quarter of the start's)
      const g = rows.map((r) => r.ground as number);
      const jump = Math.max(...g.slice(1).map((v, i) => Math.abs(v - g[i]!)));
      console.log(`  ${site.name}: the largest step of the ground's light ${jump.toFixed(2)} (start ${g[0]})`);
      expect(jump).toBeLessThan(Math.max(0.25 * g[0]!, 8));
    }
    // (a low eclipse: Burgos, 12 Aug 2026, the Sun ~10° up — drawn alike with and without the incident Sun)
    await app.load(`scene=${encodeURIComponent("Earth: total eclipse over Burgos, 12 Aug 2026")}`);
    await app.js(`(() => { __bh.freeze(true); return 1; })()`);
    await app.waitFor(`__bh.renderer.earthTiles.pending === 0`, 60_000).catch(() => console.log("  Burgos: tiles pending after 60 s"));
    await app.settled();
    const shots: Uint8Array[] = [];
    for (const on of [true, false]) {
      await app.js(`(() => { __bh.renderer.incidentSunOn = ${on}; __bh.touch(); return 1; })()`);
      await app.js(
        "new Promise((r) => { let n = 0; const f = () => { __bh.touch(); if (++n < 30) requestAnimationFrame(f); else r(1); }; f(); })",
      );
      const png = await capture();
      shots.push(png);
      await Bun.write(`${OUT}/burgos-eclipse-${on ? "on" : "off"}.png`, png);
    }
    const sky = await app.js<{ alt: number; light: number }>(
      `(() => { const s = __bh.camera.skyInfo().sun; return { alt: s.altDeg, light: s.lightAltDeg }; })()`,
    );
    const a = lum(shots[0]!, 0, 1),
      b = lum(shots[1]!, 0, 1);
    console.log(`  Burgos eclipse: Sun ${sky.alt}° (light ${sky.light}°), image mean ${a} with, ${b} without`);
    all.burgos = [{ ...sky, with: a, without: b }];
    writeFileSync(`${OUT}/sunset-incident.json`, JSON.stringify(all, null, 1));
    expect(Math.abs(a - b)).toBeLessThan(0.02 * Math.max(a, 1) + 0.5);
    app.close();
  },
  15 * 60_000,
);
