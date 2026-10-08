import { expect, test } from "bun:test";
import { CockpitScreens, PAGES, parsePages, tabAt } from "../src/ui/cockpitscreens";

// PLAN-COCKPIT K3: the screens' pages — the tab under a point of a display, a click choosing a page (again:
// back to automatic), the choice kept as a setting.

/** the (u, v) of a tab's centre: the strip's geometry inverted (the 2 % inset, 512 × 683 units) */
const at = (k: number): [number, number] => {
  const w = (512 - 24) / 5;
  const x = 12 + (k % 5) * w + w / 2,
    y = 683 - 118 + Math.floor(k / 5) * 50 + 25;
  return [(x / 512 - 0.02) / 0.96, (y / 683 - 0.02) / 0.96];
};

test("the tabs: each page's under its centre; none above the strip or past it", () => {
  PAGES.forEach((p, k) => expect(tabAt(...at(k))).toBe(p));
  expect(tabAt(0.5, 0.3)).toBeNull();
  expect(tabAt(0.5, 0.75)).toBeNull();
});

test("a click: the page chosen; again: automatic; the setting kept and read back", () => {
  // (no canvas here: the screens' own, stubbed — the pages' logic only)
  const G = globalThis as { OffscreenCanvas?: unknown };
  G.OffscreenCanvas ??= class {
    getContext() {
      return {};
    }
  };
  const S = new CockpitScreens();
  expect(S.clickScreen(0, 0.5, 0.3)).toBeUndefined();
  expect(S.clickScreen(0, ...at(1))).toBe("orbit");
  expect(S.clickScreen(4, ...at(9))).toBe("landing");
  expect(S.pagesSetting()).toBe("orbit,,,,landing,,,");
  expect(parsePages(S.pagesSetting())).toEqual(["orbit", null, null, null, "landing", null, null, null]);
  expect(S.clickScreen(0, ...at(1))).toBeNull();
  expect(S.clickScreen(4, ...at(9))).toBeNull();
  expect(S.pagesSetting()).toBe("");
  expect(parsePages("bogus,nav")).toEqual([null, "nav", null, null, null, null, null, null]);
});
