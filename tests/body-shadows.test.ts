import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { addEphemeris } from "../src/system/de440";
import { activeShadows, moonLightShare, shadowParams, spunAxes } from "../src/eclipse/shadows-gpu";
import { tOf } from "../src/eclipse/core";
import { solarBody, solarState } from "../src/system/solar";
import type { GpuBody } from "../src/system/scene-bodies";
import type { Vec3 } from "../src/physics";

// PLAN-CIEL C6: the shadows our bodies cast on one another, for the tracer — the pairs found, the Moon's
// light in the Earth's shadow (the lunar eclipse of 7 September 2025).

beforeAll(() => {
  for (const f of ["de440.bin", "jup365.bin"]) {
    const b = readFileSync(`assets/ephemeris/${f}`);
    addEphemeris(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
});

const body = (id: string, t: number, kind = 1): GpuBody =>
  ({ id, pos: solarState(id, t).pos, radius: solarBody(id)!.radius, kind, pole: [0, 0, 1], spin: 0 }) as unknown as GpuBody;

test("the turning axes as the tracer builds them: orthonormal, the pole last", () => {
  const n: Vec3 = [0.3, -0.4, Math.sqrt(1 - 0.25)];
  const A = spunAxes(n, 1.1);
  const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  expect(d(A[0], A[0])).toBeCloseTo(1, 9);
  expect(d(A[0], A[1])).toBeCloseTo(0, 9);
  expect(d(A[1], A[2])).toBeCloseTo(0, 9);
  expect(A[2]).toEqual(n);
});

test("the Moon's light in the Earth's shadow: whole a week before, ~10⁻⁴ at the 2025 eclipse's height", () => {
  const share = (iso: string) => {
    const t = tOf(Date.parse(iso));
    const E = solarState("earth", t).pos,
      M = solarState("moon", t).pos,
      S = solarState("sun", t).pos;
    return moonLightShare(
      E,
      M,
      S,
      solarBody("earth")!.radius * 0.99834 * (1 + 1 / 85),
      solarBody("moon")!.radius,
      solarBody("sun")!.radius,
    );
  };
  expect(share("2025-08-31T18:00:00Z")).toBe(1);
  const max = share("2025-09-07T18:12:00Z");
  expect(max).toBeGreaterThan(1e-6);
  expect(max).toBeLessThan(1e-3);
  // (partial, before the totality: some of it sunlit)
  const part = share("2025-09-07T17:00:00Z");
  expect(part).toBeGreaterThan(0.02);
  expect(part).toBeLessThan(0.6);
});

test("the pairs: the Earth's on the Moon at the eclipse; Io's on Jupiter at its shadow transit; none at other times", () => {
  const at = (iso: string, ids: string[]) => {
    const t = tOf(Date.parse(iso));
    const list = [body("sun", t, 0), ...ids.map((id) => body(id, t))];
    return { list, pairs: activeShadows(list, 0, solarState("earth", t).pos).map((p) => `${list[p.o]!.id}→${list[p.r]!.id}`) };
  };
  expect(at("2025-09-07T18:12:00Z", ["earth", "moon"]).pairs).toEqual(["earth→moon"]);
  expect(at("2025-08-31T18:00:00Z", ["earth", "moon"]).pairs).toEqual([]);
  // (Io's shadow on Jupiter, 11 October 2026 ~00:04 UTC as seen from the Earth — 46 min of light earlier there)
  const j = at("2026-10-10T23:18:00Z", ["jupiter", "io", "europa"]);
  expect(j.pairs).toContain("io→jupiter");
  // (packed: the receiver's index + 1, the occluder's air)
  const p = shadowParams(j.list, 0, [0, 0, 0]);
  expect(p[8]).toBe(2);
  expect(p[9]).toBe(0);
});
