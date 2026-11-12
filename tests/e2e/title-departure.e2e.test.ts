import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, E2E, stopServer } from "./lib/app";

// CM3 (docs/PLAN-CHARGEMENT-MONDE.md): the departure's relief as the player first sees it. The title opened as a player gets it
// (a fresh profile, the Service Worker on), By plane › Free flight (its default field: Edwards), the title left open TD_TITLE_S
// seconds (8: the player choosing), then Fly: every quarter second the entry's veil (its phase), the relief's windows drawn —
// each level's drawn rectangle over its window, their mean over the levels wanted (the share of the view at the level it
// wants) —, the finest level drawn, the tiles pending; when the first tile was asked against the click (negative: asked
// before it — preloaded). Said: that share when the veil lifts (the first image of the flight) and 10 s later. CM3: leaving the
// free flight for the title's main screen must drop the departure and its relief windows (checked once, before the wait).
// Output: remote-results/title-departure/title-departure-<side><run>.json, a screenshot at the lift.
// Done when: the veil has lifted and 10 s more are watched (90 s at most from the click, what is missing said), no GPU error.
// Duration: ~1.5–2 min (one cold launch, the tracer's compile).
const OUT = process.env.TD_OUT ?? "remote-results/title-departure";
const TAG = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? "0"}`;
const TITLE_S = Number(process.env.TD_TITLE_S ?? 8);
const SW = process.env.TD_SW !== "0";
/** the airfield chosen on the title by its list (a search: "LFPB", "bourget"…; none: the default, Edwards) */
const FIELD = process.env.TD_FIELD ?? "";
afterAll(stopServer);

type Row = { s: number; phase: string; maps: string | null; share: number; finest: number; pending: number; levels: number };

test.skipIf(!E2E)(
  "CM3: the departure's relief drawn when the veil lifts on a free flight launched from the title",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const profile = mkdtempSync(join(tmpdir(), "kerr-departure-"));
    const app = await App.boot({ width: 1280, height: 800, tiles: true, sw: SW, profile });
    const rows: Row[] = [];
    let summary: Record<string, unknown> = {};
    try {
      if (SW) await app.js(`__bh.pwa?.ready() ?? false`);
      await app.waitFor(`!!document.querySelector("[data-testid=title-mode-plane]") && !!window.__bh?.renderer`, 60_000);
      await Bun.sleep(500);
      await app.click("[data-testid=title-mode-plane]");
      await app.waitFor(`!!document.querySelector(".tt-root [data-mode=plane]")`, 5000);
      await Bun.sleep(400);
      await app.click("[data-testid=title-tab-free]");
      await app.waitFor(`document.querySelector(".tt-root [data-mode=plane]")?.dataset.tab === "free"`, 3000);
      // (CM3: leaving the free flight drops the departure — the title's main screen, then back to By plane › Free flight)
      await app.waitFor(`!!__bh.renderer.departure`, 10_000);
      await app.press("Escape");
      await app.waitFor(`__bh.menu.state().title === "title"`, 5000);
      await Bun.sleep(300);
      const dropped = await app.js<{ departure: boolean; windows: number }>(`(() => ({ departure: !!__bh.renderer.departure,
        windows: __bh.renderer.earthTiles.levels.filter((L) => L.want).length }))()`);
      if (dropped.departure || dropped.windows) throw new Error(`the departure kept after leaving By plane: ${JSON.stringify(dropped)}`);
      await app.click("[data-testid=title-mode-plane]");
      await app.waitFor(`document.querySelector(".tt-root [data-mode=plane]")?.dataset.tab === "free"`, 5000);
      if (FIELD) {
        await app.click("[data-testid=title-flight-field]");
        await app.waitFor(`!!document.querySelector("[data-testid=title-field-search]")`, 5000);
        await Bun.sleep(400);
        await app.js(`(() => { const i = document.querySelector("[data-testid=title-field-search]"); i.value = ${JSON.stringify(FIELD)};
          i.dispatchEvent(new Event("input")); return true; })()`);
        const found = await app.js<string>(`document.querySelector(".tt-fields button")?.dataset.testid ?? ""`);
        if (!found) throw new Error(`no airfield found for "${FIELD}"`);
        await app.click(`[data-testid=${found}]`);
        await app.waitFor(`!!document.querySelector(".tt-root [data-mode=plane]")`, 5000);
      }
      // (the player choosing: the title open on the free flight)
      await Bun.sleep(TITLE_S * 1000);
      // (what the title's departure — CM3 — asked meanwhile: the tiles asked and drawn, the Earth's maps, the coarse relief)
      const before = await app.js<Record<string, unknown>>(`(() => { const r = __bh.renderer, a = r.earthTiles.arrivals.list();
        return { asked: a.length, drawn: a.filter((x) => x.drawn !== undefined).length, departure: !!r.departure,
          maps: r.earthMaps?.tier ?? null, ready: r.departureReady?.() ?? null, field: document.querySelector("[data-testid=title-flight-field] b")?.textContent ?? "" }; })()`);
      await app.js(`(() => { window.__tdT0 = performance.now(); return 1; })()`);
      await app.click("[data-testid=title-flight-fly]");
      const t0 = Date.now();
      let seen = false,
        liftAt: number | null = null;
      for (;;) {
        const r = await app.js<Omit<Row, "s">>(`(() => {
          const t = __bh.renderer.earthTiles, v = document.querySelector("[data-testid=entry]");
          const area = (q) => (q ? (q.x1 - q.x0) * (q.y1 - q.y0) : 0);
          let sum = 0, n = 0;
          for (const L of t.levels) { if (!L.want) continue; n++; sum += Math.min(1, area(L.valid) / Math.max(area(L.want), 1)); }
          return { phase: v ? v.dataset.phase ?? "?" : "gone", maps: __bh.renderer.earthMaps?.tier ?? null, share: n ? +(sum / n).toFixed(3) : 0, finest: t.finest, pending: t.pending, levels: n }; })()`);
        const s = (Date.now() - t0) / 1000;
        rows.push({ s, ...r });
        if (r.phase !== "gone") seen = true;
        if (liftAt === null && seen && (r.phase === "out" || r.phase === "gone")) {
          liftAt = s;
          await app.shot(`${OUT}/${TAG}-lift.png`).catch(() => undefined);
        }
        if ((liftAt !== null && s > liftAt + 10) || s > 90) break;
        await Bun.sleep(250);
      }
      const at = (when: number | null) => (when === null ? null : (rows.find((r) => r.s >= when) ?? rows[rows.length - 1]!));
      const lift = at(liftAt);
      const later = at(liftAt === null ? null : liftAt + 10);
      const first = await app.js<number | null>(`(() => { const a = __bh.renderer.earthTiles.arrivals.list();
        return a.length ? +((Math.min(...a.map((r) => r.req)) - window.__tdT0) / 1000).toFixed(2) : null; })()`);
      summary = {
        titleS: TITLE_S,
        sw: SW,
        before,
        firstAskedS: first,
        liftS: liftAt === null ? null : +liftAt.toFixed(1),
        // (CM3: what the veil waited for — the departure's ground "ready", "timeout" past 15 s, "none")
        wait: await app.js(`__bh.entry.lastWait ?? null`),
        atLift: lift,
        after10: later,
        source: await app.js(`__bh.renderer.earthTiles.nationalAt`),
        droppedOnLeave: true,
        arrivals: await app.js(`__bh.renderer.earthTiles.arrivals.stats()`),
        gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
      };
      console.log(`  ${TAG}: ${JSON.stringify({ ...summary, arrivals: undefined })}`);
      if (liftAt === null) console.log(`  ${TAG}: the veil never lifted within 90 s (phase ${rows[rows.length - 1]?.phase})`);
    } finally {
      writeFileSync(`${OUT}/title-departure-${TAG}.json`, JSON.stringify({ tag: TAG, summary, rows }));
      await app.quit();
      rmSync(profile, { recursive: true, force: true });
    }
    expect(summary.liftS).not.toBeNull();
    expect(summary.gpuErrors).toBe(0);
  },
  4 * 60_000,
);
