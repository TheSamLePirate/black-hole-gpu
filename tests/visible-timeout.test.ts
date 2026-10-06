import { expect, test } from "bun:test";
import { type Visibility, visibleTimeout } from "../src/util/visible-timeout";

/** A page whose visibility the test sets. */
function page(hidden = false) {
  const listeners = new Set<() => void>();
  const p: Visibility & { set(hidden: boolean): void; listeners: Set<() => void> } = {
    hidden,
    listeners,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    set(h: boolean) {
      (this as { hidden: boolean }).hidden = h;
      for (const l of [...listeners]) l();
    },
  };
  return p;
}

test("a visible-time timeout fires after its time seen, the hidden time not counted (audit M7)", async () => {
  const p = page();
  let fired = 0;
  visibleTimeout(300, () => fired++, p);
  await Bun.sleep(20);
  p.set(true);
  await Bun.sleep(400); // (hidden: well past the wall-clock limit)
  expect(fired).toBe(0);
  p.set(false);
  expect(fired).toBe(0);
  await Bun.sleep(400);
  expect(fired).toBe(1);
  expect(p.listeners.size).toBe(0);
});

test("a timeout begun hidden waits for the page to show; a cancelled one never fires", async () => {
  const p = page(true);
  let fired = 0;
  visibleTimeout(20, () => fired++, p);
  await Bun.sleep(40);
  expect(fired).toBe(0);
  p.set(false);
  await Bun.sleep(40);
  expect(fired).toBe(1);
  const cancel = visibleTimeout(20, () => fired++, p);
  cancel();
  await Bun.sleep(40);
  expect(fired).toBe(1);
  expect(p.listeners.size).toBe(0);
});
