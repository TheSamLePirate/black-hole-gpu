import { expect, test } from "bun:test";
import { CONFIRM_AFTER_MS, DRAWERS, OBJ_MARK, playedText, TIPS, tipOf, titleNeedsConfirm } from "../src/ui/pausemenu";

// The pause menu's data (PLAN-TITRE-AAA E8): its drawers (their entries unique, FR+EN), a tip for each mode, the
// time played in words, and when going back to the title asks first — more than five minutes played since the
// last save (or none), never in the first five minutes.

test("the drawers: their entries unique, in French and English; the diagnostic among the settings", () => {
  const ids = Object.values(DRAWERS).flatMap((d) => d.items.map((x) => x.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const d of Object.values(DRAWERS)) {
    expect(d.title.fr && d.title.en && d.hint.fr && d.hint.en).toBeTruthy();
    expect(d.items.length).toBeGreaterThanOrEqual(3);
    for (const x of d.items) expect(x.title.fr && x.title.en).toBeTruthy();
  }
  expect(DRAWERS.settings.items.map((x) => x.id)).toContain("graphics-diagnostic");
  expect(DRAWERS.modes.items.map((x) => x.id)).toEqual(["mode-foot", "mode-plane", "mode-ship", "mode-free"]);
  // (the first level: resume, save, load, five drawers' groups, the title — release and play together beside)
  expect(Object.keys(DRAWERS)).toHaveLength(5);
});

test("a tip for each mode, round", () => {
  for (const m of ["ship", "foot", "free", "photo", "jet"] as const) {
    expect(TIPS[m].length).toBeGreaterThanOrEqual(2);
    expect(tipOf(m, TIPS[m].length)).toEqual(tipOf(m, 0));
    expect(tipOf(m, -1)).toEqual(TIPS[m].at(-1)!);
  }
});

test("back to the title: asked only past five minutes played and unsaved", () => {
  const now = 1_000_000_000;
  expect(titleNeedsConfirm({ played: 60_000, savedAt: null }, now)).toBe(false);
  expect(titleNeedsConfirm({ played: CONFIRM_AFTER_MS + 1, savedAt: null }, now)).toBe(true);
  expect(titleNeedsConfirm({ played: 3_600_000, savedAt: now - 60_000 }, now)).toBe(false);
  expect(titleNeedsConfirm({ played: 3_600_000, savedAt: now - CONFIRM_AFTER_MS - 1 }, now)).toBe(true);
});

test("the time played in words; the objectives' marks", () => {
  expect(playedText(45_000)).toBe("45 s");
  expect(playedText(12 * 60_000)).toBe("12 min");
  expect(playedText(72 * 60_000)).toBe("1 h 12");
  expect(playedText(125 * 60_000)).toBe("2 h 05");
  expect(OBJ_MARK.done).toBe("✓");
  expect(OBJ_MARK.failed).toBe("✕");
});
