import { expect, test } from "bun:test";
import { defaultSettings } from "../src/settings";
import { checkSave, parseSave, saveFromHash, saveToHash, type GameSave } from "../src/game/save";
import { store } from "../src/util/storage";

// Saved games: a flight round-trips through JSON, a link and the browser's storage; a corrupted one is
// refused (never half-loaded), a setting of the wrong kind repaired.

const save = (): GameSave => ({
  v: 1,
  name: "test",
  savedAt: 1,
  summary: "Earth · IN ORBIT 400 km",
  scene: "game:artemis",
  settings: defaultSettings(),
  time: 109.7,
  ship: {
    piloting: true,
    sas: true,
    hold: "prograde",
    auto: "none",
    throttle: 0.5,
    precision: false,
    speedMode: "orbit",
    landed: null,
    spent: 12,
    properTime: 3,
  },
  plan: null,
});

test("a save round-trips through JSON and a #save= link unchanged", () => {
  const g = save();
  expect(parseSave(JSON.stringify(g))).toEqual(g);
  const back = saveFromHash(saveToHash(g))!;
  expect(back.time).toBe(g.time);
  expect(back.ship).toEqual(g.ship);
  expect(back.settings).toEqual(g.settings);
});

test("a corrupted save is refused with its fault", () => {
  expect(() => parseSave("{}")).toThrow(/version/);
  expect(() => checkSave({ ...save(), time: "soon" })).toThrow(/time/);
  expect(() => checkSave({ ...save(), ship: { ...save().ship, throttle: 2 } })).toThrow(/throttle/);
  expect(() => checkSave({ ...save(), ship: { ...save().ship, landed: { body: "earth", q: [1, 2] } } })).toThrow(/ground/);
  expect(() => checkSave({ ...save(), plan: { nodes: "x" } })).toThrow(/plan/);
  expect(() => parseSave("not json")).toThrow();
});

test("a setting saved as null (a NaN) is repaired to its default, the flight still loads", () => {
  const g = save() as unknown as { settings: Record<string, unknown> };
  g.settings.fov = null;
  const back = checkSave(g);
  expect(back.settings.fov).toBe(defaultSettings().fov);
});

test("storage without a browser: reads fall back, writes say they did not take", () => {
  expect(store.get("kerr.nothing")).toBeNull();
  expect(store.getJSON("kerr.nothing", { a: 1 })).toEqual({ a: 1 });
  expect(typeof store.set("kerr.x", "1")).toBe("boolean");
});
