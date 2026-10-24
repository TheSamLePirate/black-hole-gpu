#!/usr/bin/env bun
// An e2e run against both sides of scripts/ab-commit.ts, interleaved (A B B A, AB_ROUNDS pairs — default 2): the test
// given each side's server as E2E_URL and AB_SIDE=A|B, AB_RUN=<n> (a test names its results with them — the buildings'
// BLD_LABEL defaults to them). Executable so that AB_CMD can name it alone (the remote runner passes no spaces):
//   bun scripts/remote.ts run -- AB_E2E=tests/e2e/buildings.e2e.test.ts AB_CMD=scripts/ab-e2e.ts bun scripts/ab-commit.ts <rev>
import { $ } from "bun";

const file = process.env.AB_E2E;
if (!file) throw new Error("AB_E2E=<the e2e file> wanted");
const a = process.env.AB_A_URL,
  b = process.env.AB_B_URL;
if (!a || !b) throw new Error("AB_A_URL and AB_B_URL wanted (scripts/ab-commit.ts sets them)");
const rounds = Number(process.env.AB_ROUNDS ?? 2);
const order: ("A" | "B")[] = [];
for (let r = 0; r < rounds; r++) order.push(...(r % 2 ? (["B", "A"] as const) : (["A", "B"] as const)));
let failed = 0;
for (const [i, side] of order.entries()) {
  console.log(`== ${side} (run ${i + 1}/${order.length})`);
  const r = await $`bun test ${file} --timeout 1800000`
    .env({ ...process.env, E2E: "1", E2E_URL: side === "A" ? a : b, AB_SIDE: side, AB_RUN: String(i + 1) })
    .nothrow();
  if (r.exitCode) failed++;
}
console.log(`ab-e2e: ${order.length} runs, ${failed} failed`);
