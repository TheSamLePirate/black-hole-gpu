// The procedural detail beyond J7-1's approach corridor (PLAN-J7 J7-1: the detail removed under each runway's final to 10 km — 7128cffe —;
// PLAN-APPROCHES: the joins' floors stand 300 m over the data, the slope judged on the data — Sam, 16 Nov 2026): along each end's axis
// from 10 to 18.5 km (the initial fix), the ground with its detail against the data's and the slope. Counted: the ends where the data
// clear the slope by 150 m and the detail comes within 90 m of it (`near`) or above it (`hit`); where the detail stands over the data
// by more than 300 m (`over300` — a join's floor inside it); the histogram of the detail's greatest excess (< 50, 100, 200, 300, more).
//
//   bun scripts/approach-detail-beyond.ts
import { readdirSync } from "node:fs";
const R = `${import.meta.dir}/../`;
const { loadGeoid } = await import(R + "src/system/geoid");
const { geoidDeg } = await import(R + "src/system/geoid-grid");
const { loadHeights } = await import(R + "src/system/heights-file");
const { setGroundHeights, groundRelief, groundBare, bodyFixedOf } = await import(R + "src/system/our-surface");
const { earthHeightSampler } = await import(R + "src/terrain");
const { runwayOfApproach, groundMsl } = await import(R + "src/controller/approach");
const { fromRunway, glideHeight, ILS } = await import(R + "src/game/ils");
const { approachesOf, decodeApproachTile } = await import(R + "src/world/approaches");
const { decodeTile } = await import(R + "src/world/runways");
const fileGet = async (u: string) => new Response(Bun.file(R + "assets/" + u.replace(/^.*?assets\//, "")));
await loadGeoid(fileGet);
const H = await loadHeights(R + "assets/earth/relief-high.bin", fileGet);
setGroundHeights("earth", earthHeightSampler(H.map, H.W, H.H));
const byField = new Map<string, any>();
for (const f of readdirSync(R + "assets/approaches/v1").filter((x) => /^t-?\d+_-?\d+\.json$/.test(x))) {
  const T = decodeApproachTile(await Bun.file(R + `assets/approaches/v1/${f}`).json());
  for (const r of T.records) {
    const e = byField.get(r.f) ?? { records: [], cifp: [], cycle: T.cycle, cifpCycle: T.cifpCycle };
    e.records.push(r);
    byField.set(r.f, e);
  }
  for (const r of T.cifp) {
    const e = byField.get(r.f) ?? { records: [], cifp: [], cycle: T.cycle, cifpCycle: T.cifpCycle };
    e.cifp.push(r);
    e.cifpCycle = T.cifpCycle;
    byField.set(r.f, e);
  }
}
let ends = 0,
  near = 0,
  hit = 0,
  over300 = 0;
const worst: string[] = [];
const hist = [0, 0, 0, 0, 0];
for (const f of readdirSync(R + "assets/runways/v1").filter((x) => /^t-?\d+_-?\d+\.json$/.test(x)))
  for (const a of decodeTile(await Bun.file(R + `assets/runways/v1/${f}`).json())) {
    const B = byField.get(a.ident);
    const list = approachesOf(a, B?.records ?? [], B?.cycle || "2013.10", B?.cifp ?? [], B?.cifpCycle ?? "");
    const seen = new Set<string>();
    for (const ap of list) {
      if (seen.has(ap.rwy)) continue;
      seen.add(ap.rwy);
      ends++;
      const W = runwayOfApproach(a, ap, groundMsl);
      let minDet = Infinity,
        minBare = Infinity,
        at = 0;
      for (let d = 10250; d <= ILS.iaf; d += 250)
        for (const x of [-300, 0, 300]) {
          const p = fromRunway(W, -d, x);
          const q = bodyFixedOf("earth", p.lat, p.lon, 0);
          const N = geoidDeg(p.lat, p.lon);
          const s = W.elev + glideHeight(W, -d);
          const cd = s - Math.max(groundRelief("earth", q) - N, 0),
            cb = s - Math.max(groundBare("earth", q) - N, 0);
          if (cd < minDet) (minDet = cd), (at = d);
          if (cb < minBare) minBare = cb;
        }
      {
        let mx = 0;
        for (let d = 10250; d <= 18500; d += 500) {
          const p = fromRunway(W, -d, 0);
          const q = bodyFixedOf("earth", p.lat, p.lon, 0);
          mx = Math.max(mx, groundRelief("earth", q) - groundBare("earth", q));
        }
        if (mx > 300) over300++;
        hist[mx < 50 ? 0 : mx < 100 ? 1 : mx < 200 ? 2 : mx < 300 ? 3 : 4]++;
      }
      // (the data clear by 150 m and more, the detail closer than 90 m — the clearance asked: the corridor's length would matter)
      if (minBare >= 150 && minDet < 90) {
        near++;
        if (minDet < 0) hit++;
        if (worst.length < 15)
          worst.push(
            `${a.icao || a.ident} ${ap.rwy} detail ${minDet.toFixed(0)} m data ${minBare.toFixed(0)} m at ${(at / 1000).toFixed(1)} km`,
          );
      }
    }
  }
console.log({ ends, near, hit, over300, hist });
console.log(worst.join("\n"));
