import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// One Bun everywhere (audit 2026-11-10, QA-05): the site's CI took the latest — 1.4.4 on 14 Nov 2026 —, this Mac, the pre-push check and
// the room server's CI 1.3.14, the room server's image « 1.3 ». .bun-version says it; every workflow's setup-bun and the room server's
// image hold to it, and the Bun running these tests is it.

const ROOT = join(import.meta.dir, "..");
const want = readFileSync(join(ROOT, ".bun-version"), "utf8").trim();

test("every setup-bun, the room server's image and this Bun: .bun-version's", () => {
  expect(want).toMatch(/^\d+\.\d+\.\d+$/);
  const dir = join(ROOT, ".github/workflows");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
    const L = readFileSync(join(dir, f), "utf8").split("\n");
    L.forEach((l, i) => {
      if (!l.includes("oven-sh/setup-bun")) return;
      const block = L.slice(i + 1, i + 5).join("\n");
      expect({ f, line: i + 1, v: block.match(/bun-version:\s*([\d.]+)/)?.[1] ?? null }).toEqual({ f, line: i + 1, v: want });
    });
  }
  expect(readFileSync(join(ROOT, "deploy/Dockerfile.rooms"), "utf8")).toContain(`FROM oven/bun:${want}-`);
  expect(Bun.version).toBe(want);
});
