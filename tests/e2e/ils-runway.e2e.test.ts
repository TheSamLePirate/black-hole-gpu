import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";
import { HELD } from "./lib/held";
import { expectFlightPhase } from "./lib/flight-state";

// The ILS's runway chosen (Sam, 5 Nov 2026: « quand il y a deux pistes, permets de choisir celle pour l'ILS »): the F-35 at
// 1 500 m north-west of Toulon-Hyères (LFTH: 05/23 and 13/31), in French. The airfield's runways as the action lists them
// (camera.ilsRunways: each end, its length, the one in use); then by real input — Tab held, « Approche » (PLAN-APPROCHES AP8), « Piste (LFTH) », the sub-wheel
// of its runways, « 13 » clicked, « Armer l'approche » — the approach engaged on 13, its needles read; then « 05/23 » asked by number (that
// runway, its end in use) and a runway the field lacks refused.
// Output: remote-results/ils-runway/ (IR_OUT): wheel.png, sub-wheel.png, approach.png.
// Done when: the ends listed, 13 flown from the wheel, 05/23 resolved, 18 refused, no GPU error.
// Duration: ~1.5 min.
const OUT = process.env.IR_OUT ?? "remote-results/ils-runway";
afterAll(stopServer);

test.skipIf(!E2E)(
  "ILS: the runway chosen among the airfield's — Toulon-Hyères from the wheel",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1440, height: 900, lang: "fr", hash: "scene=game:artemis", tiles: true });
    const pointAt = async (re: string) => {
      const at = await app.js<{ x: number; y: number } | null>(`(() => {
        const l = [...document.querySelectorAll("[data-testid=wheel] .rw-label")].find((e) => new RegExp(${JSON.stringify(re)}, "i").test(e.textContent));
        if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!at)
        throw new Error(
          `no sector ${re}: ${await app.js<string>(`document.querySelector("[data-testid=wheel]")?.textContent ?? "no wheel"`)}`,
        );
      await app.mouse("move", at.x, at.y);
      return at;
    };
    try {
      await app.js(
        `(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, { traffic: false, earthClouds: 0, f35Invulnerable: true }); return 1; })()`,
      );
      await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
      await app.js(`(() => { __bh.game.setDate("2026-11-05T12:00:00Z"); __bh.game.set("weather", "fair");
        __bh.game.flyAt(43.16, 6.12, 1500, 160, 140); ${HELD} __bh.settings.shipMount = "cockpit"; return 1; })()`);
      // (the airfield's runways: their tile in)
      await app.waitFor(`(__bh.camera.ilsRunways("LFTH")?.ends.length ?? 0) >= 4`, 45_000);
      // (rule 13 of E2E-VOLS: placed as a pilot leaves it — its holds, its thrust, its gear — asserted)
      await expectFlightPhase(app, "cruise", {}, "placed");
      const ch = await app.js<{ field: string; auto: { id: string }; ends: { id: string; len: number; wind: boolean }[] }>(
        `(() => { const c = __bh.camera.ilsRunways("LFTH"); return { field: c.field, auto: { id: c.auto.id }, ends: c.ends.map((e) => ({ id: e.id, len: Math.round(e.len), wind: e.wind })) }; })()`,
      );
      console.log(
        `  ${ch.field}: ${ch.ends.map((e) => `${e.id} ${e.len} m${e.wind ? " (en service)" : ""}`).join(", ")} — auto ${ch.auto.id}`,
      );
      expect(ch.ends.map((e) => e.id)).toEqual(expect.arrayContaining(["05", "23", "13", "31"]));

      // (the wheel — PLAN-APPROCHES AP8: its « Approche » sector, in place of « Navigation › Approche ILS » and its sub-wheel of
      // runways —: Tab held, « Approche », « Piste (LFTH) », « 13 » clicked; then « Armer l'approche »)
      await app.js(`(() => { document.activeElement?.blur?.(); return 1; })()`);
      const tab = { code: "Tab", key: "Tab", windowsVirtualKeyCode: 9 };
      const click = async (re: string) => {
        await pointAt(re);
        await Bun.sleep(200);
        // (aimed again: the screenshot or a slow frame may have moved the pointer — a synthetic move that picked the opposite sector)
        const p = await pointAt(re);
        await app.mouse("down", p.x, p.y);
        await app.mouse("up", p.x, p.y);
      };
      const openApproach = async () => {
        await app.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...tab });
        await app.waitFor(`!!document.querySelector("[data-testid=wheel]")`, 3000);
        await pointAt("^Approche");
        await Bun.sleep(300);
        await app.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...tab });
        await app.waitFor(`/Piste \\(LFTH\\)/.test(document.querySelector("[data-testid=wheel]")?.textContent ?? "")`, 3000);
      };
      await openApproach();
      await pointAt("Piste \\(LFTH\\)");
      await Bun.sleep(300);
      await app.shot(`${OUT}/wheel.png`);
      await click("Piste \\(LFTH\\)");
      await app
        .waitFor(`[...document.querySelectorAll("[data-testid=wheel] .rw-label b")].some((b) => b.textContent === "13")`, 3000)
        .catch(async (e) => {
          await app.shot(`${OUT}/sub-missing.png`);
          console.log(
            `  the wheel then: ${await app.js<string>(`document.querySelector("[data-testid=wheel]")?.textContent ?? "closed"`)}`,
          );
          throw e;
        });
      await pointAt("^13$");
      await Bun.sleep(300);
      await app.shot(`${OUT}/sub-wheel.png`);
      await click("^13$");
      await app.waitFor(`__bh.camera.approachSel.rwy === "13"`, 5000);
      await app.waitFor(`!document.querySelector("[data-testid=wheel]")`, 3000);
      await openApproach();
      await click("^Armer l'approche");
      await app.waitFor(`!!__bh.camera.ilsRun`, 5000);
      const info = await app.js<{ id: string }>(`__bh.camera.ilsInfo()`);
      console.log(`  the wheel's approach: ${info.id}`);
      expect(info.id).toMatch(/ILS 13 LFTH/);
      await Bun.sleep(6000);
      const run = await app.js<{ id: string; phase: string; dme: number }>(`__bh.camera.ilsInfo()`);
      console.log(`  after 6 s: ${run.id}, ${run.phase}, ${run.dme.toFixed(1)} km`);
      await app.shot(`${OUT}/approach.png`);

      // (by number, the way TARS asks: a runway by both ends — its end in use —, one the field lacks refused)
      await app.js(`(__bh.camera.ilsOff(), 1)`);
      const both = await app.js<string>(`__bh.camera.ilsStart("LFTH", { runway: "05/23" })`);
      const inUse = ch.ends.find((e) => (e.id === "05" || e.id === "23") && e.wind)?.id;
      console.log(`  « 05/23 »: ${both} (in use: ${inUse})`);
      expect(both).toMatch(new RegExp(`LFTH ${inUse}`));
      await app.js(`(__bh.camera.ilsOff(), 1)`);
      const none = await app.js<string>(`__bh.camera.ilsStart("LFTH", { runway: "18" })`);
      console.log(`  « 18 »: ${none}`);
      expect(none).toMatch(/pas de piste 18/);
      expect(await app.js<number>(`__bh.renderer.gpuErrors`)).toBe(0);
    } finally {
      await app.close();
    }
  },
  5 * 60_000,
);
