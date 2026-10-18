import { expect, test } from "bun:test";
import { CockpitScreens, PAGES, parsePages, tabAt } from "../src/ui/cockpitscreens";

// PLAN-COCKPIT K3: the screens' pages — the tab under a point of a display, a click choosing a page (again:
// back to automatic), the choice kept as a setting.

/** the (u, v) of a tab's centre: the strip's geometry inverted (the 2 % inset, 512 × 683 units) */
const at = (k: number): [number, number] => {
  const w = (512 - 24) / 6;
  const x = 12 + (k % 6) * w + w / 2,
    y = 683 - 118 + Math.floor(k / 6) * 50 + 25;
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

test("the CKL page touched (PLAN-VAISSEAUX X6a): a failure's steps, its action only once they all are; the SYS page's buttons", () => {
  // (a drawing context that draws nothing: the zones the pages keep are what is tested)
  const ctx = new Proxy(
    {},
    {
      get: (_, k) =>
        k === "measureText" ? () => ({ width: 10 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {},
      set: () => true,
    },
  );
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
    getContext() {
      return ctx;
    }
  };
  const S = new CockpitScreens();
  S.setPage(0, "ckl");
  S.setPage(1, "systems");
  const ticks = new Map<string, Set<number>>();
  const info = new Proxy(
    {
      vessel: "ranger",
      engine: { max: 1, fuel: { fraction: 0.5 } },
      omega: [0, 0, 0],
      assembly: ["ranger"],
      throttle: 0,
      accel: 0,
      mass: 1,
      sas: true,
      hold: "none",
      auto: "none",
    },
    { get: (o, k) => (k in o ? (o as Record<string | symbol, unknown>)[k] : null) },
  );
  const data = (fixing = false) => ({
    info: info as never,
    status: null,
    settings: { cockpitPages: S.pagesSetting(), massSolar: 1e8, cockpitAids: true, hudHover: true } as never,
    time: 0,
    systems: {
      vessel: "ranger",
      battery: 30,
      batteryKWh: 60,
      balanceKW: 1,
      o2Kg: 40,
      o2Hours: 285,
      scrubDays: 14,
      crew: 4,
      failures: [{ kind: "rcsStuck", fixing, at: 0 }],
      engine: 1,
      rcs: 1,
    } as never,
    ticks,
  });
  S.draw(data(), 1000);
  // (the zones' centres: step 1's button at x 14…66, y 92…144 — u, v undone from the 2 % inset)
  const uv = (x: number, y: number): [number, number] => [(x / 512 - 0.02) / 0.96, (y / 683 - 0.02) / 0.96];
  expect(S.actAt(0, ...uv(40, 118))).toEqual({ kind: "tick", key: "f:rcsStuck", step: 0 });
  // (the action held back: no zone yet)
  const fixY = 92 + 3 * 74 + 8 + 28;
  expect(S.actAt(0, ...uv(256, fixY))).toBeNull();
  ticks.set("f:rcsStuck", new Set([0, 1, 2]));
  (S as unknown as { lastDraw: number }).lastDraw = -Infinity;
  S.draw(data(), 1000);
  expect(S.actAt(0, ...uv(256, fixY))).toEqual({ kind: "fix", fail: "rcsStuck" });
  // (the SYS page: its SAS button)
  expect(S.actAt(1, ...uv(60, 583))).toEqual({ kind: "sas" });
});
