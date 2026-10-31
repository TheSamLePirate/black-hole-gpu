import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The descent into Jupiter as the cockpit tells it (PLAN-PLANETES-AAA P11 D5): the Ranger near the Great Red Spot in its
// afternoon, hovering at rest (game.hoverOver: carried by the planet's turning — placed by a scene's pose it met the air at
// the equator's 12 km/s, 40 g), from 25 km over the 1 bar level down to 22 bar, in stages — over the clouds, in the ammonia's, under them, at
// 1 bar, in the hydrosulfide's, in the water's, at 10 bar, at Galileo's last 22 —: the AIR panel's figures at each
// (pressure, temperature, the deck, the Sun's light left), the calls heard on the way (each deck entered, 1, 10, 22 bar,
// the Sun gone), the hover held over the place (its drift), the cockpit and the chase view — the HUD and its panel — shot at
// 2 km under 1 bar and at 22 bar.
// Duration: ~4 min on kerr-mini
// Done when: the 22 bar stage read and its calls checked.

const OUT = "remote-results/giant-descent";
const T0 = 109.6;
const SPM = 492.5490947;
const TURN = (9.925 * 3600) / SPM;
const T_PM = T0 + 49.7 + 0.12 * TURN;
const STAGES = (process.env.STAGES ?? "25,15,2,-2,-18,-50,-88,-132").split(",").map(Number);
afterAll(stopServer);

test.skipIf(!E2E)(
  "down into Jupiter: the AIR panel at each stage, the calls on the way",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}` });
    // (the pilot's messages kept as they come — the calls)
    await app.js(`(() => { const c = __bh.camera, prev = c.onPilotMessage; window.__calls = [];
      c.onPilotMessage = (t) => { window.__calls.push(t); prev?.(t); }; return 1; })()`);
    // (the scene once — the Ranger aboard, the afternoon —, then each stage the craft put at rest over the place, hovering:
    // carried by the planet's turning, its air still about it)
    await app.js(`(() => { __bh.presets.zzg = { ...__bh.presets["Jupiter: from orbit"], time: ${T_PM}, target: "jupiter", ship: true, fov: 70 };
      __bh.game.preset("zzg"); Object.assign(__bh.settings, { animate: true, damage: false, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0 });
      return 1; })()`);
    await app.settled();
    const seen: string[] = [];
    for (const h of STAGES) {
      const note = await app.js<string>(
        `(() => { const n = __bh.game.hoverOver("jupiter", -12, 126.4, ${h}); __bh.settings.shipMount = "cockpit"; return n; })()`,
      );
      console.log(`  ${note}`);
      // (a few frames there: the calls' step, the panel)
      await app.js(
        `(async () => { for (let i = 0; i < 40; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
      );
      // (the hover held over the place, carried by the turning — not against the stars: 12 km/s off)
      const drift = await app.js<number>("__bh.camera.hubNote?.drift ?? -1");
      console.log(`  hover drift ${drift.toFixed(1)} m/s`);
      if (h <= 15) expect(drift).toBeLessThan(50);
      const r = await app.js<{
        air: { h: number; p: number; T: number; deck: string | null; sun: number } | null;
        panel: { title: string } | null;
        mount: string;
        calls: string[];
      }>(
        `(() => { const i = __bh.camera.flightInfo?.(); const c = window.__calls; window.__calls = [];
          return { air: __bh.camera.giantAirFigures?.() ?? null, panel: i?.craftPanel ?? null, mount: __bh.settings.shipMount, calls: c }; })()`,
      );
      seen.push(...r.calls);
      const a = r.air;
      console.log(
        `  ${h} km: ${a ? `${(a.h / 1e3).toFixed(1)} km, ${(a.p / 1e5).toFixed(2)} bar, ${a.T.toFixed(0)} K, ${a.deck ?? "—"}, Sun ${(a.sun * 100).toFixed(1)} %` : "—"}` +
          ` · panel ${r.panel?.title ?? "none"} · ${r.mount} · calls ${JSON.stringify(r.calls)}`,
      );
      if (h <= 15) {
        expect(a).not.toBeNull();
        expect(r.panel?.title).toBe("AIR");
      }
      if (h === -2 || h === -132) {
        await app.settled();
        await app.shot(`${OUT}/cockpit-${h}km.png`);
        // (the chase view: the HUD over the image, its AIR panel — once the altitude tape's infinite scale hung the page)
        await app.js(
          `(async () => { __bh.settings.shipMount = "chase"; for (let i = 0; i < 40; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
        );
        await app.settled();
        await app.shot(`${OUT}/chase-${h}km.png`);
        await app.js(`(() => { __bh.settings.shipMount = "cockpit"; return 1; })()`);
      }
      if (h === -132) {
        expect(a!.p / 1e5).toBeGreaterThan(21);
        expect(a!.T).toBeGreaterThan(400);
      }
    }
    // (the calls on the way down: the three decks, 1, 10, 22 bar, the Sun gone)
    const has = (s: RegExp) => seen.some((x) => s.test(x));
    expect(has(/ammonia ice|glace d'ammoniac/i)).toBe(true);
    expect(has(/hydrosulfide|hydrosulfure/i)).toBe(true);
    expect(has(/water clouds|nuages d'eau/i)).toBe(true);
    expect(has(/^(One bar|Un bar)/)).toBe(true);
    expect(has(/^(Ten bar|Dix bars)/)).toBe(true);
    expect(has(/Galileo/)).toBe(true);
    expect(has(/Sun is gone|Soleil a disparu/)).toBe(true);
    app.close();
  },
  1_200_000,
);
