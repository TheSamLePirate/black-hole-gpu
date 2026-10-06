import { expect, test } from "bun:test";
import { defaultSettings, pickSettings, SETTING_KIND, settingKeys } from "../src/settings";
import { checkSave, migrateSave, parseSave, SAVE_VERSION, saveFromHash, saveToHash, type GameSave } from "../src/game/save";
import { storageKey, store } from "../src/util/storage";

// Saved games: a flight round-trips through JSON, a link and the browser's storage; a corrupted one is
// refused (never half-loaded), a setting of the wrong kind repaired.

const save = (): GameSave => ({
  v: 2,
  name: "test",
  savedAt: 1,
  summary: "Earth · IN ORBIT 400 km",
  scene: "game:artemis",
  settings: pickSettings(defaultSettings(), "carried", "scene"),
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

test("a saved tunnel retains its entry universe and a flight plan retains its frame", () => {
  const g = save();
  g.ship.tunnelEntry = "gargantua";
  g.plan = { nodes: [], note: "", mission: null, universe: "ours" };
  expect(parseSave(JSON.stringify(g))).toEqual(g);
  expect(saveFromHash(saveToHash(g))!.ship.tunnelEntry).toBe("gargantua");
  expect(() => checkSave({ ...g, ship: { ...g.ship, tunnelEntry: "unknown" } })).toThrow();
  expect(() => checkSave({ ...g, plan: { ...g.plan, universe: "unknown" } })).toThrow();
  // Older v2 saves have no frame metadata and remain valid.
  expect(checkSave(save()).ship.tunnelEntry).toBeUndefined();
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

test("storage keys: the site's unchanged at the root; a preview's (the CI's test/) apart", () => {
  expect(storageKey("kerr.autosave")).toBe("kerr.autosave");
  expect(storageKey("kerr.autosave", "")).toBe("kerr.autosave");
  expect(storageKey("kerr.tier", "test")).toBe("test/kerr.tier");
});

test("a version 1 save (every setting) loads: migrated, the player's own left out", () => {
  const v1 = { ...save(), v: 1, settings: { ...defaultSettings(), pixelRatio: 0.5, soundVolume: 0.1, hudBank: false, spin: 0.6 } };
  const g = checkSave(v1);
  expect(g.v).toBe(SAVE_VERSION);
  expect(g.settings.spin).toBe(0.6);
  for (const k of ["pixelRatio", "soundVolume", "hudBank", "quality"]) expect(k in g.settings).toBe(false);
  expect(migrateSave({ v: 2, x: 1 })).toEqual({ v: 2, x: 1 });
});

test("a save from a later version is refused; settings the game does not know are left out", () => {
  expect(() => checkSave({ ...save(), v: 3 })).toThrow(/version 3/);
  const g = checkSave({ ...save(), settings: { ...save().settings, warpDrive: true } });
  expect("warpDrive" in g.settings).toBe(false);
});

test("every setting has a kind; the player's own are the budget, the display, the sound, the aids", () => {
  expect(Object.keys(SETTING_KIND).sort()).toEqual(Object.keys(defaultSettings()).sort());
  const pref = settingKeys("pref");
  for (const k of ["pixelRatio", "quality", "realtimeBudget", "soundVolume", "hudHorizon", "hudDock", "autosave"] as const)
    expect(pref).toContain(k);
  // (where the ship is, when, what it flies: the scene's)
  for (const k of ["distance", "spin", "vessel", "timeSpeed", "target"] as const) expect(SETTING_KIND[k]).toBe("scene");
});
