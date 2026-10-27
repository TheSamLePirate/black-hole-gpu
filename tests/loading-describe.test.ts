import { expect, test } from "bun:test";
import { clock, loading } from "../src/loading";

test("a compile stage says how long it has run, and the time left when known — not a share creeping to 95 %", () => {
  let left: number | null = null;
  const s = loading.stage("t-compile", "Compiling", { indeterminate: true, eta: 30, remaining: () => left });
  const at = s.startedAt;
  // (unknown: the time run only — the old display read "94 %" after 2 min 17 s)
  expect(loading.describe(s, at + 137_000)).toBe("2:17");
  expect(loading.describe(s, at + 12_000)).toBe("12 s");
  // (known: the share follows it, the words say it)
  left = 60;
  expect(loading.describe(s, at + 60_000)).toBe("1:00 · ~1:00 left");
  expect(loading.fracOf(s, at + 60_000)).toBeCloseTo(0.5, 2);
  // (never full while running)
  left = 0;
  expect(loading.fracOf(s, at + 60_000)).toBeLessThanOrEqual(0.97);
  loading.done("t-compile");
  expect(loading.describe(s)).toBe("");
  // (a measured stage keeps its share)
  const m = loading.stage("t-measured", "Download");
  loading.set("t-measured", 0.42);
  expect(loading.describe(m)).toBe("42 %");
  loading.done("t-measured");
  expect(clock(59.6)).toBe("1:00");
  expect(clock(3)).toBe("3 s");
});
