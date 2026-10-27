// What a Windows player's Chrome compiles for each tracer kernel, measured here without Windows: the same Tint (WGSL →
// HLSL, the pipeline's override values substituted) and the same DXC (HLSL → DXIL, Dawn's arguments) as Chrome's D3D12
// backend, built from the Dawn branch of the Chrome release (scripts/setup-d3d12-proxy.sh). What it measures is the
// browser's side of a D3D12 pipeline compile — the part that grows with the inlined code; not the GPU driver's own
// DXIL → ISA step, nor the speed of a player's CPU (docs/PLAN-LEAN-TRACER-KERNELS.md, P0.3).
//
//   bun scripts/d3d12-compile-proxy.ts                         every profile's realtime pipelines
//   bun scripts/d3d12-compile-proxy.ts earth-raster,kerr-jet   some profiles
//   bun scripts/d3d12-compile-proxy.ts earth-raster --entries main,env
//   bun scripts/d3d12-compile-proxy.ts --json out.json         results kept (docs/progress/kernels/)
//   bun scripts/d3d12-compile-proxy.ts --specialise            the sources specialised as the renderer makes them (P1b)
//   bun scripts/d3d12-compile-proxy.ts kerr-jet --entries main --equiv   both, and their DXIL compared (same code?)
//   TINT=… DXC=… bun scripts/d3d12-compile-proxy.ts            the tools elsewhere
//
// Calibration (docs/ANALYSE-CHARGEMENT-GPU.md §9, Chrome 155 on Windows): the general kernel (main + env) 317 s on an
// RX 5700 XT machine, 90 s on an RTX 5070 Ti machine; key 516's 27.8 s (5700 XT). The proxy's seconds for the same
// pipelines give the ratio by which a measured change here scales to those machines.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { TracerEntry } from "../src/system/tracer-kernels";
import { tracerEntryPoint } from "../src/system/tracer-kernels";
import { PROFILES, profileConstants, tracerSource } from "./lib/kernel-profiles";
import { specialiseWgsl } from "./lib/wgsl-inline";

const out = join(homedir(), ".cache/bh-d3d12/dawn/out");
const TINT = process.env.TINT ?? join(out, "tint");
const DXC = process.env.DXC ?? join(out, "dxc");
for (const [name, path] of [
  ["tint", TINT],
  ["dxc", DXC],
] as const)
  if (!(await Bun.file(path).exists())) {
    console.error(`d3d12-compile-proxy: ${name} not found at ${path} — build it: sh scripts/setup-d3d12-proxy.sh`);
    process.exit(1);
  }

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1] ?? "";
  args.splice(i, 2);
  return v;
};
const jsonOut = opt("--json");
const flagOn = (name: string) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const specialise = flagOn("--specialise");
const equiv = flagOn("--equiv");
const entriesWanted = opt("--entries")?.split(",");
const shaderModel = opt("--sm") ?? "6_6";
const ids = args[0]?.split(",");

/** Dawn's DXC arguments for a compute pipeline (dawn/native/d3d/ShaderUtils.cpp GetDXCArguments; ComputePipelineD3D12:
 *  optimisation level 3, row-major matrices, IEEE strictness; HLSL 2018 unless the 2021 toggle) */
const dxcArgs = (entry: string, hlsl: string, dxil: string, listing = false) => [
  "-T",
  `cs_${shaderModel}`,
  "-E",
  entry,
  "-opt-disable",
  "structurize-loop-exits-for-unroll",
  "/Gis",
  "/O3",
  "/Zpr",
  "-HV",
  "2018",
  listing ? "-Fc" : "-Fo",
  dxil,
  hlsl,
];

/** a DXIL listing with its names and numbering taken off (two compiles of the same code then read the same, but for the
 *  order of a few phi nodes) */
const normalise = (asm: string) =>
  asm
    .split("\n")
    .filter((l) => !l.startsWith(";"))
    .map((l) =>
      l
        .replace(/%[0-9]+/g, "%N")
        .replace(/@[A-Za-z0-9_.]+/g, "@G")
        .replace(/![0-9]+/g, "!M"),
    )
    .sort();

/** a command's wall time and peak memory (macOS /usr/bin/time -l; Linux -v) */
async function timed(cmd: string[]): Promise<{ s: number; mb: number; ok: boolean; err: string }> {
  const linux = process.platform === "linux";
  const t0 = performance.now();
  const p = Bun.spawn(["/usr/bin/time", linux ? "-v" : "-l", ...cmd], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  const s = (performance.now() - t0) / 1000;
  const rss = linux ? /Maximum resident set size \(kbytes\): (\d+)/.exec(err) : /(\d+)\s+maximum resident set size/.exec(err);
  const mb = rss ? Number(rss[1]) / (linux ? 1024 : 1024 * 1024) : 0;
  return { s, mb, ok: code === 0, err: err.split("\n").slice(0, 12).join("\n") };
}

const dir = mkdtempSync(join(tmpdir(), "bh-d3d12-"));
const source = tracerSource();
const wgsl = join(dir, "trace.wgsl");
await Bun.write(wgsl, source);

interface Row {
  profile: string;
  entry: TracerEntry;
  key: number;
  tintS: number;
  tintMB: number;
  hlslKB: number;
  dxcS: number;
  dxcMB: number;
  dxilKB: number;
  ok: boolean;
}
const rows: Row[] = [];
for (const p of PROFILES.filter((x) => !ids || ids.includes(x.id))) {
  console.log(`\n${p.label}  [key ${p.key}${p.quality ? ", quality" : ""}]`);
  for (const entry of p.entries.filter((e) => !entriesWanted || entriesWanted.includes(e))) {
    const c = profileConstants(p, entry);
    const overrides = Object.entries(c)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const hlsl = join(dir, `${p.id}-${entry}.hlsl`);
    const dxil = join(dir, `${p.id}-${entry}.dxil`);
    const ep = tracerEntryPoint(entry);
    // (the renderer's specialised source for this pipeline — P1b —, or the module as it was)
    let input = wgsl;
    if (specialise) {
      input = join(dir, `${p.id}-${entry}.wgsl`);
      await Bun.write(input, specialiseWgsl(source, c, ep));
    }
    const t = await timed([TINT, "--format", "hlsl", "--ep", ep, "--overrides", overrides, "-o", hlsl, input]);
    if (!t.ok) {
      console.log(`  ${entry.padEnd(11)} tint failed:\n${t.err}`);
      rows.push({ profile: p.id, entry, key: p.key, tintS: t.s, tintMB: t.mb, hlslKB: 0, dxcS: 0, dxcMB: 0, dxilKB: 0, ok: false });
      continue;
    }
    // (the entry point keeps its name in Tint's HLSL)
    const d = await timed([DXC, ...dxcArgs(ep, hlsl, dxil)]);
    const hlslKB = statSync(hlsl).size / 1024;
    const dxilKB = d.ok ? statSync(dxil).size / 1024 : 0;
    rows.push({ profile: p.id, entry, key: p.key, tintS: t.s, tintMB: t.mb, hlslKB, dxcS: d.s, dxcMB: d.mb, dxilKB, ok: d.ok });
    if (equiv && d.ok) {
      // (the same pipeline from the other source: its DXIL listing against this one's)
      const otherIn = specialise ? wgsl : join(dir, `${p.id}-${entry}.spec.wgsl`);
      if (!specialise) await Bun.write(otherIn, specialiseWgsl(source, c, ep));
      const oh = join(dir, `${p.id}-${entry}.other.hlsl`);
      Bun.spawnSync([TINT, "--format", "hlsl", "--ep", ep, "--overrides", overrides, "-o", oh, otherIn]);
      const la = join(dir, "a.asm");
      const lb = join(dir, "b.asm");
      Bun.spawnSync([DXC, ...dxcArgs(ep, hlsl, la, true)]);
      Bun.spawnSync([DXC, ...dxcArgs(ep, oh, lb, true)]);
      const [a, b] = [normalise(await Bun.file(la).text()), normalise(await Bun.file(lb).text())];
      const same = a.length === b.length && a.every((x, k) => x === b[k]);
      console.log(`  ${entry.padEnd(11)} DXIL ${same ? "identical" : "DIFFERS"} (${a.length} / ${b.length} lines, names and order aside)`);
    }
    console.log(
      `  ${entry.padEnd(11)} tint ${t.s.toFixed(1).padStart(5)} s  hlsl ${hlslKB.toFixed(0).padStart(5)} KB  dxc ${d.s.toFixed(1).padStart(6)} s ${d.mb.toFixed(0).padStart(5)} MB  dxil ${dxilKB.toFixed(0).padStart(5)} KB${d.ok ? "" : `  FAILED\n${d.err}`}`,
    );
  }
}
rmSync(dir, { recursive: true, force: true });

// (the calibration: the general kernel's main + env, here and on the recorded machines)
const general = rows.filter((r) => r.profile === "general" && (r.entry === "main" || r.entry === "env"));
if (general.length === 2) {
  const s = general.reduce((a, r) => a + r.tintS + r.dxcS, 0);
  console.log(
    `\ncalibration: general main + env ${s.toFixed(0)} s here — ×${(317 / s).toFixed(1)} on the RX 5700 XT machine (317 s), ×${(90 / s).toFixed(1)} on the RTX 5070 Ti machine (90 s), driver step included there`,
  );
}
if (jsonOut) {
  await Bun.write(
    jsonOut,
    `${JSON.stringify({ date: new Date().toISOString(), tint: TINT, dxc: DXC, shaderModel, specialise, rows }, null, 1)}\n`,
  );
  console.log(`written ${jsonOut}`);
}
