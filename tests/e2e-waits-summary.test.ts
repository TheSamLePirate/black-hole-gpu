import { expect, test } from "bun:test";
import { summarise } from "../scripts/e2e-waits";

// The long waits' measures read (audit 2026-11-10, QA-09): what a cap could be — twice the longest it took, a minute at least,
// rounded up to 10 s — only for a wait always met; one that once was not: none proposed.

test("a cap proposed from the longest run; none for a wait not always met", () => {
  const s = summarise([
    { file: "a.e2e.test.ts", line: 10, cap: 240_000, took: 21_000, met: true },
    { file: "a.e2e.test.ts", line: 10, cap: 240_000, took: 34_500, met: true },
    { file: "a.e2e.test.ts", line: 40, cap: 180_000, took: 12_000, met: true },
    { file: "b.e2e.test.ts", line: 5, cap: 300_000, took: 300_000, met: false },
    { file: "b.e2e.test.ts", line: 5, cap: 300_000, took: 40_000, met: true },
  ]);
  expect(s.map((w) => w.at)).toEqual(["b.e2e.test.ts:5", "a.e2e.test.ts:10", "a.e2e.test.ts:40"]);
  expect(s[1]).toMatchObject({ runs: 2, met: 2, longest: 34_500, could: 70_000 });
  expect(s[2]!.could).toBe(60_000);
  expect(s[0]!.could).toBeNull();
});
