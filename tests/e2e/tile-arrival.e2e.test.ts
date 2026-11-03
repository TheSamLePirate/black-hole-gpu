import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, E2E, stopServer } from "./lib/app";
import { EARTH_SETTINGS } from "./lib/plan-views";
import { tileReplay } from "./lib/tile-replay";

// T8 — the relief's arrival over Aubrac (docs/PLAN-REFRACTION-HORIZONS.md T8: "the time to a defined visible quality"), as a
// player gets it — the Service Worker on —: a first visit (cold), then a return on the same Chrome profile (warm: the
// worker's tile cache). The F-35 at 120 m over the plateau, frozen; every half second each level's window: its tiles in, and
// whether the tracer draws it — a level is drawn only once its whole window is in (earth-tiles.ts complete → valid) —, the
// IGN's relief's share on z 15–17 (its heights' mark). Said: when each level is drawn, their mean (the visible quality's
// pace: a level not drawn is the coarser one's ground), Terrarium's z 14, the IGN's z 15–17 whole; and when each began to
// be drawn (firstAt: T8i draws a window's tiles in round the camera's before the whole); and the view's quality — a fan of
// 384 rays over the ground the cockpit sees, each the level its footprint wants against the finest drawn there, 2^(drawn −
// wanted) averaged —: when it reaches 90 % and 99 %, its mean over the first 30 s.
// TA_REPLAY=<dir>: one pass, the Service Worker off, the tiles' hosts answered from <dir> after TA_DELAY_MS (300) —
// TA_RECORD=1 fills <dir> first, at once (lib/tile-replay.ts: the missing ones fetched by Bun and kept): the loads' order A/B'd on the same answers, the network out.
// Output: remote-results/tile-arrival/tile-arrival-<side><run>.json (AB_SIDE, AB_RUN: an A/B through scripts/ab-e2e.ts).
// Done when: both passes watched until every level is drawn and nothing is pending (60 s a pass at most, what is missing
// said), no GPU error.
// Duration: ~1.5–2.5 min (two launches; the cold pass the network's).
const OUT = process.env.TA_OUT ?? "remote-results/tile-arrival";
const TAG = `${process.env.AB_SIDE ?? "X"}${process.env.AB_RUN ?? "0"}`;
const CAP_S = Number(process.env.TA_CAP_S ?? 60);
const REPLAY = process.env.TA_REPLAY;
const RECORD = process.env.TA_RECORD === "1";
const DELAY_MS = Number(process.env.TA_DELAY_MS ?? 300);
afterAll(stopServer);

type Row = { s: number; pending: number; quality: number; levels: Record<string, [number, number, number, number, number]> };

test.skipIf(!E2E)(
  "T8: the relief's levels drawn over Aubrac, cold then warm — when each comes, their mean",
  async () => {
    mkdirSync(OUT, { recursive: true });
    const profile = mkdtempSync(join(tmpdir(), "kerr-arrival-"));
    const out: Record<string, unknown> = { tag: TAG };
    try {
      const passes = REPLAY ? [RECORD ? "record" : "replay"] : ["cold", "warm"];
      for (const pass of passes) {
        const app = await App.boot({ width: 1280, height: 800, hash: "scene=game:artemis", tiles: true, sw: !REPLAY, profile });
        const replay = REPLAY ? await tileReplay(app.cdp, REPLAY, RECORD ? "fill" : "replay", DELAY_MS) : null;
        try {
          await app.js(`__bh.pwa?.ready() ?? false`);
          await app.js(`(() => { __bh.settings.vessel = "f35"; Object.assign(__bh.settings, ${EARTH_SETTINGS}); return 1; })()`);
          await app.waitFor(`__bh.fleet.active === "f35"`, 60_000);
          await app.settled();
          await app.js(`(() => { __bh.game.flyAt(44.66, 3.02, 120, 150, 120); __bh.freeze(true); return 1; })()`);
          const t0 = Date.now();
          const rows: Row[] = [];
          for (;;) {
            // (each level: its tiles in, its window's count, drawn (its valid rectangle its whole window), the IGN's share)
            const r = await app.js<Omit<Row, "s">>(`(() => {
              const t = __bh.renderer.earthTiles, B = new Float32Array(1), U = new Uint32Array(B.buffer), levels = {};
              const same = (a, b) => !!a && !!b && a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
              for (const L of t.levels) { if (!L.want) continue; let n = 0, f = 0, w = 0;
                for (let y = L.want.y0; y < L.want.y1; y++) for (let x = L.want.x0; x < L.want.x1; x++) { w++;
                  const s = t.slotOf(L, x, y), d = L.data[s]; if (!d || L.key[s] !== t.keyOf(L, x, y)) continue; n++;
                  let fine = 0; for (let i = 0; i < 65536; i += 4099) { B[0] = d[i]; if (U[0] & 1) fine++; } if (fine > 0) f++; }
                const area = (q) => (q ? (q.x1 - q.x0) * (q.y1 - q.y0) : 0);
                levels['z' + L.z] = [n, f, w, same(L.valid, L.want) ? 1 : 0, +(area(L.valid) / Math.max(area(L.want), 1)).toFixed(3)]; }
              // (the view's quality: a fan of rays over the ground the cockpit sees — 24 bearings across the view, 16 rows from the
              // horizon down, the eye 120 m up, heading 150° —, each the level its footprint wants (the finest window over it within
              // a level of its footprint, the tracer's blend) against the finest drawn there: 2^(drawn − wanted); their mean)
              const R = 6378137, TAU = 2 * Math.PI, H = 120, head = (150 * Math.PI) / 180;
              const vf = ((__bh.settings.fov ?? 60) * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * 1280 / 800);
              const pix = (2 * Math.tan(vf / 2)) / 800;
              const lat0 = Math.asin(t.sinLat), lon0 = t.lon;
              const merc = (sl, n) => (0.5 - Math.atanh(Math.min(Math.max(sl, -0.999999), 0.999999)) / TAU) * n;
              const inR = (r, x, y) => !!r && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;
              let qs = 0, qn = 0;
              for (let i = 0; i < 24; i++) for (let j = 1; j <= 16; j++) {
                const az = head + ((i + 0.5) / 24 - 0.5) * hf;
                const dep = Math.atan((j / 16) * Math.tan(vf / 2));
                const d = Math.min(H / Math.tan(dep), 60000);
                const foot = (d * pix) / Math.sin(dep);
                const lat = lat0 + (d * Math.cos(az)) / R, lon = lon0 + (d * Math.sin(az)) / (R * Math.cos(lat0));
                const zf = Math.log2((TAU * R * Math.cos(lat)) / (256 * foot));
                let want = 5, have = 5;
                for (const L of t.levels) {
                  if (L.z > zf + 1) continue;
                  const x = (lon / TAU + 0.5) * L.n, y = merc(Math.sin(lat), L.n);
                  if (L.want && inR(L.want, x, y)) want = Math.max(want, L.z);
                  if (L.valid && inR(L.valid, x, y)) have = Math.max(have, L.z);
                }
                qs += Math.min(1, 2 ** (have - want)); qn++;
              }
              return { pending: t.pending, quality: +(qs / qn).toFixed(4), levels }; })()`);
            const s = (Date.now() - t0) / 1000;
            rows.push({ s, ...r });
            // (every level drawn and nothing pending — the IGN's share as it came: some of its tiles keep Terrarium's)
            const all = Object.values(r.levels).every((l) => l[3] === 1);
            if ((s > 2 && r.pending === 0 && all) || s > CAP_S) break;
            await Bun.sleep(500);
          }
          const last = rows[rows.length - 1]!;
          // (when each level was first drawn — its window whole —, and stayed so)
          const drawnAt: Record<string, number | null> = {};
          for (const z of Object.keys(last.levels)) {
            let at: number | null = null;
            for (const row of rows) {
              const l = row.levels[z];
              if (l?.[3] === 1) at ??= row.s;
              else at = null;
            }
            drawnAt[z] = at === null ? null : +at.toFixed(1);
          }
          // (when each level began to be drawn — any part of its window: T8i draws the tiles in round the camera's —, and stayed)
          const firstAt: Record<string, number | null> = {};
          for (const z of Object.keys(last.levels)) {
            let at: number | null = null;
            for (const row of rows) {
              if ((row.levels[z]?.[4] ?? 0) > 0) at ??= row.s;
              else at = null;
            }
            firstAt[z] = at === null ? null : +at.toFixed(1);
          }
          const firsts = Object.entries(firstAt).filter(([z]) => Number(z.slice(1)) <= 14);
          const meanFirst = firsts.some(([, t]) => t === null)
            ? null
            : +(firsts.reduce((a, [, t]) => a + t!, 0) / firsts.length).toFixed(1);
          // (the view's quality: when it first reaches 90 % and 99 % and stays, and its mean over the first 30 s)
          const reach = (q: number) => {
            let at: number | null = null;
            for (const row of rows) {
              if (row.quality >= q) at ??= row.s;
              else at = null;
            }
            return at === null ? null : +at.toFixed(1);
          };
          const early = rows.filter((row) => row.s <= 30);
          const qualityMean30 = +(early.reduce((a, row) => a + row.quality, 0) / Math.max(early.length, 1)).toFixed(3);
          const global = Object.entries(drawnAt).filter(([z]) => Number(z.slice(1)) <= 14);
          const missing = global.filter(([, t]) => t === null).map(([z]) => z);
          const mean = missing.length ? null : +(global.reduce((a, [, t]) => a + t!, 0) / global.length).toFixed(1);
          const ign = ["z15", "z16", "z17"].filter((z) => last.levels[z]);
          const ignAt = rows.find((row) =>
            ign.every((z) => !!row.levels[z] && row.levels[z]![1] === row.levels[z]![2] && row.levels[z]![3] === 1),
          )?.s;
          const served = await app.js(`__bh.pwa?.stats().then((x) => x?.served ?? null) ?? null`);
          const summary = {
            drawnAt,
            meanZ6to14: mean,
            firstAt,
            meanFirstZ6to14: meanFirst,
            quality90At: reach(0.9),
            quality99At: reach(0.99),
            qualityMean30,
            z14: drawnAt.z14 ?? null,
            ignWhole: ignAt === undefined ? null : +ignAt.toFixed(1),
            whole: +last.s.toFixed(1),
            capped: last.s > CAP_S,
            missing,
            served,
            gpuErrors: await app.js<number>(`__bh.renderer.gpuErrors`),
            replay: replay ? { ...replay.count, delayMs: DELAY_MS } : undefined,
          };
          console.log(`  ${TAG} ${pass}: ${JSON.stringify(summary)}`);
          out[pass] = { summary, rows };
        } finally {
          await replay?.stop();
          await app.quit();
        }
      }
    } finally {
      rmSync(profile, { recursive: true, force: true });
      writeFileSync(`${OUT}/tile-arrival-${TAG}.json`, JSON.stringify(out));
    }
    for (const pass of REPLAY ? [RECORD ? "record" : "replay"] : ["cold", "warm"]) {
      const s = (out[pass] as { summary: { gpuErrors: number } } | undefined)?.summary;
      expect(s?.gpuErrors ?? 1).toBe(0);
    }
  },
  6 * 60_000,
);
