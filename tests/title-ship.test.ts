import { expect, test } from "bun:test";
import { presets } from "../src/settings";
import { SCENE_THUMBS } from "../src/ui/scene-thumbs";
import type { TitleGame } from "../src/ui/title/activities";
import { CRAFT, DESTINATIONS, launchShip, sheetLines, shipItems } from "../src/ui/title/ship";

// By ship on the title (PLAN-TITRE-AAA E5): the hangar's sheets (from the craft's own definitions), each craft's
// missions and scenes (their scenes exist, the missions the Ranger's), the destinations — a ground closed to the
// Endurance, which never lands —, and each launch reaching the game by the call it says, the craft first.

const fake = () => {
  const calls: string[] = [];
  const g = new Proxy({} as TitleGame, {
    get:
      (_, k) =>
      (...a: unknown[]) => {
        calls.push(`${String(k)}(${a.map((x) => JSON.stringify(x)).join(",")})`);
        return "";
      },
  });
  return { g, calls };
};

test("the hangar: three craft, their sheets from their definitions", () => {
  expect(CRAFT.map((c) => c.id)).toEqual(["ranger", "lander", "endurance"]);
  const [ranger, lander, endurance] = CRAFT;
  expect(ranger!.accel).toBe(1);
  expect(lander!.massT).toBeGreaterThan(ranger!.massT);
  expect(endurance!.lands).toBe(false);
  for (const c of CRAFT) expect(c.role.fr && c.role.en).toBeTruthy();
  expect(sheetLines(ranger!, "en")).toEqual([
    ["Mass", "40 t"],
    ["Push (Ranger = 1)", "× 1"],
    ["Lands", "yes"],
    ["Flies in the air", "yes"],
  ]);
  expect(sheetLines(endurance!, "fr")[2]).toEqual(["Se pose", "non"]);
  expect(sheetLines(endurance!, "fr")[1]![1]).toBe("× 0.12");
});

test("each craft's missions and scenes: their scenes and pictures exist; the missions are the Ranger's", () => {
  expect(shipItems("ranger").missions.length).toBeGreaterThanOrEqual(5);
  expect(shipItems("ranger").missions.every((x) => x.mark?.fr.includes("min"))).toBe(true);
  for (const v of ["ranger", "lander", "endurance"] as const) {
    const { missions, destinations } = shipItems(v);
    expect(missions.length).toBeGreaterThanOrEqual(1);
    for (const x of [...missions, ...destinations]) {
      if (x.scene) expect(presets[x.scene]).toBeTruthy();
      expect(SCENE_THUMBS[x.art!]).toBeTruthy();
      expect(x.title.fr && x.title.en && x.text.fr && x.text.en).toBeTruthy();
    }
    expect(destinations).toHaveLength(DESTINATIONS.length);
  }
  const ids = CRAFT.flatMap((c) => [...shipItems(c.id).missions]).map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the grounds: open to the Ranger and the Lander, closed to the Endurance (shown, with why)", () => {
  const closed = (v: "ranger" | "lander" | "endurance") =>
    shipItems(v)
      .destinations.filter((d) => d.locked)
      .map((d) => d.id);
  expect(closed("ranger")).toEqual([]);
  expect(closed("lander")).toEqual([]);
  expect(closed("endurance")).toEqual(["dest:moon-ground", "dest:mars-ground"]);
  const moon = shipItems("endurance").destinations.find((d) => d.id === "dest:moon-ground")!;
  expect(moon.locked!.en).toMatch(/Endurance never lands/);
  const { g, calls } = fake();
  expect(() => launchShip(g, moon, "endurance")).toThrow(/ne se pose jamais|never lands/);
  expect(calls).toEqual([]);
});

test("a launch: the craft chosen, then there; a mission's scene as it is", () => {
  const { g, calls } = fake();
  const d = (v: "ranger" | "lander" | "endurance", id: string) => shipItems(v).destinations.find((x) => x.id === id)!;
  launchShip(g, d("lander", "dest:moon-ground"), "lander");
  launchShip(g, d("endurance", "dest:mars-orbit"), "endurance");
  launchShip(g, d("ranger", "dest:saturn"), "ranger");
  launchShip(g, d("ranger", "dest:gargantua"), "ranger");
  launchShip(g, shipItems("endurance").missions[1]!, "endurance");
  expect(calls).toEqual([
    'vessel("lander")',
    'land("moon",0.674,23.473)',
    'vessel("endurance")',
    'orbit("mars",300)',
    'vessel("ranger")',
    'near("saturn",150000)',
    'vessel("ranger")',
    'wormhole("gargantua")',
    'scene("Interstellar: the Endurance before Gargantua")',
  ]);
});
