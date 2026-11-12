#!/usr/bin/env bun
// PLAN-J2 J2-0 — the reference fiche's numbers from tests/e2e/j2-probes.e2e.test.ts's j2.json (one or more: a leak run, a flight
// run), as Markdown tables on stdout: the leak per view, the seams, the sea's white points by stage, the sharpness's dips at the
// changes of scale and each pause's moving/held ratio, the tiles' publication per image (the load, the flight).
// Usage: bun scripts/j2-fiche.ts <j2.json> [<j2.json> …] [--chart <out.json>] (--chart: the sharpness and publication series, for
// a page).
import { readFileSync, writeFileSync } from "node:fs";
import { eventStep, type SharpRowT, scaleDips } from "../tests/e2e/lib/j2-probes";

const args = process.argv.slice(2);
const chartAt = args.indexOf("--chart");
const chartOut = chartAt >= 0 ? args[chartAt + 1] : null;
const files = args.filter((a, i) => !a.startsWith("--") && (chartAt < 0 || i !== chartAt + 1));
if (!files.length) {
  console.error("usage: bun scripts/j2-fiche.ts <j2.json> [...] [--chart out.json]");
  process.exit(2);
}
// biome-ignore lint/suspicious/noExplicitAny: a JSON report read as it comes
type J = Record<string, any>;
// (a compact copy — docs/progress/j2/*.json: rows as arrays under `columns` — read back to objects)
const expand = (x: J) =>
  x && Array.isArray(x.columns) ? x.rows.map((r: unknown[]) => Object.fromEntries(x.columns.map((c: string, i: number) => [c, r[i]]))) : x;
const runs: J[] = files.map((f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  if (j.flight?.sharp?.columns)
    j.flight.sharp = expand(j.flight.sharp).map((r: J) => ({ ...r, t: r.t_ms, source: "", phase: "", width: 0, height: 0, scale: 0 }));
  if (j.flight?.publication?.log?.columns) j.flight.publication.log = expand(j.flight.publication.log).map((r: J) => ({ ...r, t: r.t_ms }));
  return j;
});
const f1 = (x: number | undefined, d = 1) => (x === undefined || Number.isNaN(x) ? "—" : x.toFixed(d));
const pct = (x: number, d = 1) => `${(100 * x).toFixed(d)} %`;
const out: string[] = [];
for (const r of runs) {
  out.push(`### ${r.machine} — ${r.startedAt} → ${r.finishedAt ?? "?"}`);
  out.push(`Adaptateur : ${JSON.stringify(r.adapter ?? {})}`);
  if (r.leak?.length) {
    out.push(
      "",
      "| Vue | Emplacements peints / niveaux | Pixels | Fuite rel > 0,1 / 0,5 / 2 | Témoin (bruit) > 0,1 / 0,5 / 2 | rel max | Coutures : paires continues | p50 / p95 / p99 / max [px] | > 0,25 px | silhouettes |",
    );
    out.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const v of r.leak) {
      const L = v.leak ?? {},
        s = v.seams ?? {};
      out.push(
        `| ${v.view} | ${v.held?.slots} / ${v.held?.levels} | ${L.pixels} | ${L.leak?.over0_1} / ${L.leak?.over0_5} / ${L.leak?.over2} | ${L.control?.over0_1} / ${L.control?.over0_5} / ${L.control?.over2} | ${L.maxRel} | ${s.continuous ?? "—"} / ${s.pairs ?? "—"} | ${s.p50} / ${s.p95} / ${s.p99} / ${s.max} | ${s.over0_25} | ${s.silhouettes ?? "—"} |`,
      );
    }
  }
  const fl = r.flight;
  if (fl) {
    out.push("", `Départ du vol : ${JSON.stringify(fl.state0)}`);
    const st = (fl.stages ?? []).filter(Boolean);
    if (st.length) {
      out.push("", "| Lecture | shade : > blanc / isolés | temporal | taau |", "|---|---|---|---|");
      st.forEach((s: J, i: number) => {
        const c = (k: string) => (s[k] ? `${s[k].overWhite} / ${s[k].isolated} (${s[k].width}×${s[k].height})` : "—");
        out.push(`| ${i + 1} | ${c("shade")} | ${c("temporal")} | ${c("taau")} |`);
      });
    }
    const rows: J[] = fl.sharp ?? [];
    const scales = [...new Set(rows.map((x) => x.renderScale.toFixed(3)))];
    out.push(
      "",
      `Netteté : ${rows.length} images mesurées (sautées ${fl.sharpSkipped}), échelles vues ${scales.join(", ")} ; événements ${JSON.stringify(fl.events)}`,
    );
    // (each event and each change of scale: its dip, its peak, where it settled — computed here from the rows, eventStep)
    const evs: { what: string; t: number }[] = [
      ...(fl.events ?? []),
      ...scaleDips(rows as SharpRowT[]).map((d) => ({ what: `échelle ${d.from} → ${d.to}`, t: d.t })),
    ].sort((a, b) => a.t - b.t);
    out.push("", "| Événement | t [s] | creux | pic | régime 0,3–0,7 s après |", "|---|---|---|---|---|");
    for (const e of evs) {
      const st = eventStep(rows as SharpRowT[], e.t);
      if (st) out.push(`| ${e.what} | ${f1(e.t / 1000)} | ${pct(st.dip)} | ${pct(st.peak)} | ${pct(st.settled)} |`);
    }
    if (fl.pauses?.length) {
      out.push("", "| Pause à [s] | netteté en vol | tenue (fin de pause) | rapport |", "|---|---|---|---|");
      for (const p of fl.pauses) out.push(`| ${f1(p.at / 1000)} | ${p.moving} | ${p.refined} | ${p.ratio} |`);
    }
    const pub = fl.publication ?? {};
    for (const [k, P] of Object.entries(pub) as [string, J][]) {
      if (k === "log" || !P?.per) continue;
      const q = P.per;
      out.push(
        "",
        `Publication (${k}) : ${P.images} images, ${P.withWrites} avec écritures, ${P.over2ms} au-delà de 2 ms, au plus ${P.maxSubmits} soumissions par image`,
        "| Par image | p50 | p95 | max | total |",
        "|---|---|---|---|---|",
      );
      for (const key of ["bytes", "writes", "tiles", "orthos", "submits", "mipPasses", "putMs", "mipMs"]) {
        const v = q[key];
        const fmt = (x: number) =>
          key === "bytes" ? `${(x / 1048576).toFixed(2)} Mio` : key.endsWith("Ms") ? `${x.toFixed(2)} ms` : String(x);
        out.push(`| ${key} | ${fmt(v.p50)} | ${fmt(v.p95)} | ${fmt(v.max)} | ${fmt(v.total)} |`);
      }
    }
    if (fl.frames) out.push("", `Images du vol : ${JSON.stringify(fl.frames)}`);
    if (chartOut)
      writeFileSync(
        chartOut,
        JSON.stringify({
          machine: r.machine,
          sharp: rows.map((x) => [+(x.t / 1000).toFixed(3), +x.sharp.toFixed(4), x.renderScale]),
          events: fl.events,
          pub: (pub.log ?? []).map((x: J) => [+(x.t / 1000).toFixed(3), x.bytes, x.submits, x.putMs]),
        }),
      );
  }
  out.push("");
}
console.log(out.join("\n"));
