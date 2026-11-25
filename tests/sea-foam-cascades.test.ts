// (25 Nov 2026 — PROBLEMES « Nice : la moitié basse de la vue d'approche de 04 en sable ») The world foam (seafft.wgsl foamWorld) sums
// the cascades' Jacobian at the mips the frame before made — its pass runs before this frame's mips. On the sea's first frames those
// mips were still the texture's zeros: a Jacobian of 0 a cascade, the surface "folded" everywhere, foam made over the whole 1 024 m map
// and held while the world stood still (kerr-mini: 70 % of its texels over 0.5, its mean Jacobian 0.997 by then, the threshold 0.63).
// The foam reads only the cascades computed whose mips an encode has made; the sum's count is the uniform's fz.x, the shader's loop's.
import { expect, test } from "bun:test";
import { foamCascades } from "../src/sea/fft-gpu";

test("the world foam reads no cascade before its mips were made once: none on the first encode, the newly computed one a frame late", () => {
  // (the first encode: nothing mipped — no cascade summed, J 1, no foam made)
  expect(foamCascades(4, 0)).toBe(0);
  // (the frames after: those computed and mipped)
  expect(foamCascades(4, 4)).toBe(4);
  // (a descent: the finest cascade computed from this frame on, mipped only at this frame's end — left out once)
  expect(foamCascades(4, 3)).toBe(3);
  // (a climb: fewer computed than once mipped — the computed ones)
  expect(foamCascades(2, 4)).toBe(2);
});

test("the shader's loop reads that count (fz.x), and the foam's pass still runs before the mips", async () => {
  const wgsl = await Bun.file(`${import.meta.dir}/../src/shaders/seafft.wgsl`).text();
  expect(wgsl).toContain("for (var c = 0u; c < u32(F.fz.x + 0.5); c++) {");
  const ts = await Bun.file(`${import.meta.dir}/../src/sea/fft-gpu.ts`).text();
  expect(ts).toContain("foamCascades(active, this.mipped),");
  expect(ts.indexOf("p.setPipeline(this.pipes.foamWorld);")).toBeLessThan(ts.indexOf("p.setPipeline(this.pipes.mip);"));
  expect(ts.indexOf("this.mipped = Math.max(this.mipped, A);")).toBeGreaterThan(ts.indexOf("p.setPipeline(this.pipes.mip);"));
});
