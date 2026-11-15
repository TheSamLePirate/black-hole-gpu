import { expect, test } from "bun:test";
import { setLang } from "../src/crew/lang";
import { type CrewOwn, tileValue } from "../src/crew/tile-value";
import { unitsOf } from "../src/ui/unitsys";

// The crew console's tiles, out of src/crew/main.ts (audit 2026-11-10, QA-10): each tile's figure, unit, state and title from the
// craft's metrics and snapshot — the same code, now tested.

const U = unitsOf("metric");
const own = (o: { age?: number; metrics?: object; snapshot?: object }) =>
  ({ age: 1, metrics: {}, snapshot: {}, ...o }) as unknown as CrewOwn;

test("a craft not heard for 3 s: every tile a dash", () => {
  setLang("en");
  expect(tileValue("alt", own({ age: 5, metrics: { alt: 1200 } }), U, "m").text).toBe("—");
  expect(tileValue("alt", null as unknown as CrewOwn, U, "m").text).toBe("—");
});

test("the altitude in its units, in km past 99 999 m; the vertical speed's arrow and its warning", () => {
  setLang("en");
  expect(tileValue("alt", own({ metrics: { alt: 1234 } }), U, "m")).toEqual({ text: "1,234", unit: "m", state: "" });
  expect(tileValue("alt", own({ metrics: { alt: 150_000 } }), U, "m")).toEqual({ text: "150.0", unit: "km", state: "" });
  expect(tileValue("vz", own({ metrics: { vz: -50 } }), U, "m/s")).toEqual({ text: "▼50", unit: "m/s", state: "warn" });
  expect(tileValue("vz", own({ metrics: { vz: 0.2 } }), U, "m/s").text).toBe("0");
});

test("the fuel in kg when the tanks are known: under a tenth, an alarm; Mach past 1 a warning", () => {
  setLang("en");
  const f = tileValue("fuel", own({ snapshot: { sys: { fuelKg: 500, fuelFull: 6000 } } }), U, "%");
  expect(f).toEqual({ text: "500", unit: "kg", state: "alarm" });
  expect(tileValue("fuel", own({ metrics: { fuel: 0.6 } }), U, "%")).toEqual({ text: "60", unit: "%", state: "ok" });
  expect(tileValue("mach", own({ metrics: { mach: 1.23 } }), U, "").state).toBe("warn");
});

test("the orbit: landed, an escape, an impact coming named in its title", () => {
  setLang("en");
  expect(tileValue("pe", own({ snapshot: { craft: { status: "landed" } } }), U, "km")).toEqual({ text: "landed", unit: "", state: "" });
  expect(tileValue("ap", own({ snapshot: { orbit: { ecc: 1.2, ap: -1, pe: 300 } } }), U, "km")).toEqual({
    text: "escape",
    unit: "",
    state: "",
  });
  const n = tileValue("next", own({ snapshot: { next: { kind: "impact", in: 900 } } }), U, "");
  expect(n.text).toBe("15 min");
  expect(n.state).toBe("alarm");
  expect(n.title).toContain("in");
  setLang("fr");
  expect(tileValue("pe", own({ snapshot: { craft: { status: "landed" } } }), U, "km").text).toBe("posé");
  setLang("en");
});
