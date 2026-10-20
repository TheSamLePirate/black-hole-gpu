import { expect, test } from "bun:test";
import { presets } from "../src/settings";
import { SCENE_THUMBS } from "../src/ui/scene-thumbs";
import { MODES, MORE, type TitleGame, VESSELS } from "../src/ui/title/activities";
import { framePosition, MODE_ART, TURNTABLES } from "../src/ui/title/art";
import { agoText } from "../src/ui/title/title";

// The title screen's catalogue (PLAN-TITRE-AAA E2): every picture and every scene it names exists, every entry
// is in French and English, and each launch reaches the game by the call it says.

test("four modes, each with its picture and its entries, ids unique", () => {
  expect(MODES.map((m) => m.id)).toEqual(["foot", "plane", "ship", "free"]);
  const ids = [...MODES.flatMap((m) => m.activities), ...MORE].map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const m of MODES) {
    expect(MODE_ART[m.id].card && MODE_ART[m.id].wide).toBeTruthy();
    expect(m.activities.length).toBeGreaterThanOrEqual(4);
    for (const a of [...m.activities]) {
      if (a.art) expect(SCENE_THUMBS[a.art]).toBeTruthy();
      for (const t of [a.title, a.hint]) expect(t.fr && t.en).toBeTruthy();
    }
  }
  expect(VESSELS.map((v) => v.id)).toEqual(["ranger", "lander", "endurance"]);
  for (const v of VESSELS) expect(TURNTABLES[v.id]).toBeTruthy();
});

test("a turntable's sheet: 36 views, 6 a row, the frame wrapping round", () => {
  expect(framePosition(0)).toBe("0% 0%");
  expect(framePosition(5)).toBe("100% 0%");
  expect(framePosition(6)).toBe("0% 20%");
  expect(framePosition(35)).toBe("100% 100%");
  expect(framePosition(36)).toBe("0% 0%");
  expect(framePosition(-1)).toBe("100% 100%");
});

test("each launch calls the game as it says; the scenes it names exist", () => {
  const calls: string[] = [];
  const g = new Proxy({} as TitleGame, {
    get:
      (_, k) =>
      (...a: unknown[]) => {
        calls.push(`${String(k)}(${a.map((x) => JSON.stringify(x)).join(",")})`);
        return "";
      },
  });
  for (const a of [...MODES.flatMap((m) => m.activities), ...MORE]) a.run(g, { vessel: "lander" });
  for (const c of calls.filter((c) => c.startsWith("scene("))) expect(presets[JSON.parse(c.slice(6, -1))]).toBeTruthy();
  expect(calls).toContain('walk("moon",0.674,23.473)');
  expect(calls).toContain("jet()");
  // (the craft chosen goes before the orbit)
  expect(calls.indexOf('vessel("lander")')).toBeLessThan(calls.indexOf('orbit("earth",400)'));
  expect(calls).toContain('scenes("hole")');
});

test("how long ago, in a few words", () => {
  expect(agoText(20_000, "fr")).toBe("à l'instant");
  expect(agoText(5 * 60_000, "en")).toBe("5 min ago");
  expect(agoText(3 * 3600_000, "fr")).toBe("il y a 3 h");
  expect(agoText(2 * 86400_000, "en")).toBe("2 d ago");
});
