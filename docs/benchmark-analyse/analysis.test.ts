import { describe, test, expect } from "bun:test";
import { nearCap, topPasses, analysis, qualityByScene, avgMrays, worstOver33, groupedBars, lineChart, histogramFrom, downsample, subsamplingSeries, cpuSeries, featureMatrix, limitsMatrix, SUB_MODES, subModes, subRow, cpuGpuVerdict, jitterStats, headroom, fpsSimulator, machineKey, groupRuns, regressions } from "./analysis.ts";
import type { Bench } from "./types.ts";

// (les JSON à côté du test, d'où que `bun test` soit lancé — la CI le lance depuis la racine)
const load = async (f: string): Promise<Bench> => ({ ...(await Bun.file(new URL(f, import.meta.url)).json()), id: f.includes("iPad") ? "iPad Pro m1" : "nvidia", color: "#fff" }) as Bench;
const ipad = await load("./data/kerr-bench-iPad-Pro-m1-2026-10-04.json");
const nv = await load("./data/kerr-bench-nvidia-2026-10-04.json");

describe("moteur d'analyse kerr-bench", () => {
  test("détection de cap vertical", () => {
    expect(nearCap(29.8)).toBe(30);
    expect(nearCap(30)).toBe(30);
    expect(nearCap(112.5)).toBeNull(); // loin de 120
    expect(nearCap(143.5)).toBe(144);
    expect(nearCap(90)).toBeNull();
  });

  test("passes GPU triées et pourcentages cohérents", () => {
    const artemis = nv.scenes.find(s => s.scene === "game:artemis")!;
    const tops = topPasses(artemis);
    expect(tops[0].pass).toBe("trace");
    expect(tops[0].ms).toBeGreaterThanOrEqual(tops[1].ms);
    expect(tops[0].share).toBeGreaterThan(40); // trace > 40 % du GPU sur cette scène
  });

  test("scores et métriques dérivées", () => {
    expect(nv.score.kerrScore).toBe(3805);
    expect(ipad.score.kerrScore).toBe(440);
    expect(avgMrays(nv)).toBeGreaterThan(avgMrays(ipad));
    expect(worstOver33(ipad)).toBeGreaterThan(0);
    expect(worstOver33(nv)).toBeLessThan(10);
  });

  test("le sweep qualité couvre 5 niveaux par scène", () => {
    for (const b of [ipad, nv]) {
      const m = qualityByScene(b);
      expect(m.size).toBe(2); // game:artemis + Ranger (seules scènes swepées)
      for (const v of m.values()) expect(v.length).toBe(5);
    }
  });

  test("l'analyse produit des findings lisibles pour chaque machine", () => {
    for (const b of [ipad, nv]) {
      const f = analysis(b);
      expect(f.length).toBeGreaterThan(5);
      for (const x of f) expect(x.html).not.toContain("undefined");
    }
    // le iPad a une dérive thermique négative, le NVIDIA quasi nulle
    const ti = analysis(ipad).find(x => x.icon === "🌡")!;
    expect(ti.html).toContain("-1,9");
  });

  test("histogramme et décimation des frame-times", () => {
    const iv = nv.scenes[0].auto!.intervals!;
    const h = histogramFrom(iv);
    expect(Object.values(h).reduce((a, b) => a + b, 0)).toBe(iv.length);
    expect(h[">100"]).toBeGreaterThan(0); // le run nv a des pics à 63/33 ms
    expect(downsample([1, 2, 3, 4, 5], 2)).toEqual([2, 5]); // max par bucket [1,2] puis [3,4,5]
    expect(downsample(iv, 100).length).toBe(100);
  });

  test("séries subsampling et CPU", () => {
    const subs = subsamplingSeries(nv.scenes.find(s => s.scene === "game:artemis"));
    expect(subs.length).toBe(7); // auto,1,2,3,4,6,8
    expect(subs.find(s => s.sub === "3")!.fps).toBe(143.2);
    const cpu = cpuSeries(nv.scenes[0]);
    expect(cpu[0].label).toBe("render (encode, submit)");
    expect(cpu[0].ms).toBeGreaterThanOrEqual(cpu[1].ms);
  });

  test("matrices features et limits WebGPU", () => {
    const feats = featureMatrix([ipad, nv]);
    const subgroups = feats.find(f => f.feature === "subgroups");
    expect(subgroups!.has).toEqual([false, true]); // nv Blackwell seule
    const astc = feats.find(f => f.feature === "texture-compression-astc");
    expect(astc!.has).toEqual([true, false]); // iPad seule
    const limits = limitsMatrix([ipad, nv]);
    const bs = limits.find(l => l.limit === "maxBufferSize");
    expect(bs!.values).toEqual([1073741824, 2147483648]);
  });

  test("graphique en lignes (frame-times) généré proprement", () => {
    const svg = lineChart([
      { label: "nv", color: "#fff", points: nv.scenes[0].auto!.intervals!.slice(0, 400) },
    ], { unit: "ms", hLines: [{ y: 33, label: "33 ms" }] });
    expect(svg).toContain("<path");
    expect(svg).not.toMatch(/undefined|NaN/);
  });

  test("graphiques SVG générés sans 'undefined' ni 'NaN'", () => {
    const svg = groupedBars(["A", "B"], [
      { label: "x", color: "#fff", values: [10, 20] },
      { label: "y", color: "#000", values: [30, 40] },
    ], { unit: "fps", caps: [30, 60] });
    expect(svg).toContain("<svg");
    expect(svg).not.toMatch(/undefined|NaN/);
  });
});

describe("comparatif subsampling (auto, ×1…×8)", () => {
  test("7 modes présents pour chaque scène et chaque machine", () => {
    for (const b of [ipad, nv]) for (const sc of b.scenes) {
      const m = subModes(sc);
      expect([...m.keys()]).toEqual([...SUB_MODES]);
      for (const r of m.values()) expect(r.fps).toBeGreaterThan(0);
    }
  });

  test("l'accumulation ×N est bien plus chère que ×1 (décroissance fps)", () => {
    const sc = nv.scenes.find(x => x.scene.includes("Saturn"))!;
    const rows = SUB_MODES.map(m => subRow(subModes(sc).get(m))!);
    const f1 = rows.find(r => r && r.fps)?.fps ?? 0;
    // ×1 est le plus rapide des modes fixes, auto s'adapte
    expect(rows[0].fps).toBeGreaterThan(0);
    expect(rows[6].fps).toBeLessThan(rows[0].fps); // ×8 < auto
  });

  test("lignes cohérentes : résolution réelle et densité", () => {
    const sc = ipad.scenes.find(x => x.scene === "game:artemis")!;
    const r2 = subRow(subModes(sc).get("×2"))!;
    expect(r2.res).toMatch(/^\d+×\d+$/);
    expect(r2.raysPerPx).toBeGreaterThan(0);
    expect(r2.gpuMean).toBeGreaterThan(0);
  });
});

describe("analyses avancées", () => {
  test("verdict CPU/GPU : le GPU domine largement le frame budget", () => {
    for (const b of [ipad, nv]) for (const sc of b.scenes) {
      const v = cpuGpuVerdict(sc);
      expect(v.gpuMs).toBeGreaterThan(0);
      expect(v.verdict).toBe("GPU-bound"); // les deux runs : CPU ≪ GPU partout
      expect(v.gpuShare).toBeGreaterThan(70);
    }
  });

  test("jitter : stats cohérentes avec les intervals", () => {
    const j = jitterStats(nv.scenes[0].auto!.intervals!);
    expect(j).not.toBeNull();
    expect(j!.median).toBeGreaterThan(0);
    expect(j!.spikes).toBeGreaterThan(0); // pics 63,5 ms vus dans les données
    expect(j!.p999).toBeGreaterThanOrEqual(j!.median);
    expect(jitterStats([1, 2])).toBeNull();
  });

  test("headroom : l'iPad Kerr est au bord du cap 30 Hz", () => {
    const sc = ipad.scenes.find(s => s.scene.includes("Kerr"))!;
    const hr = headroom(ipad, sc);
    expect(hr.cap).toBe(30);
    expect(hr.pct).toBeGreaterThan(95); // auto 29,8 fps sur cap 30
    const scNv = nv.scenes.find(s => s.scene.includes("Kerr"))!;
    expect(headroom(nv, scNv).cap).toBe(144);
  });

  test("simulateur : densité requise croît avec la cible, mode recommandé cohérent", () => {
    const sc = nv.scenes.find(s => s.scene === "game:artemis")!;
    const s120 = fpsSimulator(sc, 120);
    const s140 = fpsSimulator(sc, 140);
    expect(s120.neededRpp!).toBeGreaterThan(s140.neededRpp!); // 140 fps exige une densité plus faible
    expect(s120.bestMode).not.toBeNull();
    expect(s120.bestMode!.fps).toBeGreaterThanOrEqual(120);
    // 60 fps est SOUS la plage observée (jamais < 117 fps) → pas d'interpolation
    const s60 = fpsSimulator(sc, 60);
    expect(s60.neededRpp).toBeNull();
    // cible impossible → pas de mode
    const s1000 = fpsSimulator(sc, 1000);
    expect(s1000.bestMode).toBeNull();
    expect(s1000.neededRpp).toBeNull(); // hors plage → pas d'extrapolation absurde
  });

  test("tendances : grouping par machine, régression sur runs multiples", () => {
    const groups = groupRuns([ipad, nv]);
    expect(groups.size).toBe(2); // 2 machines différentes
    for (const [, g] of groups) expect(g.length).toBe(1);
    const single = groupRuns([ipad, nv]);
    expect(regressions([...single.values()][0])).toEqual([]); // 1 seul run → pas de delta
    // même machine, 2 runs → deltas calculés
    const run2: Bench = { ...nv, id: "nvidia-2026-10-05", app: { ...nv.app, date: "2026-10-05" } };
    const g2 = groupRuns([nv, run2]);
    expect(g2.size).toBe(1);
    const deltas = regressions([...g2.values()][0]);
    expect(deltas.length).toBe(nv.scenes.length);
  });

  test("machineKey ignore la date dans le label", () => {
    expect(machineKey(nv)).toBe("nvidia");
    expect(machineKey(ipad)).toBe("ipad pro m1");
  });
});
