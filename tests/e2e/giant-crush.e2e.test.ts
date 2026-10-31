import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { App, E2E, stopServer } from "./lib/app";

// The crushing in Jupiter's depths (PLAN-PLANETES-AAA P11 D1c): the Ranger, damage on, hovering at rest near the Great Red
// Spot (game.hoverOver) ever deeper — 150 km under the 1 bar level (~30 bar: nothing said), 280 km (~130 bar, past 80 % of
// the 150 its hull holds: the PRESSURE caution on the HUD, the AIR panel's HULL row, the call "climb"), 310 km (~170 bar:
// the hull gives way — the craft lost, said with its bars on the craft-lost screen). The cockpit shot at 280 km, the
// craft-lost screen shot.
// Duration: ~3 min on kerr-mini
// Done when: the craft-lost screen read.

const OUT = "remote-results/giant-crush";
const T0 = 109.6;
const SPM = 492.5490947;
const TURN = (9.925 * 3600) / SPM;
const T_PM = T0 + 49.7 + 0.12 * TURN;
afterAll(stopServer);

test.skipIf(!E2E)(
  "down into Jupiter until the hull gives way: the caution, the HULL row and the call first, then the craft lost",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const app = await App.boot({ width: 1600, height: 1000, hash: `scene=${encodeURIComponent("Jupiter: from orbit")}` });
    try {
      await app.js(`(() => { const c = __bh.camera, prev = c.onPilotMessage; window.__calls = [];
        c.onPilotMessage = (t) => { window.__calls.push(t); prev?.(t); }; return 1; })()`);
      await app.js(`(() => { __bh.presets.zzc = { ...__bh.presets["Jupiter: from orbit"], time: ${T_PM}, target: "jupiter", ship: true, fov: 70 };
        __bh.game.preset("zzc"); Object.assign(__bh.settings, { animate: true, damage: true, crashSpeed: 1e9, dynamicResolution: false, showFps: true, dof: false, motionBlur: 0 });
        return 1; })()`);
      await app.settled();
      const lost = () => app.js<string | null>(`document.querySelector(".craft-lost .cl-why")?.textContent ?? null`);
      const stage = async (h: number) => {
        const note = await app.js<string>(
          `(() => { const n = __bh.game.hoverOver("jupiter", -12, 126.4, ${h}); __bh.settings.shipMount = "cockpit"; return n; })()`,
        );
        console.log(`  ${note}`);
        await app.js(
          `(async () => { for (let i = 0; i < 40; i++) { __bh.touch(); await new Promise((q) => requestAnimationFrame(q)); } return 1; })()`,
        );
        const r = await app.js<{
          p: number;
          max: number;
          share: number;
          hull: number;
          panel: { title: string; rows: { label: string; value: string; tone?: string }[] } | null;
          alerts: string[];
          mount: string;
          calls: string[];
          failure: string | null;
        }>(
          `(() => { const i = __bh.camera.flightInfo?.(); const c = window.__calls; window.__calls = []; const A = __bh.camera.airFlight;
            return { p: A.pressure().p, max: A.pressure().max, share: A.margins().p, hull: A.skin.hull, panel: i?.craftPanel ?? null,
              alerts: (__bh.flight.hud.alerts ?? []).map((a) => a.level + ":" + a.id + ":" + a.text), mount: __bh.settings.shipMount, calls: c,
              failure: A.failure }; })()`,
        );
        const row = r.panel?.rows.find((x) => x.label === "HULL" || x.label === "COQUE");
        console.log(
          `  ${h} km: ${(r.p / 1e5).toFixed(0)} bar of ${(r.max / 1e5).toFixed(0)} (${(r.share * 100).toFixed(0)} %), hull ${r.hull.toFixed(0)} K · panel ${r.panel?.title ?? "none"} HULL ${row ? `${row.value} ${row.tone}` : "—"} · ${r.mount} · alerts ${JSON.stringify(r.alerts)} · calls ${JSON.stringify(r.calls)} · failure ${r.failure}`,
        );
        return { ...r, row };
      };
      // (150 km down: ~30 bar — a fifth of what the hull holds: nothing said)
      const a = await stage(-150);
      expect(a.share).toBeGreaterThan(0.1);
      expect(a.share).toBeLessThan(0.4);
      expect(a.alerts.some((x) => x.includes(":crush:"))).toBe(false);
      expect(a.failure).toBeNull();
      // (280 km: past 80 % — the caution, the HULL row orange, the call)
      const b = await stage(-280);
      expect(b.share).toBeGreaterThan(0.8);
      expect(b.share).toBeLessThan(1);
      expect(b.alerts.some((x) => x.startsWith("caution:crush:") || x.startsWith("warning:crush:"))).toBe(true);
      expect(b.row?.tone).toBe("warn");
      expect(b.calls.some((x) => /Hull pressure|Pression sur la coque/.test(x))).toBe(true);
      expect(b.failure).toBeNull();
      await app.settled();
      await app.shot(`${OUT}/cockpit-280km.png`);
      // (310 km: ~170 bar — the hull gives way, the craft lost)
      const c = await stage(-310);
      expect(c.failure).toContain("crushed");
      const why = await lost();
      console.log(`  craft lost: ${why}`);
      expect(why).toContain("crushed");
      await app.shot(`${OUT}/lost-310km.png`);
    } finally {
      app.close();
    }
  },
  1_200_000,
);
