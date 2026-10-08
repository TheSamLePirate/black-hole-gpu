import { expect, test } from "bun:test";
import type { DeviceSnapshot } from "../src/input/axes";
import { KNOWN, presetFor, standardTemplate } from "../src/input/profiles";

// PLAN-HOTAS H3: the known controllers recognised (by their ids, else their names), a generic profile for a
// flight device not known, nothing for pads — the standard ones keep their built-in mapping.

const dev = (model: string, name: string, axes = 6, standard = false): DeviceSnapshot => ({
  model,
  name,
  standard,
  axes: Array.from({ length: axes }, () => 0),
  buttons: Array.from({ length: 12 }, () => 0),
});

test("known by their ids: a T.16000M stick, a TWCS throttle, TFRP pedals", () => {
  const s = presetFor(dev("044f:b10a", "T.16000M"))!;
  expect(s.name).toBe("Thrustmaster T.16000M");
  expect(s.bindings.map((b) => ("target" in b ? b.target : null)).filter(Boolean)).toEqual(["roll", "pitch", "yaw"]);
  const t = presetFor(dev("044f:b687", "TWCS Throttle"))!;
  expect(t.bindings.find((b) => "target" in b && b.target === "throttle")).toBeDefined();
  const p = presetFor(dev("044f:b679", "T.Flight Rudder Pedals"))!;
  expect(p.bindings.map((b) => ("target" in b ? b.target : null))).toEqual(["brakeL", "brakeR", "yaw"]);
});

test("known by their names when the browser gives no ids (Safari)", () => {
  expect(presetFor(dev("name:saitek pro flight x52 flight control system", "Saitek Pro Flight X52 Flight Control System"))?.name).toBe(
    "Saitek / Logitech X52",
  );
  expect(presetFor(dev("name:vkbsim gladiator nxt l", "VKBsim Gladiator NXT L"))?.name).toBe("VKB Gladiator");
});

test("a flight device not known: generic — a stick, a throttle, pedals; a pad without the standard mapping: none", () => {
  const st = presetFor(dev("1234:5678", "Generic USB Joystick", 4))!;
  expect(st.bindings.some((b) => "target" in b && b.target === "roll")).toBe(true);
  expect(st.bindings.some((b) => "target" in b && b.target === "throttle")).toBe(true);
  const th = presetFor(dev("1234:5679", "Some Throttle Quadrant", 3))!;
  expect(th.bindings[0]).toMatchObject({ target: "throttle" });
  const pe = presetFor(dev("1234:567a", "Rudder Pedals", 3))!;
  expect(pe.bindings.map((b) => ("target" in b ? b.target : null))).toEqual(["brakeL", "brakeR", "yaw"]);
  expect(presetFor(dev("054c:0ce6", "Wireless Controller", 4))).toBeNull();
  expect(presetFor(dev("045e:028e", "Xbox 360 Controller", 4, true))).toBeNull();
});

test("every known profile is well formed; the standard pad's template mirrors its built-in mapping", () => {
  for (const k of KNOWN) {
    expect(k.ids.every((id) => /^[0-9a-f]{4}:[0-9a-f]{4}$/.test(id))).toBe(true);
    expect(k.bindings.length).toBeGreaterThan(0);
  }
  const t = standardTemplate(dev("045e:028e", "Xbox 360 Controller", 4, true));
  expect(t.bindings.find((b) => "target" in b && b.target === "pitch")).toMatchObject({ source: { kind: "axis", index: 1 } });
  expect(t.bindings.some((b) => "held" in b && b.held === "throttleUp")).toBe(true);
});
