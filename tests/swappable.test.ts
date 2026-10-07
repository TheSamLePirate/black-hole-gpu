import { expect, test } from "bun:test";
import { swappable } from "../src/util/swappable";

// A stable handle on a replaceable object (PLAN-MONDE M2: the renderer rebuilt on a new GPU device).

class Thing {
  n: number;
  cb: ((x: number) => number) | null = null;
  inner = { clock: 0 };
  constructor(n: number) {
    this.n = n;
  }
  twice() {
    return this.n * 2;
  }
  get half() {
    return this.n / 2;
  }
}

test("reads, writes, calls and getters go to the object behind; swapped, to the new one", () => {
  const h = swappable(new Thing(3));
  const r = h.proxy;
  expect(r.twice()).toBe(6);
  expect(r.half).toBe(1.5);
  r.inner.clock = 7;
  expect(h.current().inner.clock).toBe(7);
  // (a method taken off the handle runs on the object it was taken from)
  const f = r.twice;
  h.swap(new Thing(10));
  expect(r.twice()).toBe(20);
  expect(f()).toBe(6);
  r.n = 4;
  expect(h.current().n).toBe(4);
  expect(r instanceof Thing).toBe(true);
});

test("a callback set again is called as set; one method bound once per object", () => {
  const h = swappable(new Thing(1));
  const r = h.proxy;
  r.cb = (x) => x + 1;
  expect(r.cb?.(1)).toBe(2);
  r.cb = (x) => x * 10;
  expect(r.cb?.(2)).toBe(20);
  expect(r.twice).toBe(r.twice);
});
