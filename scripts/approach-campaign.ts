// The campaign over every runway (docs/PLAN-APPROCHES.md AP10): each end of each runway of the world (OurAirports' runways, the
// game's tiles — water left out, as the game does) with its approaches as the game makes them (world/approaches.ts approachesOf:
// the FAA's CIFP, nav.dat's ILS, the one built at every other end), judged without a browser:
//   - its approach: the first the game ranks (real before built), its kind and source; renumbered (`was`), approximate (`approx`);
//   - its slope over the relief (game/ils.ts glideClearance at its own angle): clear, thin (a built one: left out of the automatic
//     choice), or running into the relief (the ILS refuses it);
//   - a built approach's box over its slope at the join (controller/approach.ts boxOverSlope: left out as « relief »);
//   - the join planned (game/approach-plan.ts planJoin) from two departures — 40 km behind the final and 40 km beyond the field,
//     1 500 m over the threshold or 600 m over the relief there —: its entry, whether its last floor stands over the glideslope at
//     the join (the slope met late, below a ridge), its points over their legs' ground;
//   - the craft that can land there: the F-35 (1 500 m, a hard surface), the A320 (2 000 m, paved).
// The relief is the world map's (assets/earth/relief-high.bin, some 2 km a texel), not the fine tiles flown over: a coarse judge,
// said as such. Out: docs/progress/approches/ap10-campaign.json (every end) and ap10-campaign.md (the table, the refusals by
// reason, the worst cases).
//
//   bun scripts/approach-campaign.ts [--limit N] [--only ICAO,…]

import { readdirSync } from "node:fs";
import { planJoin, PLAN } from "../src/game/approach-plan";
import { fromRunway, glideClearance, glideHeight, type IlsRunway } from "../src/game/ils";
import { loadGeoid } from "../src/system/geoid";
import { geoidAt, geoidDeg } from "../src/system/geoid-grid";
import { loadHeights } from "../src/system/heights-file";
import { bodyFixedOf, groundRelief, setGroundHeights } from "../src/system/our-surface";
import { mapHeightSampler } from "../src/terrain";
import { type Approach, approachesOf, decodeApproachTile } from "../src/world/approaches";
import { type Airfield, decodeTile } from "../src/world/runways";
import { runwayOfApproach } from "../src/controller/approach";

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || Number.POSITIVE_INFINITY;
const only = args.includes("--only") ? new Set(args[args.indexOf("--only") + 1]!.split(",")) : null;

const fileGet = async (u: string) => new Response(Bun.file(u.replace(/^.*?assets\//, "assets/")));
// (the geoid and the relief: the sea's height over the ellipsoid, the ground's — the world map, no detail)
await loadGeoid((u) => fileGet(u));
const H = await loadHeights("assets/earth/relief-high.bin", fileGet);
const fromMap = mapHeightSampler(H.map, H.W, H.H);
setGroundHeights("earth", (q) => Math.max(fromMap(q), 0) + geoidAt(q));
const groundMsl = (lat: number, lon: number) => Math.max(groundRelief("earth", bodyFixedOf("earth", lat, lon, 0)) - geoidDeg(lat, lon), 0);

// the approach tiles: their records and the FAA's, by field
const recs = new Map<string, { records: ReturnType<typeof decodeApproachTile> }>();
for (const f of readdirSync("assets/approaches/v1").filter((x) => /^t-?\d+_-?\d+\.json$/.test(x))) {
  const T = decodeApproachTile(await Bun.file(`assets/approaches/v1/${f}`).json());
  recs.set(f, { records: T });
}
const byField = new Map<
  string,
  {
    records: ReturnType<typeof decodeApproachTile>["records"];
    cifp: ReturnType<typeof decodeApproachTile>["cifp"];
    cycle: string;
    cifpCycle: string;
  }
>();
for (const { records: T } of recs.values()) {
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

// the runways
const fields: Airfield[] = [];
for (const f of readdirSync("assets/runways/v1").filter((x) => /^t-?\d+_-?\d+\.json$/.test(x)))
  fields.push(...decodeTile(await Bun.file(`assets/runways/v1/${f}`).json()));

const D = Math.PI / 180;
// (the game's own runway frame — its level corrected where the data's is under the relief —: controller/approach.ts)
const runwayOf = (f: Airfield, a: Approach): IlsRunway => runwayOfApproach(f, a, groundMsl);
/** The box round the outer part over the slope at the join (controller/approach.ts boxOverSlope, the same rule). */
function boxOverSlope(W: IlsRunway): boolean {
  let top = 0;
  for (let d = 4000; d <= 26_000; d += 1000)
    for (let x = -7000; x <= 7000; x += 1000) {
      const p = fromRunway(W, -d, x);
      top = Math.max(top, groundMsl(p.lat, p.lon));
    }
  return top + 1000 * 0.3048 > W.elev + glideHeight(W, -16_000) + 150;
}
/** The highest ground within 20 km of the threshold [m over the sea]. */
function topNear(W: IlsRunway): number {
  let top = 0;
  for (let a = -20_000; a <= 20_000; a += 2000)
    for (let x = -20_000; x <= 20_000; x += 2000) {
      const p = fromRunway(W, a, x);
      top = Math.max(top, groundMsl(p.lat, p.lon));
    }
  return top;
}

interface EndRow {
  field: string;
  end: string;
  kind: string;
  source: string;
  cats: string[];
  len: number;
  surface: string;
  elev: number;
  clear: number;
  atM: number;
  outcome: "ok" | "thin" | "refused" | "relief" | "warned";
  joins: { from: string; entry: string; floorOver: boolean; minOver: number }[];
  f35: boolean;
  a320: boolean;
}

const rows: EndRow[] = [];
const t0 = performance.now();
let n = 0;
for (const f of fields) {
  if (only && !only.has(f.icao) && !only.has(f.ident)) continue;
  const R = byField.get(f.ident);
  const list = approachesOf(f, R?.records ?? [], R?.cycle || "2013.10", R?.cifp ?? [], R?.cifpCycle ?? "");
  const ends = new Map<string, Approach>();
  for (const a of list) if (!ends.has(a.rwy)) ends.set(a.rwy, a);
  for (const [end, a] of ends) {
    if (n++ >= limit) break;
    const rw = f.runways.find((r) => r.le === end || r.he === end)!;
    const W = runwayOf(f, a);
    const g = glideClearance(W, groundMsl);
    const built = a.source === "built";
    const box = built && boxOverSlope(W);
    // (a real approach is flown as published — the coarse relief over its slope only said, « warned »; a built one refused)
    const outcome: EndRow["outcome"] =
      g.minM < 0 ? (built ? "refused" : "warned") : built && (g.thin || box) ? (box ? "relief" : "thin") : g.thin ? "thin" : "ok";
    const top = topNear(W);
    const cats: string[] = [];
    cats.push(
      a.kind === "VIS"
        ? "built"
        : a.kind === "ILS"
          ? "ILS"
          : a.kind === "LOC"
            ? "LOC"
            : /LDA|SDF|IGS/.test(a.kind)
              ? "LDA/SDF/IGS"
              : "RNAV/VOR/NDB",
    );
    if (a.was) cats.push("renumbered");
    if (a.approx) cats.push("approx");
    if (rw.surface !== "paved") cats.push("not paved");
    if (W.elev > 1500) cats.push("high (> 1 500 m)");
    if (top - W.elev > 1000) cats.push("mountain (+1 000 m within 20 km)");
    if (rw.len < 1500) cats.push("short (< 1 500 m)");
    // the joins: from behind the final and from beyond the field
    const joins: EndRow["joins"] = [];
    for (const [from, along, trk] of [
      ["behind", -40_000, W.hdg],
      ["beyond", 40_000 + W.len, W.hdg + 180],
    ] as const) {
      const p = fromRunway(W, along, 0);
      const alt = Math.max(W.elev + 1500, groundMsl(p.lat, p.lon) + 600);
      const P = planJoin(W, { lat: p.lat, lon: p.lon, alt, trk: trk * D }, groundMsl);
      const last = P.pts.at(-1);
      const floorOver = !!last && last.floor > W.elev + glideHeight(W, -PLAN.join) + 150;
      let minOver = Number.POSITIVE_INFINITY;
      for (const q of P.pts) minOver = Math.min(minOver, q.alt - groundMsl(q.lat, q.lon));
      joins.push({ from, entry: P.entry, floorOver, minOver: Math.round(minOver) });
    }
    const paved = rw.surface === "paved";
    rows.push({
      field: f.icao || f.ident,
      end,
      kind: a.kind,
      source: a.source,
      cats,
      len: Math.round(rw.len),
      surface: rw.surface,
      elev: Math.round(W.elev),
      clear: Math.round(g.minM),
      atM: g.atM,
      outcome,
      joins,
      f35: rw.len >= 1500 && paved,
      a320: rw.len >= 2000 && paved,
    });
  }
  if (n >= limit) break;
}
const secs = (performance.now() - t0) / 1000;

// the table: by category, the outcomes
const CATS = [
  "ILS",
  "LOC",
  "LDA/SDF/IGS",
  "RNAV/VOR/NDB",
  "built",
  "renumbered",
  "approx",
  "not paved",
  "high (> 1 500 m)",
  "mountain (+1 000 m within 20 km)",
  "short (< 1 500 m)",
];
const table = CATS.map((c) => {
  const R = rows.filter((r) => r.cats.includes(c));
  const k = (o: string) => R.filter((r) => r.outcome === o).length;
  return {
    cat: c,
    ends: R.length,
    ok: k("ok"),
    thin: k("thin"),
    relief: k("relief"),
    refused: k("refused"),
    warned: k("warned"),
    floorOver: R.filter((r) => r.joins.some((j) => j.floorOver)).length,
    f35: R.filter((r) => r.f35).length,
    a320: R.filter((r) => r.a320).length,
  };
});
const total = {
  ends: rows.length,
  withApproach: rows.length,
  real: rows.filter((r) => r.source !== "built").length,
  ok: rows.filter((r) => r.outcome === "ok").length,
  thin: rows.filter((r) => r.outcome === "thin").length,
  relief: rows.filter((r) => r.outcome === "relief").length,
  refused: rows.filter((r) => r.outcome === "refused").length,
  warned: rows.filter((r) => r.outcome === "warned").length,
  // (the fields where a craft that may land there finds no end to fly: every end it can use refused by the relief)
  ...Object.fromEntries(
    (["f35", "a320"] as const).map((k) => {
      const by = new Map<string, EndRow[]>();
      for (const r of rows) if (r[k]) by.set(r.field, [...(by.get(r.field) ?? []), r]);
      const none = [...by].filter(([, E]) => E.every((e) => e.outcome === "refused")).map(([f]) => f);
      return [`${k}Fields`, { fields: by.size, noneFlyable: none.length, examples: none.slice(0, 12) }];
    }),
  ),
  floorOver: rows.filter((r) => r.joins.some((j) => j.floorOver)).length,
  joinUnder290: rows.filter((r) => r.joins.some((j) => j.minOver < 290)).length,
  vectors: rows.filter((r) => r.joins.some((j) => j.entry === "vectors")).length,
  seconds: Math.round(secs),
};
const refusedReal = rows.filter((r) => r.outcome === "warned").sort((a, b) => a.clear - b.clear);
const out = {
  date: new Date().toISOString(),
  relief: "relief-high.bin (world map, no tiles)",
  total,
  table,
  refusedReal: refusedReal.slice(0, 40),
  rows: only || limit < 1e9 ? rows : undefined,
};
await Bun.write("docs/progress/approches/ap10-campaign.json", `${JSON.stringify({ ...out, rows: undefined }, null, 1)}\n`);
const md = [
  `# AP10 — la campagne sur toutes les pistes (${out.date.slice(0, 16).replace("T", " ")} UTC)`,
  "",
  `Produit par \`bun scripts/approach-campaign.ts\` — relief : la carte mondiale (relief-high.bin, ~2 km le texel), sans les tuiles fines : un juge grossier.`,
  "",
  `**${total.ends} extrémités**, toutes avec une approche (${total.real} réelles, ${total.ends - total.real} construites) ; pente dégagée ${total.ok}, mince ${total.thin}, construite écartée « relief » ${total.relief}, construite refusée (la pente rencontre le relief) ${total.refused}, réelle volée comme publiée malgré la carte du relief ${total.warned} ; jonction dont le dernier palier dépasse la pente à 16 km : ${total.floorOver} ; un point de jonction à moins de 290 m du sol : ${total.joinUnder290} ; en ${total.seconds} s.`,
  "",
  `Terrains où le F-35 peut se poser : ${total.f35Fields.fields}, dont ${total.f35Fields.noneFlyable} sans aucune extrémité volable (toutes refusées par le relief : ${total.f35Fields.examples.join(", ")}) ; l'A320 : ${total.a320Fields.fields}, dont ${total.a320Fields.noneFlyable} (${total.a320Fields.examples.join(", ")}).`,
  "",
  "| Catégorie | Extrémités | Dégagée | Mince | Écartée (relief) | Refusée | Réelle, relief contredit | Palier au-dessus de la pente | F-35 | A320 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...table.map(
    (r) =>
      `| ${r.cat} | ${r.ends} | ${r.ok} | ${r.thin} | ${r.relief} | ${r.refused} | ${r.warned} | ${r.floorOver} | ${r.f35} | ${r.a320} |`,
  ),
  "",
  "**Approches réelles que la carte mondiale du relief contredit** (volées comme publiées depuis AP10 — avant, refusées ; le relief grossier près du seuil, un angle de nav.dat douteux) — les 40 pires :",
  "",
  "| Terrain | Extrémité | Approche | Dégagement | À |",
  "|---|---|---|---:|---:|",
  ...refusedReal
    .slice(0, 40)
    .map((r) => `| ${r.field} | ${r.end} | ${r.kind} (${r.source}) | ${r.clear} m | ${(r.atM / 1000).toFixed(1)} km |`),
  "",
].join("\n");
await Bun.write("docs/progress/approches/ap10-campaign.md", md);
console.log(md.split("\n").slice(0, 22).join("\n"));
// (a few fields asked: their ends said whole)
if (only) for (const r of rows) console.log(JSON.stringify(r));
