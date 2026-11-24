import { expect, test } from "bun:test";
import { type FbFrameSource, FbPuller } from "../src/obc/fb-pull";

// The /dev/fb0 poll (review of 24 Nov 2026): one reused buffer, no conversion while unkernel's frameSeq is unchanged.

/** A fake WorkerKernel display: `draw()` makes a new frame (frameSeq + 1); frame(out) converts into out when it fits. */
function fakeKernel(width = 640, height = 480, withSeq = true) {
  let seq = 0;
  let allocations = 0;
  let requests = 0;
  let pixel = 0;
  const src: FbFrameSource & { draw(): void; allocations: number; requests: number } = {
    frame(out) {
      requests++;
      const n = width * height * 4;
      const data = out && out.length === n ? out : (allocations++, new Uint8ClampedArray(n));
      data[0] = pixel;
      return { width, height, data };
    },
    requestFrame() {
      requests++;
    },
    draw() {
      seq++;
      pixel = (pixel + 1) & 255;
    },
    get allocations() {
      return allocations;
    },
    get requests() {
      return requests;
    },
  };
  if (withSeq) Object.defineProperty(src, "frameSeq", { get: () => seq });
  return src;
}

test("a still picture is converted once; later polls only ask for the next frame", () => {
  const k = fakeKernel();
  const p = new FbPuller();
  const first = p.pull(k, false);
  expect(first).not.toBeNull();
  for (let i = 0; i < 30; i++) expect(p.pull(k, true)).toBeNull();
  expect(p.conversions).toBe(1);
  expect(k.allocations).toBe(1);
  // (each skipped poll still asked for a newer frame, so the next one arrives)
  expect(k.requests).toBe(31);
});

test("each new frame is converted into the same buffer (no 1.2 MB allocation per poll)", () => {
  const k = fakeKernel();
  const p = new FbPuller();
  const a = p.pull(k, false)!;
  k.draw();
  const b = p.pull(k, true)!;
  k.draw();
  const c = p.pull(k, true)!;
  expect(b.data).toBe(a.data);
  expect(c.data).toBe(a.data);
  expect(c.data[0]).toBe(2);
  expect(k.allocations).toBe(1);
  expect(p.conversions).toBe(3);
});

test("a mode change re-converts; a size change reallocates once; release lets the buffer go", () => {
  const k = fakeKernel();
  const p = new FbPuller();
  p.pull(k, false);
  p.reset();
  expect(p.pull(k, true)).not.toBeNull();
  const bigger = fakeKernel(1024, 768);
  const f = p.pull(bigger, false)!;
  expect(f.data.length).toBe(1024 * 768 * 4);
  p.release();
  expect(p.pull(k, true)).not.toBeNull();
});

test("a kernel without frameSeq (on this thread) is still converted each poll, into the reused buffer", () => {
  const k = fakeKernel(640, 480, false);
  const p = new FbPuller();
  for (let i = 0; i < 5; i++) expect(p.pull(k, i > 0)).not.toBeNull();
  expect(k.allocations).toBe(1);
  expect(p.conversions).toBe(5);
});
