import { expect, test } from "bun:test";
import { defaultSettings } from "../src/settings";
import { SCHEMA, SCHEMA_BY_KEY, type NumberDef } from "../src/ui/schema";
import { LAB_ONLY, PLAYER_MENU, PLAYER_TABS, playerKeys, RISKY, rowsOf, searchSettings } from "../src/ui/settings/menu";
import { numberAt, stepNumber } from "../src/ui/settings/values";

// The player's settings (PLAN-TITRE-AAA E9): every key the player's screen names is the schema's, placed once; every
// control of the schema's Game section is ranked — on the player's screen or, on purpose, in the Lab only; the
// physics (the hole's spin, its mass) never among the player's (the plan's finding 6); a tab's rows follow the
// state of the game; the common search finds a setting by its French or English label, here or in the Lab; a
// number's arrows and its bar stay within its range, on its step.

test("every key placed once, every one the schema's; every game control ranked", () => {
  const keys = playerKeys();
  expect(new Set(keys).size).toBe(keys.length);
  for (const k of keys) expect(SCHEMA_BY_KEY.has(k)).toBe(true);
  for (const k of LAB_ONLY) {
    expect(SCHEMA_BY_KEY.has(k)).toBe(true);
    expect(keys).not.toContain(k);
  }
  const unranked = SCHEMA.filter((d) => d.section === "game" && !keys.includes(d.key) && !LAB_ONLY.includes(d.key)).map((d) => d.key);
  expect(unranked).toEqual([]);
  // (the physics stays in the Lab)
  for (const k of ["spin", "massSolar", "diskTemp", "shiftMode"] as const) expect(keys).not.toContain(k);
  // (each tab has rows; the risky ones are on the screen)
  for (const tab of PLAYER_TABS) expect(PLAYER_MENU.some((g) => g.tab === tab.id)).toBe(true);
  for (const k of RISKY) expect(PLAYER_MENU.some((g) => g.keys.includes(k))).toBe(true);
  expect(PLAYER_MENU.flatMap((g) => g.keys)).toContain("@quality");
  expect(PLAYER_MENU.flatMap((g) => g.keys)).toContain("@language");
});

test("a tab's rows follow the game's state: a control hidden now is left out", () => {
  const s = defaultSettings();
  const all = rowsOf("graphics", s).flatMap((g) => g.keys);
  expect(all[0]).toBe("@quality");
  const hidden = SCHEMA.filter((d) => d.visible && !d.visible(s)).map((d) => d.key);
  for (const k of all) expect(hidden).not.toContain(k);
});

test("the common search: a setting by its English or French label, here or in the Lab", () => {
  const walk = searchSettings("walking");
  expect(walk.player.map((x) => x.key)).toContain("walkSpeed");
  expect(walk.player.find((x) => x.key === "walkSpeed")!.tab).toBe("game");
  // (the hole's spin: in the Lab only)
  const spin = searchSettings("spin");
  expect(spin.lab).toContain("spin");
  expect(spin.player.map((x) => x.key)).not.toContain("spin");
  expect(searchSettings("x").player).toEqual([]);
});

test("a number's arrows and its bar: within its range, on its step", () => {
  const d = SCHEMA_BY_KEY.get("walkSpeed") as NumberDef;
  let v = d.min;
  for (let i = 0; i < 100; i++) v = stepNumber(d, v, 1);
  expect(v).toBe(d.max);
  for (let i = 0; i < 100; i++) v = stepNumber(d, v, -1);
  expect(v).toBe(d.min);
  expect(numberAt(d, 0)).toBe(d.min);
  expect(numberAt(d, 1)).toBe(d.max);
  expect(numberAt(d, 2)).toBe(d.max);
  const log = SCHEMA.find((x) => x.type === "number" && (x as NumberDef).scale === "log") as NumberDef;
  const up = stepNumber(log, log.min, 1);
  expect(up).toBeGreaterThan(log.min);
  expect(up).toBeLessThanOrEqual(log.max);
});
