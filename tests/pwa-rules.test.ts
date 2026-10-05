import { expect, test } from "bun:test";
import { classify, evictions, SHELL_CACHE, isShellCache, TILE_BUDGET } from "../src/pwa/rules";

const O = "https://thesamlepirate.github.io";

test("a request's kind: hashed assets, the shell, the tiles, the elements, the rest", () => {
  expect(classify(`${O}/black-hole-gpu/index-a1b2c3d4.js`, O)).toBe("immutable");
  expect(classify(`${O}/black-hole-gpu/earth-3z05cvb5.ktx2`, O)).toBe("immutable");
  expect(classify(`${O}/black-hole-gpu/`, O)).toBe("shell");
  expect(classify(`${O}/black-hole-gpu/version.json`, O)).toBe("shell");
  expect(classify(`${O}/black-hole-gpu/plan-worker.js`, O)).toBe("shell");
  expect(classify(`${O}/black-hole-gpu/docs/comment-jouer.html`, O)).toBe("shell");
  expect(classify("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/9/148/198.png", O)).toBe("tile");
  expect(
    classify(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/default/GoogleMapsCompatible_Level8/8/99/74.jpeg",
      O,
    ),
  ).toBe("tile");
  expect(classify("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=json", O)).toBe("elements");
  expect(classify("https://openrouter.ai/api/v1/chat/completions", O)).toBe("pass");
  expect(classify(`${O}/__snapshot?name=x`, O)).toBe("pass");
  expect(classify(`${O}/black-hole-gpu/index-a1b2c3d4.js`, O, "POST")).toBe("pass");
  // (a page with a query — the tests' e2e=…: still the shell, cached under the scope's root too)
  expect(classify(`${O}/?e2e=0.5`, O)).toBe("shell");
  expect(classify("not a url", O)).toBe("pass");
});

test("evictions: none under the budget; the oldest first, down to 90 % of it", () => {
  const MB = 1024 * 1024;
  const e = (url: string, t: number, mb: number) => ({ url, t, size: mb * MB });
  expect(evictions([e("a", 1, 100), e("b", 2, 100)])).toEqual([]);
  const out = evictions([e("old", 1, 100), e("mid", 2, 100), e("new", 3, 100), e("newest", 4, 50)], 300 * MB);
  // (350 MB: over; dropping "old" leaves 250 ≤ 270)
  expect(out).toEqual(["old"]);
  const out2 = evictions([e("old", 1, 100), e("mid", 2, 100), e("new", 3, 100), e("newest", 4, 200)], 300 * MB);
  expect(out2).toEqual(["old", "mid", "new"]);
  expect(TILE_BUDGET).toBeGreaterThan(100 * MB);
});

test("the shells' cache names carry the build; the tiles' does not", () => {
  expect(isShellCache(SHELL_CACHE("4cb035a"))).toBe(true);
  expect(isShellCache("kerr-tiles-v1")).toBe(false);
});
