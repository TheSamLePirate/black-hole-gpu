// What the raster's ground shading reads (docs/PLAN-J1-OPAQUE-FORWARD.md J1-3/J1-4): from shadeLite and the functions it reaches
// in the J0 profile's kernel (earth-raster-wx), the module's resources each family of the ground's light needs — the textures,
// storage buffers, samplers and uniforms a raster fragment would have to be given to shade the same ground in forward —, set
// against WebGPU's per-stage limits. Static, from the composed WGSL (the tracer as the full device composes it).
//
//   bun scripts/ground-shading-inventory.ts            the table
//   bun scripts/ground-shading-inventory.ts --json     machine-readable
import { tracerEntryPoint } from "../src/system/tracer-kernels";
import { PROFILES, profileConstants, tracerSource } from "./lib/kernel-profiles";
import { InlineModel } from "./lib/wgsl-inline";

const src = tracerSource();
const profile = PROFILES.find((p) => p.id === "earth-raster-wx")!;
const m = new InlineModel(src, profileConstants(profile, "shadeLite"));
const bodies = (m as unknown as { bodies: Map<string, string> }).bodies;

/** the module's resources: name → kind */
type Kind = "texture" | "storage" | "storage-rw" | "uniform" | "sampler" | "storage-texture";
const resources = new Map<string, { kind: Kind; binding: number }>();
for (const r of src.matchAll(/@group\(\d+\)\s*@binding\((\d+)\)\s*var(<[^>]*>)?\s+(\w+)\s*:\s*([^;]+);/g)) {
  const [, b, space = "", name, type] = r;
  const kind: Kind = type!.startsWith("texture_storage")
    ? "storage-texture"
    : type!.startsWith("texture")
      ? "texture"
      : type!.startsWith("sampler")
        ? "sampler"
        : space.includes("uniform")
          ? "uniform"
          : space.includes("read_write")
            ? "storage-rw"
            : "storage";
  resources.set(name!, { kind, binding: Number(b) });
}

/** the resources a set of roots reaches (their own bodies and every callee's) */
function reads(roots: string[]): Map<string, Kind> {
  const fns = new Set<string>();
  const own = roots.includes("@body");
  for (const r of roots) if (r !== "@body") for (const f of m.reach(r)) fns.add(f);
  const out = new Map<string, Kind>();
  const names = [...resources.keys()];
  const re = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const texts = [...fns].map((f) => bodies.get(f) ?? "");
  if (own) texts.push(bodies.get(tracerEntryPoint("shadeLite")) ?? "");
  for (const t of texts) for (const x of t.matchAll(re)) out.set(x[1]!, resources.get(x[1]!)!.kind);
  return out;
}

/** the ground's light by family (shadeLite's helpers): what each reads on its own */
const FAMILIES: [string, string[]][] = [
  ["imagery (albedo)", ["earthImageryAniso"]],
  ["sun (shadows: clouds, cascades, horizons, scenery, craft)", ["liteSun"]],
  ["sky light", ["liteSky"]],
  ["air & clouds before the surface, write-out", ["liteFinish"]],
  ["water (open-sea path aside)", ["liteWater"]],
  ["shadeLite whole", [tracerEntryPoint("shadeLite")]],
  // (the surface alone, as a forward fragment would shade it: shadeLite's own body and callees but the air and clouds before the
  // surface with the write-out — a composition by the final depth, as liteFinish does now — and the water — J4)
  ["forward surface (all but liteFinish, liteWater)", surfaceRoots()],
];
function surfaceRoots(): string[] {
  const calls = (m as unknown as { calls: Map<string, Map<string, number>> }).calls;
  const entry = tracerEntryPoint("shadeLite");
  // (shadeLite's own body read as a root of its own: its callees but the two left out)
  return [...(calls.get(entry)?.keys() ?? [])].filter((c) => c !== "liteFinish" && c !== "liteWater").concat(["@body"]);
}
const LIMITS = { texture: 16, storage: 8, sampler: 16, uniform: 12 };
const rows = FAMILIES.map(([label, roots]) => {
  const r = reads(roots);
  const count = (k: Kind[]) => [...r.values()].filter((v) => k.includes(v)).length;
  return {
    label,
    functions: new Set(roots.filter((x) => x !== "@body").flatMap((x) => m.reach(x))).size,
    textures: count(["texture"]),
    storage: count(["storage", "storage-rw"]),
    storageRW: count(["storage-rw", "storage-texture"]),
    samplers: count(["sampler"]),
    uniforms: count(["uniform"]),
    names: [...r.keys()].sort(),
  };
});
if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.log(
    `shadeLite's reads — ${profile.label} (WebGPU's default per-stage limits: ${LIMITS.texture} textures, ${LIMITS.storage} storage buffers)`,
  );
  console.log("| family | functions | textures | storage (rw) | samplers | uniforms |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const r of rows)
    console.log(`| ${r.label} | ${r.functions} | ${r.textures} | ${r.storage} (${r.storageRW}) | ${r.samplers} | ${r.uniforms} |`);
  for (const r of rows) console.log(`\n${r.label}: ${r.names.join(", ")}`);
}
