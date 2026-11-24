// The flight keys and the OBC's screens: a screen that takes the keyboard never stops a key's release (a flight key
// held through the click or the F11 stayed pressed: controls.ts never saw its keyup), does not type the auto-repeat
// of a key held before it took the keyboard, and while its Linux is still starting leaves the keys to the flight.

import { expect, test } from "bun:test";
import { KeyHoldGate } from "../src/obc/held-keys";
import { CockpitScreenCapture, isCockpitScreenCaptured } from "../src/obc/screen-capture";

/** A keyboard event's stand-in: what the handlers called on it. */
function key(k: string, code: string, extra: Partial<KeyboardEvent> = {}) {
  const calls = { prevented: 0, stopped: 0 };
  const e = {
    key: k,
    code,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => calls.prevented++,
    stopPropagation: () => calls.stopped++,
    stopImmediatePropagation: () => calls.stopped++,
    ...extra,
  };
  return { e: e as unknown as KeyboardEvent, calls };
}

function rig(phase: string, fbActive = false) {
  const written: string[] = [];
  const st = { phase, fbActive };
  const obc = {
    status: () => st,
    boot: async () => st,
    write: (s: string) => written.push(s),
    sendPointer: () => {},
    sendWheel: () => {},
  };
  const cap = new CockpitScreenCapture(
    obc as never,
    () => null,
    () => false,
  );
  const h = cap as unknown as { handleKeyDown(e: KeyboardEvent): void; handleKeyUp(e: KeyboardEvent): void };
  return { cap, h, written, st };
}

test("KeyHoldGate: a fresh press and its repeats are the screen's; the repeat of a key held before is not", () => {
  const g = new KeyHoldGate();
  g.reset();
  // (Z held before the screen took the keyboard: its auto-repeat is refused)
  expect(g.accept({ code: "KeyW", repeat: true })).toBe(false);
  // (a fresh press, then its repeats: accepted)
  expect(g.accept({ code: "KeyA", repeat: false })).toBe(true);
  expect(g.accept({ code: "KeyA", repeat: true })).toBe(true);
  // (let go, then the held-before key pressed again fresh: the screen's)
  g.release({ code: "KeyA" });
  expect(g.accept({ code: "KeyA", repeat: true })).toBe(false);
  expect(g.accept({ code: "KeyW", repeat: false })).toBe(true);
  // (no code — a synthetic event —: never refused)
  expect(g.accept({ code: "", repeat: true })).toBe(true);
});

test("CockpitScreenCapture never stops a keyup (the flight key held through the click is released)", () => {
  const { cap, h } = rig("ready");
  cap.attach({ id: "f35:pcd:obc", label: "F-35 PCD · OBC", kind: "obc" });
  expect(isCockpitScreenCaptured()).toBe(true);
  // (positive witness of the old defect: a keyup in capture was stopped; now nothing is called on it)
  for (const [k, code] of [
    ["z", "KeyW"],
    ["q", "KeyA"],
    ["F11", "F11"],
    ["Shift", "ShiftLeft"],
  ] as const) {
    const { e, calls } = key(k, code);
    h.handleKeyUp(e);
    expect(calls).toEqual({ prevented: 0, stopped: 0 });
  }
  cap.release();
  cap.dispose();
});

test("CockpitScreenCapture: the auto-repeat of a flight key held before the click is not typed, a fresh press is", () => {
  const { cap, h, written } = rig("ready");
  cap.attach({ id: "f35:pcd:obc", label: "F-35 PCD · OBC", kind: "obc" });
  const held = key("z", "KeyW", { repeat: true });
  h.handleKeyDown(held.e);
  expect(written).toEqual([]);
  expect(held.calls).toEqual({ prevented: 0, stopped: 0 });
  // (negative witness: a key pressed on the screen is typed and kept from the game)
  const fresh = key("l", "KeyL");
  h.handleKeyDown(fresh.e);
  expect(written).toEqual(["l"]);
  expect(fresh.calls.prevented).toBe(1);
  expect(fresh.calls.stopped).toBeGreaterThan(0);
  cap.release();
  cap.dispose();
});

test("CockpitScreenCapture: while its Linux starts, the keys fly the craft (not captured, not swallowed)", () => {
  const { cap, h, written, st } = rig("booting");
  cap.attach({ id: "a320:lecam:obc", label: "A320 LECAM · OBC", kind: "obc" });
  expect(cap.active).toBe(true);
  expect(cap.ownsKeys()).toBe(false);
  // (isTyping() lets the flight keys through)
  expect(isCockpitScreenCaptured()).toBe(false);
  const k = key("z", "KeyW");
  h.handleKeyDown(k.e);
  expect(written).toEqual([]);
  expect(k.calls).toEqual({ prevented: 0, stopped: 0 });
  // (Linux ready: the screen takes the keys)
  st.phase = "ready";
  expect(cap.ownsKeys()).toBe(true);
  expect(isCockpitScreenCaptured()).toBe(true);
  const k2 = key("x", "KeyX");
  h.handleKeyDown(k2.e);
  expect(written).toEqual(["x"]);
  cap.release();
  expect(isCockpitScreenCaptured()).toBe(false);
  cap.dispose();
});

test("CockpitScreenCapture: /dev/fb0 drawn counts as taking the keys; an MCDU always does", () => {
  const fb = rig("booting", true);
  fb.cap.attach({ id: "f35:pcd:obc", label: "F-35 PCD · OBC", kind: "obc" });
  expect(isCockpitScreenCaptured()).toBe(true);
  fb.cap.release();
  fb.cap.dispose();
  const m = rig("off");
  m.cap.attach({ id: "a320:mcdu:0", label: "MCDU 1", kind: "mcdu", side: 0 });
  expect(isCockpitScreenCaptured()).toBe(true);
  m.cap.release();
  m.cap.dispose();
});
