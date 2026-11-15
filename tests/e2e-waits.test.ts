import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The e2e's long waits held where they are (audit 2026-11-10, QA-09; Sam: no e2e waits minutes in silence — 30 to 60 s, then fail
// saying what is missing): 1 121 fixed sleeps, 124 conditional waits past 120 s on 10 Nov 2026. A ratchet — each file's count of fixed
// sleeps of 5 s or more and of waits (waitFor, waitOptional, until) past 120 s, as on 14 Nov 2026 (tests/e2e-waits.json): a file may
// lose them, not gain them; a new file has none. `E2E_WAITS=update bun test tests/e2e-waits.test.ts` writes the counts again (after
// removing some). The probes (`zz-`) apart.

const DIR = join(import.meta.dir, "e2e");
const BASE = join(import.meta.dir, "e2e-waits.json");
const ms = (s: string) => Number(s.replace(/_/g, ""));

/** a file's long waits: fixed sleeps ≥ 5 s, conditional waits > 120 s */
export function longWaits(src: string): { sleeps: number; waits: number } {
  let sleeps = 0;
  for (const m of src.matchAll(/Bun\.sleep\(\s*([\d_]+)\s*\)/g)) if (ms(m[1]!) >= 5000) sleeps++;
  let waits = 0;
  // (the cap is the call's last argument: `near("Airliner", 8000), 150_000)` — the lazy match took the 8000 and missed the cap, 15 Nov 2026)
  for (const m of src.matchAll(/\.(?:waitFor|waitOptional|until)\([^;]*,\s*([\d_]+)\s*\)/g)) if (ms(m[1]!) > 120_000) waits++;
  return { sleeps, waits };
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".e2e.test.ts") && !f.startsWith("zz-"));
const now: Record<string, { sleeps: number; waits: number }> = {};
for (const f of files) {
  const w = longWaits(readFileSync(join(DIR, f), "utf8"));
  if (w.sleeps || w.waits) now[f] = w;
}

test("a cap after another number in the call: counted (15 Nov 2026)", () => {
  expect(longWaits(`await app.waitFor(near("Airliner", 8000), 150_000);`).waits).toBe(1);
  expect(longWaits(`await app.waitFor(near("Airliner", 8000), 60_000);`).waits).toBe(0);
});

test("the count's witnesses: a sleep of 5 s and a wait of 10 min counted; shorter ones not", () => {
  expect(
    longWaits(`await Bun.sleep(5_000); await Bun.sleep(4999); await app.waitFor("x", 600_000); await app.waitFor("y", 120_000);`),
  ).toEqual({
    sleeps: 1,
    waits: 1,
  });
});

test("no e2e gains a long wait; a new one has none", () => {
  if (process.env.E2E_WAITS === "update" || !existsSync(BASE)) {
    const sorted = Object.fromEntries(
      Object.keys(now)
        .sort()
        .map((k) => [k, now[k]]),
    );
    writeFileSync(BASE, `${JSON.stringify(sorted, null, 1)}\n`);
    return;
  }
  const base = JSON.parse(readFileSync(BASE, "utf8")) as Record<string, { sleeps: number; waits: number }>;
  const grew = Object.entries(now)
    .filter(([f, w]) => w.sleeps > (base[f]?.sleeps ?? 0) || w.waits > (base[f]?.waits ?? 0))
    .map(([f, w]) => ({ f, now: w, was: base[f] ?? null }));
  const total = (o: Record<string, { sleeps: number; waits: number }>) =>
    Object.values(o).reduce((s, w) => ({ sleeps: s.sleeps + w.sleeps, waits: s.waits + w.waits }), { sleeps: 0, waits: 0 });
  console.log(`  long waits now ${JSON.stringify(total(now))}, held at ${JSON.stringify(total(base))}`);
  expect(grew).toEqual([]);
});
