// A/B of tracer sources through the D3D12 proxy (Tint + DXC, as scripts/d3d12-compile-proxy.ts), robust to a busy machine:
// each variant's HLSL made once, then DXC run on the variants in turn, several rounds, and its CPU time (user + sys) kept —
// the best of the rounds. docs/PLAN-LEAN-TRACER-KERNELS.md P9.
//
//   bun scripts/d3d12-ab.ts a.wgsl b.wgsl [c.wgsl …] --profiles earth-raster,moon --entries main,env [--rounds 2]
//
// Each .wgsl is a whole src/shaders/trace.wgsl (git show REV:src/shaders/trace.wgsl > a.wgsl).
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import forestWGSL from "../src/shaders/forest.wgsl" with { type: "text" };
import { type TracerEntry, tracerEntryPoint } from "../src/system/tracer-kernels";
import { FULL_TRACER_LIMITS, composeTracer } from "../src/system/tracer-source";
import { PROFILES, profileConstants } from "./lib/kernel-profiles";
import { specialiseWgsl } from "./lib/wgsl-inline";

const out = join(homedir(), ".cache/bh-d3d12/dawn/out");
const TINT = process.env.TINT ?? join(out, "tint");
const DXC = process.env.DXC ?? join(out, "dxc");

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const profiles = opt("--profiles")?.split(",");
const entries = opt("--entries")?.split(",");
const rounds = Number(opt("--rounds") ?? 2);
const files = args;
if (files.length < 2) throw new Error("two .wgsl sources at least");

const dxcArgs = (ep: string, hlsl: string, dxil: string) => [
  "-T",
  "cs_6_6",
  "-E",
  ep,
  "-opt-disable",
  "structurize-loop-exits-for-unroll",
  "/Gis",
  "/O3",
  "/Zpr",
  "-HV",
  "2018",
  "-Fo",
  dxil,
  hlsl,
];

/** a command's CPU time (user + sys, from /usr/bin/time -l on macOS, -v on Linux) */
async function cpu(cmd: string[]): Promise<{ s: number; ok: boolean }> {
  const linux = process.platform === "linux";
  const p = Bun.spawn(["/usr/bin/time", linux ? "-v" : "-l", ...cmd], { stdout: "pipe", stderr: "pipe" });
  const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  const m = linux
    ? [/User time \(seconds\): ([\d.]+)/.exec(err)?.[1], /System time \(seconds\): ([\d.]+)/.exec(err)?.[1]]
    : [/([\d.]+) user/.exec(err)?.[1], /([\d.]+) sys/.exec(err)?.[1]];
  return { s: Number(m[0] ?? 0) + Number(m[1] ?? 0), ok: code === 0 };
}

const dir = mkdtempSync(join(tmpdir(), "bh-d3d12-ab-"));
const sources = await Promise.all(files.map(async (f) => composeTracer(await Bun.file(f).text(), forestWGSL, FULL_TRACER_LIMITS)));
for (const p of PROFILES.filter((x) => !profiles || profiles.includes(x.id))) {
  for (const entry of p.entries.filter((e) => !entries || entries.includes(e)) as TracerEntry[]) {
    const c = profileConstants(p, entry);
    const overrides = Object.entries(c)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const ep = tracerEntryPoint(entry);
    const hlsl: string[] = [];
    for (let v = 0; v < sources.length; v++) {
      const w = join(dir, `${v}.wgsl`);
      const h = join(dir, `${p.id}-${entry}-${v}.hlsl`);
      await Bun.write(w, specialiseWgsl(sources[v]!, c, ep));
      const t = Bun.spawnSync([TINT, "--format", "hlsl", "--ep", ep, "--overrides", overrides, "-o", h, w]);
      if (t.exitCode !== 0) throw new Error(`${files[v]} ${p.id} ${entry}: tint failed\n${t.stderr}`);
      hlsl.push(h);
    }
    const best = sources.map(() => Number.POSITIVE_INFINITY);
    const dxil = sources.map(() => 0);
    for (let r = 0; r < rounds; r++)
      for (let v = 0; v < sources.length; v++) {
        const o = join(dir, `${v}.dxil`);
        const d = await cpu([DXC, ...dxcArgs(ep, hlsl[v]!, o)]);
        if (!d.ok) throw new Error(`${files[v]} ${p.id} ${entry}: dxc failed`);
        best[v] = Math.min(best[v]!, d.s);
        dxil[v] = statSync(o).size / 1024;
      }
    console.log(
      `${`${p.id} ${entry}`.padEnd(24)} ${best.map((s, v) => `${basename(files[v]!)} ${s.toFixed(1).padStart(6)} s ${dxil[v]!.toFixed(0).padStart(5)} KB`).join("   ")}`,
    );
  }
}
rmSync(dir, { recursive: true, force: true });
