import { expect, test } from "bun:test";
import { Session } from "../src/game/session";

// Who holds the flight (src/game/session.ts; audit AR-02, AR-12 — wave 4.8's second lot): one answer the loop asks.

test("nothing holding: the flight runs; each holder holds it, the first named", () => {
  const ext = { rendering: false, replaying: false };
  const s = new Session({ rendering: () => ext.rendering, replaying: () => ext.replaying });
  expect(s.runs).toBe(true);
  expect(s.holder()).toBeNull();
  ext.replaying = true;
  expect(s.holder()).toBe("replay");
  ext.rendering = true;
  expect(s.holder()).toBe("render");
  s.gpuHeld = true;
  expect(s.holder()).toBe("gpu");
  s.paused = true;
  expect(s.holder()).toBe("paused");
  s.frozen = true;
  expect(s.holder()).toBe("frozen");
  expect(s.runs).toBe(false);
});

test("the world's motion: held by the automation and the menus only — not by a render, a replay or the GPU's recovery", () => {
  const s = new Session({ rendering: () => true, replaying: () => true });
  s.gpuHeld = true;
  expect(s.runs).toBe(false);
  expect(s.moving).toBe(true);
  s.paused = true;
  expect(s.moving).toBe(false);
  s.paused = false;
  s.frozen = true;
  expect(s.moving).toBe(false);
});
