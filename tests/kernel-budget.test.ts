import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PROFILES, profileConstants, tracerSource } from "../scripts/lib/kernel-profiles";
import { InlineModel } from "../scripts/lib/wgsl-inline";

// The tracer's kernels once every call is inlined (what D3D12 compiles: its compile time follows this size, about
// linearly — docs/progress/kernels/BASELINE.md), per reference scene, under a budget: a change that copies a large
// function again (a new call site of the ground, of a noise in an unrolled loop, of ourSegment) fails here, before a
// Windows player waits minutes for it. docs/PLAN-LEAN-TRACER-KERNELS.md P10.
//
// The budgets: tests/kernel-budget.json, each the size measured when it was set plus 10 %. After a change that
// legitimately grows a kernel (or shrinks one: tighten it), rewrite them:
//   KB_WRITE=1 bun test tests/kernel-budget.test.ts
// The sizes themselves: bun scripts/wgsl-inline-size.ts [profile entry].

const FILE = new URL("./kernel-budget.json", import.meta.url).pathname;
const MARGIN = 1.1;

const src = tracerSource();
const sizes = PROFILES.flatMap((p) =>
  p.entries.map((entry) => {
    const m = new InlineModel(src, profileConstants(p, entry));
    return { id: `${p.id} ${entry}`, inlined: m.size(entry === "discs" ? "main" : entry).inlined };
  }),
);

if (process.env.KB_WRITE === "1") {
  const out = Object.fromEntries(sizes.map((s) => [s.id, Math.ceil((s.inlined * MARGIN) / 1000) * 1000]));
  writeFileSync(FILE, `${JSON.stringify(out, null, 1)}\n`);
}

describe("the tracer's inlined kernels stay under their budgets", () => {
  const budget: Record<string, number> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
  for (const s of sizes)
    test(s.id, () => {
      const b = budget[s.id];
      expect(b, `no budget for ${s.id}: KB_WRITE=1 bun test tests/kernel-budget.test.ts`).toBeDefined();
      if (s.inlined > b!)
        throw new Error(
          `${s.id}: ${s.inlined} inlined lines, over its budget of ${b} — what grew: bun scripts/wgsl-inline-size.ts ${s.id}`,
        );
    });
});
