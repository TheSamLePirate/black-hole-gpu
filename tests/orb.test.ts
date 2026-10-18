import { expect, test } from "bun:test";
import { drawOrb, ink, orbStateFor } from "../src/intro/orb";

// The loading orb (src/intro/orb.ts): every state draws, in our colours, and follows the boot's stages.

const STATES = ["working", "searching", "solving", "listening", "connecting", "weaving", "composing", "breathing", "shaping"] as const;

/** a 2D context that counts what is drawn */
function counter() {
  const n = { arcs: 0, lines: 0, styles: new Set<string>() };
  const ctx = new Proxy(
    {},
    {
      get: (_, k) => (k === "arc" ? () => n.arcs++ : k === "lineTo" ? () => n.lines++ : () => {}),
      set: (_, k, v) => {
        if (k === "fillStyle") n.styles.add(String(v));
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, n };
}

test("each of the nine states draws dots", () => {
  for (const s of STATES) {
    const { ctx, n } = counter();
    drawOrb(ctx, s, 64, 64, 128, 1.7);
    expect(n.arcs).toBeGreaterThan(10);
    if (s === "connecting") expect(n.lines).toBeGreaterThan(0);
  }
});

test("near dots warm white, far ones amber and dimmer", () => {
  const near = ink(0, 1);
  const far = ink(1, 1);
  expect(near.slice(0, 3)).toEqual([255, 246, 232]);
  expect(far[0]).toBeGreaterThan(far[2]! * 1.5);
  expect(far[0]).toBeLessThan(near[0]);
  expect(ink(0.5, 0.25)[3]).toBe(0.25);
});

test("the state follows the boot's stages", () => {
  expect(orbStateFor(["gpu", "ephemeris"], false)).toBe("connecting");
  expect(orbStateFor(["ephemeris", "sky"], false)).toBe("searching");
  expect(orbStateFor(["shaders", "sky"], false)).toBe("weaving");
  expect(orbStateFor(["pipelines", "shaders"], false)).toBe("solving");
  expect(orbStateFor(["sky"], true)).toBe("composing");
  expect(orbStateFor([], true)).toBe("breathing");
  expect(orbStateFor([], false)).toBe("working");
});
